// The Jot HTTP server: the JSON API, uploads, private font and photo files, and the
// built frontend, all on one port.
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { MAX_TITLE_LENGTH } from '../shared/constants';
import { validateStyleInput } from '../shared/styles';
import { isDefaultFont } from '../shared/starter';
import { normalizeTag } from '../shared/tags';
import type { Font, TiptapDoc } from '../shared/types';
import { BackupError, RESTORING_MESSAGE } from './backup/errors';
import {
  cancelRestore,
  confirmRestore,
  listSafetyBackups,
  prepareDownload,
  safetyBackupPath,
  stageRestore,
  takeDownload,
  tidyUpOnStart,
} from './backup/personal';
import { ContentError, sanitizeDoc } from './content';
import { DEFAULT_STARTER_FONTS_DIR, fontsDir, photosDir, REPO_ROOT, type JotContext } from './context';
import { now, openDatabase } from './db';
import { syncDir, syncFile } from './durable';
import {
  downloadFamily,
  FONT_FILE,
  FontError,
  fontFaceCss,
  getCatalog,
  GOOGLE_FONTS,
  isValidFamilyName,
  type FontFace,
  type FontSourceConfig,
} from './fonts';
import { isId, newId } from './ids';
import * as notes from './notes';
import { burnPasswordCheck, verifyPassword } from './passwords';
import { createSession, deleteSession, SESSION_COOKIE, userForSession } from './sessions';
import { detectImageType, SNIFF_BYTES } from './uploads';
import { findUser, normalizeUsername } from './users';

declare module 'fastify' {
  interface FastifyInstance {
    jot: JotContext;
  }
  interface FastifyRequest {
    user: { id: string; username: string } | null;
  }
}

export interface AppOptions {
  dataDir: string;
  logger?: boolean;
  fonts?: Partial<FontSourceConfig>;
  starterFontsDir?: string;
  /** Mark the session cookie Secure (only when served over HTTPS). */
  secureCookies?: boolean;
  /** Folder with the built frontend; served when it exists. */
  clientDir?: string;
}

const PUBLIC_API = new Set(['/api/health', '/api/login', '/api/logout']);

const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Tiptap writes inline style attributes; the font catalogue previews use Google's CSS.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://fonts.googleapis.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
const notFound = (what = 'Not found.') => new HttpError(404, what);
const bad = (msg: string) => new HttpError(400, msg);

function body(req: FastifyRequest): Record<string, unknown> {
  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('Expected a JSON object.');
  return b as Record<string, unknown>;
}

function param(req: FastifyRequest, name: string): string {
  const v = (req.params as Record<string, string>)[name];
  if (!isId(v)) throw notFound();
  return v;
}

function uid(req: FastifyRequest): string {
  if (!req.user) throw new HttpError(401, 'Not logged in.');
  return req.user.id;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  mkdirSync(join(opts.dataDir, 'users'), { recursive: true });
  const db = openDatabase(join(opts.dataDir, 'jot.db'));
  const ctx: JotContext = {
    db,
    dataDir: opts.dataDir,
    starterFontsDir: opts.starterFontsDir ?? DEFAULT_STARTER_FONTS_DIR,
    fontSource: { ...GOOGLE_FONTS, ...opts.fonts },
  };

  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 32 * 1024 * 1024, // note JSON (photos are separate uploads)
    trustProxy: false,
  });
  app.decorate('jot', ctx);
  app.decorateRequest('user', null);
  app.addHook('onClose', async () => db.close());

  // Finish any tidy-up a crashed restore left, and drop old uploads and downloads.
  await tidyUpOnStart(ctx, (msg) => app.log.warn(msg));
  /** Users whose restore is running: their saves and uploads are refused until it ends. */
  const restoring = new Set<string>();

  // Only JSON bodies (and multipart for photos): HTML forms cannot post to the API.
  app.removeContentTypeParser('text/plain');
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: Infinity, files: 1, fields: 10 } });

  // ---------------------------------------------------------------- hooks
  app.addHook('onRequest', async (req, reply) => {
    // Refuse cross-site state-changing requests.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(req.headers.origin).host;
      } catch {
        originHost = null;
      }
      if (originHost !== req.headers.host) {
        return reply.code(403).send({ error: 'Cross-site request refused.' });
      }
    }
    const path = req.url.split('?')[0];
    if (path.startsWith('/api/')) {
      req.user = userForSession(db, req.cookies[SESSION_COOKIE]);
      if (!PUBLIC_API.has(path) && !req.user) {
        return reply.code(401).send({ error: 'Not logged in.' });
      }
      if (req.user && restoring.has(req.user.id) && req.method !== 'GET' && req.method !== 'HEAD' && path !== '/api/logout') {
        return reply.code(409).send({ error: RESTORING_MESSAGE, code: 'restore-in-progress' });
      }
    }
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    if (!reply.getHeader('content-security-policy')) reply.header('content-security-policy', APP_CSP);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
    return payload;
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    if (err instanceof BackupError) return reply.code(err.status).send(err.code ? { error: err.message, code: err.code } : { error: err.message });
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Something went wrong.' });
    }
    return reply.code(status).send({ error: err instanceof HttpError ? err.message : String(err.message ?? 'Bad request.') });
  });

  // ---------------------------------------------------------------- auth
  app.get('/api/health', { logLevel: 'warn' }, async () => ({ ok: true }));

  app.post('/api/login', async (req, reply) => {
    const b = body(req);
    if (typeof b.username !== 'string' || typeof b.password !== 'string') throw bad('Username and password are required.');
    const fail = () => reply.code(401).send({ error: 'Wrong username or password.' });
    const username = normalizeUsername(b.username);
    const user = username ? findUser(ctx, username) : undefined;
    if (!user) {
      await burnPasswordCheck(b.password);
      return fail();
    }
    if (!(await verifyPassword(user.password_hash, b.password))) return fail();
    const s = createSession(db, user.id);
    reply.setCookie(SESSION_COOKIE, s.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: opts.secureCookies ?? false,
      expires: s.expiresAt,
    });
    return { user: { id: user.id, username: user.username } };
  });

  app.post('/api/logout', async (req, reply) => {
    deleteSession(db, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: opts.secureCookies ?? false });
    return reply.code(204).send();
  });

  app.get('/api/me', async (req) => ({ user: req.user }));

  // ---------------------------------------------------------------- notes
  const readTitle = (v: unknown): string => {
    if (typeof v !== 'string') throw bad('Title must be text.');
    if (v.length > MAX_TITLE_LENGTH) throw bad(`Titles can be at most ${MAX_TITLE_LENGTH} characters.`);
    // eslint-disable-next-line no-control-regex
    return v.replace(/[\u0000-\u001f\u007f]/g, ' ');
  };
  const readContent = (v: unknown): TiptapDoc => {
    try {
      return sanitizeDoc(v);
    } catch (e) {
      if (e instanceof ContentError) throw bad(e.message);
      throw e;
    }
  };
  const READ_ONLY = 'This note is read-only: it cannot be changed or deleted. It can only be made writable again from the command line on the server.';
  const updated = (r: notes.UpdateResult) => {
    if (r === 'not-found') throw notFound('Note not found.');
    if (r === 'read-only') throw new HttpError(403, READ_ONLY);
    if (r === 'trashed') throw new HttpError(409, 'This note is in the trash. Restore it to edit it.');
    return { note: r };
  };

  app.get('/api/notes', async (req) => {
    const tag = (req.query as Record<string, unknown>).tag;
    if (tag !== undefined && typeof tag !== 'string') throw bad('Bad tag.');
    return { notes: notes.listNotes(db, uid(req), tag || undefined) };
  });

  app.post('/api/notes', async (req, reply) => {
    const b = body(req);
    const title = b.title === undefined ? '' : readTitle(b.title);
    const content = b.content === undefined ? undefined : readContent(b.content);
    return reply.code(201).send({ note: notes.createNote(db, uid(req), title, content) });
  });

  app.get('/api/notes/:id', async (req) => {
    const note = notes.getNote(db, uid(req), param(req, 'id'));
    if (!note) throw notFound('Note not found.');
    return { note };
  });

  app.patch('/api/notes/:id', async (req) => {
    const id = param(req, 'id');
    const b = body(req);
    const patch: { title?: string; content?: TiptapDoc } = {};
    if (b.title !== undefined) patch.title = readTitle(b.title);
    if (b.content !== undefined) patch.content = readContent(b.content);
    return updated(notes.updateNote(db, uid(req), id, patch));
  });

  app.delete('/api/notes/:id', async (req) => {
    const note = notes.trashNote(db, uid(req), param(req, 'id'));
    if (note === 'read-only') throw new HttpError(403, READ_ONLY);
    if (!note) throw notFound('Note not found.');
    return { note };
  });

  // Read-only is one way: the web app can turn it on, never off (only `jot unlock-note`).
  app.post('/api/notes/:id/read-only', async (req) => {
    const r = notes.makeReadOnly(db, uid(req), param(req, 'id'));
    if (r === 'not-found') throw notFound('Note not found.');
    if (r === 'trashed') throw new HttpError(409, 'This note is in the trash. Restore it before making it read-only.');
    return { note: r };
  });

  app.post('/api/notes/:id/tags', async (req) => {
    const id = param(req, 'id');
    const r = normalizeTag(body(req).tag);
    if (!r.ok) {
      // Unknown or foreign notes are 404 before any validation message.
      if (!notes.getNote(db, uid(req), id)) throw notFound('Note not found.');
      throw bad(r.error);
    }
    return updated(notes.addTag(db, uid(req), id, r.tag));
  });

  app.delete('/api/notes/:id/tags/:tag', async (req) => {
    const id = param(req, 'id');
    const r = normalizeTag((req.params as Record<string, string>).tag);
    if (!r.ok) {
      if (!notes.getNote(db, uid(req), id)) throw notFound('Note not found.');
      throw bad(r.error);
    }
    return updated(notes.removeTag(db, uid(req), id, r.tag));
  });

  app.get('/api/tags', async (req) => ({ tags: notes.listTags(db, uid(req)) }));

  app.get('/api/search', async (req) => ({ notes: notes.searchNotes(db, uid(req), (req.query as Record<string, unknown>).q) }));

  // ---------------------------------------------------------------- trash
  app.get('/api/trash', async (req) => ({ notes: notes.listTrash(db, uid(req)) }));

  app.post('/api/trash/:id/restore', async (req) => {
    const note = notes.restoreNote(db, uid(req), param(req, 'id'));
    if (!note) throw notFound('No such note in the trash.');
    return { note };
  });

  // Empty trash: every note in the user's trash, permanently, in one transaction.
  app.delete('/api/trash', async (req) => ({ deleted: notes.emptyTrash(db, uid(req)) }));

  app.delete('/api/trash/:id', async (req, reply) => {
    if (!notes.purgeNote(db, uid(req), param(req, 'id'))) throw notFound('No such note in the trash.');
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- photos
  app.post('/api/photos', async (req, reply) => {
    const userId = uid(req);
    if (!req.isMultipart()) throw bad('Upload a photo as multipart/form-data.');
    const part = await req.file();
    if (!part) throw bad('No file was uploaded.');
    const id = newId();
    const dir = photosDir(ctx, userId);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.upload-${id}`);
    try {
      // Streamed straight to disk: no size limit and nothing held in memory.
      await pipeline(part.file, createWriteStream(tmp, { flags: 'wx' }));
      const head = Buffer.alloc(SNIFF_BYTES);
      const fd = openSync(tmp, 'r');
      const n = readSync(fd, head, 0, SNIFF_BYTES, 0);
      closeSync(fd);
      const mime = detectImageType(head.subarray(0, n));
      if (!mime) throw bad('Photos must be JPEG, PNG, GIF or WebP images.');
      const size = statSync(tmp).size;
      renameSync(tmp, join(dir, id));
      try {
        // The file and its name are on disk before the record that points at it.
        await syncFile(join(dir, id));
        await syncDir(dir);
        await syncDir(dirname(dir));
        if (restoring.has(userId)) throw new HttpError(409, RESTORING_MESSAGE);
        db.prepare('INSERT INTO photos (id, user_id, mime, size, original_name, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
          id,
          userId,
          mime,
          size,
          String(part.filename ?? '').slice(0, 255),
          now(),
        );
      } catch (err) {
        rmSync(join(dir, id), { force: true }); // no row, no file
        throw err;
      }
      return reply.code(201).send({ photo: { id, url: `/api/photos/${id}`, mime } });
    } finally {
      rmSync(tmp, { force: true });
    }
  });

  app.get('/api/photos/:id', async (req, reply) => {
    const userId = uid(req);
    const id = param(req, 'id');
    const row = db.prepare('SELECT mime FROM photos WHERE id = ? AND user_id = ?').get(id, userId) as { mime: string } | undefined;
    if (!row) throw notFound('Photo not found.');
    const file = join(photosDir(ctx, userId), id);
    if (!existsSync(file)) throw notFound('Photo not found.');
    reply
      .type(row.mime)
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'private, max-age=31536000, immutable');
    return reply.send(createReadStream(file));
  });

  // ---------------------------------------------------------------- fonts
  type FontRow = { id: string; family: string; category: string; faces: string; archived_at: string | null; created_at: string };
  const toFont = (r: FontRow): Font => ({
    id: r.id,
    family: r.family,
    category: r.category,
    archived: r.archived_at !== null,
    isDefault: isDefaultFont(r.family),
    createdAt: r.created_at,
  });
  const getFont = (userId: string, id: string) =>
    db.prepare('SELECT * FROM fonts WHERE id = ? AND user_id = ?').get(id, userId) as FontRow | undefined;
  const fontError = (e: unknown) => {
    if (e instanceof FontError) return new HttpError(e.status, e.message);
    return e;
  };

  app.get('/api/fonts/catalog', async () => {
    try {
      const { list } = await getCatalog(ctx.fontSource);
      return { fonts: list.map((f) => ({ family: f.family, category: f.category })) };
    } catch (e) {
      throw fontError(e);
    }
  });

  app.get('/api/fonts', async (req) => {
    const rows = db.prepare('SELECT * FROM fonts WHERE user_id = ? ORDER BY family').all(uid(req)) as FontRow[];
    return { fonts: rows.map(toFont) };
  });

  app.post('/api/fonts', async (req, reply) => {
    const userId = uid(req);
    const family = body(req).family;
    if (!isValidFamilyName(family)) throw bad('Choose a font from the Google Fonts catalogue.');
    const existing = db.prepare('SELECT * FROM fonts WHERE user_id = ? AND family = ?').get(userId, family) as FontRow | undefined;
    if (existing) {
      db.prepare('UPDATE fonts SET archived_at = NULL WHERE id = ? AND user_id = ?').run(existing.id, userId);
      return reply.code(200).send({ font: toFont(getFont(userId, existing.id)!) });
    }
    let entry;
    try {
      entry = (await getCatalog(ctx.fontSource)).byFamily.get(family);
    } catch (e) {
      throw fontError(e);
    }
    if (!entry) throw bad(`"${family}" is not in the Google Fonts catalogue.`);
    const id = newId();
    const dir = join(fontsDir(ctx, userId), id);
    let faces: FontFace[];
    try {
      faces = await downloadFamily(ctx.fontSource, entry.family, entry.variants, dir);
    } catch (e) {
      // The user sees a short message; the log keeps the underlying cause.
      req.log.error({ err: e, cause: e instanceof Error ? e.cause : undefined, family: entry.family }, 'font download failed');
      throw fontError(e);
    }
    try {
      if (restoring.has(userId)) throw new HttpError(409, RESTORING_MESSAGE);
      db.prepare('INSERT INTO fonts (id, user_id, family, category, faces, archived_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)').run(
        id,
        userId,
        entry.family,
        entry.category,
        JSON.stringify(faces),
        now(),
      );
    } catch (e) {
      // Added twice at the same time: keep the first copy.
      rmSync(dir, { recursive: true, force: true });
      if (e instanceof HttpError) throw e;
      const again = db.prepare('SELECT * FROM fonts WHERE user_id = ? AND family = ?').get(userId, family) as FontRow | undefined;
      if (again) return reply.code(200).send({ font: toFont(again) });
      throw e;
    }
    return reply.code(201).send({ font: toFont(getFont(userId, id)!) });
  });

  const setArchived = (archived: boolean) => async (req: FastifyRequest) => {
    const userId = uid(req);
    const id = param(req, 'id');
    const font = getFont(userId, id);
    if (!font) throw notFound('Font not found.');
    // The starter fonts are default fonts. One archived before this rule can still be restored.
    if (archived && isDefaultFont(font.family)) throw bad(`${font.family} is a default font and cannot be archived.`);
    const r = db
      .prepare('UPDATE fonts SET archived_at = ? WHERE id = ? AND user_id = ?')
      .run(archived ? (getFont(userId, id)?.archived_at ?? now()) : null, id, userId);
    if (r.changes === 0) throw notFound('Font not found.');
    return { font: toFont(getFont(userId, id)!) };
  };
  app.post('/api/fonts/:id/archive', setArchived(true));
  app.post('/api/fonts/:id/unarchive', setArchived(false));

  app.get('/api/fonts.css', async (req, reply) => {
    // Archived fonts are included: notes and styles that use them keep rendering.
    const rows = db.prepare('SELECT * FROM fonts WHERE user_id = ? ORDER BY family').all(uid(req)) as FontRow[];
    const css = fontFaceCss(rows.map((r) => ({ id: r.id, family: r.family, faces: JSON.parse(r.faces) as FontFace[] })));
    return reply.type('text/css; charset=utf-8').header('cache-control', 'no-cache').send(css);
  });

  app.get('/api/fonts/:id/files/:file', async (req, reply) => {
    const userId = uid(req);
    const id = param(req, 'id');
    const file = (req.params as Record<string, string>).file;
    if (typeof file !== 'string' || !FONT_FILE.test(file)) throw notFound();
    const font = getFont(userId, id);
    if (!font) throw notFound();
    const faces = JSON.parse(font.faces) as FontFace[];
    if (!faces.some((f) => f.file === file)) throw notFound();
    const path = join(fontsDir(ctx, userId), id, file);
    if (!existsSync(path)) throw notFound();
    reply.type('font/woff2').header('cache-control', 'private, max-age=31536000, immutable');
    return reply.send(createReadStream(path));
  });

  // ---------------------------------------------------------------- styles
  type StyleRow = {
    id: string;
    name: string;
    font_id: string;
    family: string;
    font_archived: string | null;
    size: number;
    bold: number;
    italic: number;
    underline: number;
    strike: number;
    text_color: string | null;
    highlight: string | null;
    created_at: string;
    updated_at: string;
    is_default: number;
  };
  const STYLE_SELECT = `SELECT s.*, f.family AS family, f.archived_at AS font_archived
    FROM styles s JOIN fonts f ON f.id = s.font_id AND f.user_id = s.user_id`;
  const toStyle = (r: StyleRow) => ({
    id: r.id,
    name: r.name,
    fontId: r.font_id,
    fontFamily: r.family,
    fontArchived: r.font_archived !== null,
    size: r.size,
    bold: !!r.bold,
    italic: !!r.italic,
    underline: !!r.underline,
    strike: !!r.strike,
    textColor: r.text_color,
    highlight: r.highlight,
    isDefault: r.is_default === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
  const getStyle = (userId: string, id: string) =>
    db.prepare(`${STYLE_SELECT} WHERE s.id = ? AND s.user_id = ?`).get(id, userId) as StyleRow | undefined;
  const readStyle = (req: FastifyRequest) => {
    const r = validateStyleInput(req.body);
    if (!r.ok) throw bad(r.error);
    if (!getFont(uid(req), r.value.fontId)) throw bad('Choose one of your fonts.');
    return r.value;
  };

  app.get('/api/styles', async (req) => {
    const rows = db.prepare(`${STYLE_SELECT} WHERE s.user_id = ? ORDER BY s.name COLLATE NOCASE, s.id`).all(uid(req)) as StyleRow[];
    return { styles: rows.map(toStyle) };
  });

  app.post('/api/styles', async (req, reply) => {
    const userId = uid(req);
    const s = readStyle(req);
    const id = newId();
    const t = now();
    db.prepare(
      `INSERT INTO styles (id, user_id, name, font_id, size, bold, italic, underline, strike, text_color, highlight, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, userId, s.name, s.fontId, s.size, +s.bold, +s.italic, +s.underline, +s.strike, s.textColor, s.highlight, t, t);
    return reply.code(201).send({ style: toStyle(getStyle(userId, id)!) });
  });

  app.put('/api/styles/:id', async (req) => {
    const userId = uid(req);
    const id = param(req, 'id');
    const existing = getStyle(userId, id);
    if (!existing) throw notFound('Style not found.');
    if (existing.is_default) throw bad(`${existing.name} is a default style and cannot be changed or deleted.`);
    const s = readStyle(req);
    db.prepare(
      `UPDATE styles SET name = ?, font_id = ?, size = ?, bold = ?, italic = ?, underline = ?, strike = ?, text_color = ?, highlight = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).run(s.name, s.fontId, s.size, +s.bold, +s.italic, +s.underline, +s.strike, s.textColor, s.highlight, now(), id, userId);
    return { style: toStyle(getStyle(userId, id)!) };
  });

  app.delete('/api/styles/:id', async (req, reply) => {
    const existing = getStyle(uid(req), param(req, 'id'));
    if (existing?.is_default) throw bad(`${existing.name} is a default style and cannot be changed or deleted.`);
    const r = db.prepare('DELETE FROM styles WHERE id = ? AND user_id = ? AND is_default = 0').run(param(req, 'id'), uid(req));
    if (r.changes === 0) throw notFound('Style not found.');
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- backup and restore
  // A personal backup is built on the server, then downloaded (and removed) in a second
  // request, so the screen can say which files were already lost.
  app.post('/api/backup', async (req, reply) => {
    const b = await prepareDownload(ctx, uid(req), req.user!.username);
    return reply.code(201).send({ backup: { id: b.id, name: b.name, size: b.size, counts: b.counts, missing: b.missing } });
  });

  app.get('/api/backup/:id', async (req, reply) => {
    const d = await takeDownload(ctx, uid(req), param(req, 'id'));
    if (!d) throw notFound('This backup is no longer on the server. Make a new one.');
    reply
      .type('application/x-tar')
      .header('content-length', d.size)
      .header('content-disposition', `attachment; filename="${d.name}"`)
      .header('cache-control', 'no-store');
    return reply.send(d.stream);
  });

  // The restore upload is the raw file (not an HTML form), streamed to the staging folder.
  await app.register(async (scope) => {
    scope.addContentTypeParser(['application/x-tar', 'application/octet-stream'], (_req, payload, done) => done(null, payload));
    scope.post('/api/restore', async (req, reply) => {
      const userId = uid(req);
      const type = String(req.headers['content-type'] ?? '');
      if (!/^application\/(x-tar|octet-stream)\s*(;|$)/i.test(type)) throw new HttpError(415, 'Upload the backup file itself (application/x-tar).');
      const { id, summary } = await stageRestore(ctx, userId, req.body as Readable);
      return reply.code(201).send({ restore: { id, summary } });
    });
  });

  app.post('/api/restore/:id/confirm', async (req) => {
    const userId = uid(req);
    const id = param(req, 'id');
    if (body(req).confirm !== 'RESTORE') throw bad('Type RESTORE to confirm.');
    return { restored: await confirmRestore(ctx, userId, id, restoring) };
  });

  app.delete('/api/restore/:id', async (req, reply) => {
    if (!(await cancelRestore(ctx, uid(req), param(req, 'id')))) throw notFound('There is no such restore.');
    return reply.code(204).send();
  });

  app.get('/api/safety-backups', async (req) => ({ backups: await listSafetyBackups(ctx, uid(req)) }));

  const safetyFile = (req: FastifyRequest) => {
    const path = safetyBackupPath(ctx, uid(req), String((req.params as Record<string, string>).name ?? ''));
    if (!path) throw notFound('No such safety backup.');
    return path;
  };
  app.get('/api/safety-backups/:name', async (req, reply) => {
    const path = safetyFile(req);
    reply
      .type('application/x-tar')
      .header('content-length', statSync(path).size)
      .header('content-disposition', `attachment; filename="${(req.params as Record<string, string>).name}"`)
      .header('cache-control', 'no-store');
    return reply.send(createReadStream(path));
  });
  app.delete('/api/safety-backups/:name', async (req, reply) => {
    rmSync(safetyFile(req), { force: true });
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- frontend
  const clientDir = opts.clientDir ?? join(REPO_ROOT, 'dist', 'client');
  const indexHtml = join(clientDir, 'index.html');
  if (existsSync(indexHtml)) {
    await app.register(fastifyStatic, { root: clientDir, wildcard: false, index: false });
  }
  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0];
    if (req.method === 'GET' && !path.startsWith('/api/') && existsSync(indexHtml)) {
      return reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(createReadStream(indexHtml));
    }
    return reply.code(404).send({ error: 'Not found.' });
  });

  return app;
}
