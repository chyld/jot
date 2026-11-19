// Personal backup and restore (backup-spec.md §3).
//
// The three ideas that keep it simple:
//  1. A restore never touches an existing file: everything restored gets a new id, so
//     its files get new names.
//  2. The database decides: the switch from the old data to the new is one transaction.
//     Before the new files are written, their names are recorded (restore_files, state
//     "new"); the switch deletes those rows and records the old files (state "old") in
//     the same transaction. Tidy-up deletes every file still listed and its row, so after
//     a crash at any point it removes either the new files (never committed) or the old
//     ones (committed), and nothing else.
//  3. One lock (lock.ts) means only one backup or restore runs at a time.
import { createReadStream, createWriteStream, existsSync, openSync } from 'node:fs';
import { link, mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MAX_TITLE_LENGTH } from '../../shared/constants';
import { validateStyleInput } from '../../shared/styles';
import { normalizeTag } from '../../shared/tags';
import type { TiptapDoc, TiptapNode } from '../../shared/types';
import { ContentError, docText, sanitizeDoc } from '../content';
import { fontsDir, photosDir, userDir, type JotContext } from '../context';
import { syncDir, syncFile } from '../durable';
import { FONT_FILE, isValidFamilyName, type FontFace } from '../fonts';
import { isId, newId } from '../ids';
import { ensureDefaultStyles } from '../defaultStyles';
import { reindexNote } from '../notes';
import { STARTER_STYLES } from '../starter';
import { STARTER_FONT_FAMILIES } from '../../shared/starter';
import { ACCEPTED_IMAGE_TYPES, detectImageType, SNIFF_BYTES } from '../uploads';
import { ISO_DATE, readArchive, type ArchiveCheck, type MissingFile } from './archive';
import { BackupError } from './errors';
import { failpoint, failpointSync } from './failpoint';
import { takeLock, tryLock } from './lock';
import { sealManifest } from './manifest';
import { isPersonalEntry, isPersonalMissingName, personalBackupName, SAFETY_NAME, safetyBackupName, timeFromName } from './names';
import { TarWriter } from './tar';

export const PERSONAL_FORMAT = 'jot-personal-backup';
// Format 2 added `readOnly` on notes; a format 1 backup restores with every note writable.
export const PERSONAL_VERSION = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------------ what a backup holds

interface BNote {
  id: string;
  title: string;
  content: TiptapDoc;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  readOnly: boolean;
}
interface BPhoto {
  id: string;
  mime: string;
  size: number;
  originalName: string;
  createdAt: string;
}
interface BFont {
  id: string;
  family: string;
  category: string;
  faces: FontFace[];
  archivedAt: string | null;
  createdAt: string;
}
interface BStyle {
  id: string;
  name: string;
  fontId: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  textColor: string | null;
  highlight: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface PersonalData {
  notes: BNote[];
  photos: BPhoto[];
  fonts: BFont[];
  styles: BStyle[];
}

export interface Counts {
  notes: number;
  photos: number;
  fonts: number;
  styles: number;
}

export interface RestoreSummary {
  createdAt: string;
  counts: Counts;
  /** Notes whose content the sanitiser changed (they are restored in cleaned form). */
  adjustedNotes: number;
  /** Files that were already lost when the backup was made. */
  missing: MissingFile[];
}

const countsOf = (d: PersonalData): Counts => ({ notes: d.notes.length, photos: d.photos.length, fonts: d.fonts.length, styles: d.styles.length });

/** Every record the user owns, read in one database transaction (one moment in time). */
function readAccount(ctx: JotContext, userId: string): PersonalData {
  const db = ctx.db;
  return db.transaction((): PersonalData => {
    const tagsOf = db.prepare('SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? ORDER BY t.name');
    const notes = (db.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY created_at, id').all(userId) as any[]).map((n) => ({
      id: n.id,
      title: n.title,
      content: JSON.parse(n.content),
      tags: (tagsOf.all(n.id) as any[]).map((t) => t.name),
      createdAt: n.created_at,
      updatedAt: n.updated_at,
      deletedAt: n.deleted_at,
      readOnly: n.read_only === 1,
    }));
    const photos = (db.prepare('SELECT * FROM photos WHERE user_id = ? ORDER BY created_at, id').all(userId) as any[]).map((p) => ({
      id: p.id,
      mime: p.mime,
      size: p.size,
      originalName: p.original_name,
      createdAt: p.created_at,
    }));
    const fonts = (db.prepare('SELECT * FROM fonts WHERE user_id = ? ORDER BY created_at, id').all(userId) as any[]).map((f) => ({
      id: f.id,
      family: f.family,
      category: f.category,
      faces: JSON.parse(f.faces),
      archivedAt: f.archived_at,
      createdAt: f.created_at,
    }));
    // Default styles are part of the system, not the user's data.
    const styles = (db.prepare('SELECT * FROM styles WHERE user_id = ? AND is_default = 0 ORDER BY created_at, id').all(userId) as any[]).map((s) => ({
      id: s.id,
      name: s.name,
      fontId: s.font_id,
      size: s.size,
      bold: !!s.bold,
      italic: !!s.italic,
      underline: !!s.underline,
      strike: !!s.strike,
      textColor: s.text_color,
      highlight: s.highlight,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    }));
    return { notes, photos, fonts, styles };
  })();
}

// ------------------------------------------------------------------ photo references in notes

const PHOTO_SRC = /^\/api\/photos\/([A-Za-z0-9_-]{1,64})$/;

/** The photo ids a note's content points at. */
export function photoRefs(doc: TiptapNode): string[] {
  const out: string[] = [];
  const walk = (n: TiptapNode) => {
    const m = n.type === 'image' && typeof n.attrs?.src === 'string' ? PHOTO_SRC.exec(n.attrs.src) : null;
    if (m) out.push(m[1]);
    n.content?.forEach(walk);
  };
  walk(doc);
  return out;
}

/** A copy of the content with every photo pointed at its new id (ids not in the map are left alone). */
export function remapPhotoRefs<T extends TiptapNode>(doc: T, map: Map<string, string>): T {
  const walk = (n: TiptapNode): TiptapNode => {
    const out: TiptapNode = { ...n };
    const m = n.type === 'image' && typeof n.attrs?.src === 'string' ? PHOTO_SRC.exec(n.attrs.src) : null;
    if (m && map.has(m[1])) out.attrs = { ...n.attrs, src: `/api/photos/${map.get(m[1])}` };
    if (n.content) out.content = n.content.map(walk);
    return out;
  };
  return walk(doc) as T;
}

// ------------------------------------------------------------------ taking a backup

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (err: any) {
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return false;
    throw err;
  }
}

/**
 * Writes a personal backup of everything the user owns to outPath (a new file), then
 * checks it by reading it back against its manifest. A record whose file is missing does
 * not stop the backup: it is listed in the manifest and returned in `missing`.
 */
export async function writePersonalBackup(ctx: JotContext, userId: string, outPath: string, duringFailpoint?: string) {
  const data = readAccount(ctx, userId);
  const missing: MissingFile[] = [];
  const photoIds = new Set(data.photos.map((p) => p.id));
  for (const n of data.notes) {
    for (const id of photoRefs(n.content)) {
      if (!photoIds.has(id) && !missing.some((m) => m.name === `photos/${id}`)) {
        missing.push({ name: `photos/${id}`, what: `A photo in note "${n.title || 'Untitled'}" that is not in this account` });
      }
    }
  }
  const w = await TarWriter.create(outPath);
  try {
    const entries: Array<{ name: string; size: number; sha256: string }> = [];
    entries.push({ name: 'data.json', ...(await w.addBuffer('data.json', Buffer.from(JSON.stringify(data)))) });
    let copied = 0;
    const add = async (name: string, src: string, what: string) => {
      if (!(await isFile(src))) {
        missing.push({ name, what });
        return;
      }
      entries.push({ name, ...(await w.addFile(name, src)) });
      if (duringFailpoint && copied++ === 0) await failpoint(duringFailpoint);
    };
    for (const p of data.photos) {
      if (!isId(p.id)) throw new Error(`photo with a malformed id in the database: ${p.id}`);
      await add(`photos/${p.id}`, join(photosDir(ctx, userId), p.id), `Photo "${p.originalName || 'untitled'}"`);
    }
    for (const f of data.fonts) {
      if (!isId(f.id)) throw new Error(`font with a malformed id in the database: ${f.id}`);
      for (const face of f.faces) {
        if (!FONT_FILE.test(face.file)) throw new Error(`font file with a malformed name in the database: ${face.file}`);
        await add(`fonts/${f.id}/${face.file}`, join(fontsDir(ctx, userId), f.id, face.file), `Font "${f.family}" (file ${face.file})`);
      }
    }
    const manifest = { format: PERSONAL_FORMAT, version: PERSONAL_VERSION, createdAt: new Date().toISOString(), counts: countsOf(data), entries, missing };
    await w.addBuffer('manifest.json', sealManifest(manifest));
    await w.finish();
  } catch (err) {
    await w.abort();
    await rm(outPath, { force: true });
    throw err;
  }
  await readArchive(outPath, { format: PERSONAL_FORMAT, version: PERSONAL_VERSION, isEntry: isPersonalEntry, isMissingName: isPersonalMissingName });
  return { counts: countsOf(data), missing, size: (await stat(outPath)).size };
}

// ------------------------------------------------------------------ staging

export const stagingRoot = (ctx: JotContext) => join(ctx.dataDir, 'staging');
const userStaging = (ctx: JotContext, userId: string) => join(stagingRoot(ctx), userId);
const safetyDir = (ctx: JotContext, userId: string) => join(userDir(ctx, userId), 'safety-backups');

function stagingDir(ctx: JotContext, userId: string, id: string): string | null {
  if (!isId(userId) || !isId(id)) return null;
  return join(userStaging(ctx, userId), id);
}

/** Deletes uploads and downloads older than a day. The caller holds the lock. */
async function sweepStaging(ctx: JotContext) {
  const root = stagingRoot(ctx);
  if (!existsSync(root)) return;
  for (const u of await readdir(root)) {
    for (const id of await readdir(join(root, u)).catch(() => [] as string[])) {
      const dir = join(root, u, id);
      const st = await stat(dir).catch(() => null);
      if (st && Date.now() - st.mtimeMs > DAY_MS) await rm(dir, { recursive: true, force: true });
    }
  }
}

/** A backup built for download (POST /api/backup), kept until it is downloaded. */
export async function prepareDownload(ctx: JotContext, userId: string, username: string) {
  const lock = takeLock(ctx.dataDir);
  try {
    await sweepStaging(ctx);
    const id = newId();
    const dir = stagingDir(ctx, userId, id)!;
    await mkdir(dir, { recursive: true });
    try {
      const r = await writePersonalBackup(ctx, userId, join(dir, 'backup.tar'));
      const name = personalBackupName(username, new Date());
      await writeFile(join(dir, 'info.json'), JSON.stringify({ name }));
      return { id, name, ...r };
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      throw err;
    }
  } finally {
    lock.release();
  }
}

/** Opens a prepared backup for download and removes it from the server (the open file stays readable). */
export async function takeDownload(ctx: JotContext, userId: string, id: string) {
  const dir = stagingDir(ctx, userId, id);
  if (!dir || !existsSync(join(dir, 'backup.tar')) || !existsSync(join(dir, 'info.json'))) return null;
  const { name } = JSON.parse(await readFile(join(dir, 'info.json'), 'utf8'));
  const fd = openSync(join(dir, 'backup.tar'), 'r');
  const size = (await stat(join(dir, 'backup.tar'))).size;
  await rm(dir, { recursive: true, force: true });
  return { stream: createReadStream('', { fd }), size, name: String(name) };
}

// ------------------------------------------------------------------ checking an uploaded backup

interface Checked {
  summary: RestoreSummary;
  data: PersonalData; // cleaned: sanitised content, photo types from the files
  present: string[]; // entry names that are in the backup
}

function fail(why: string): never {
  throw new BackupError(`This backup cannot be restored: ${why}`);
}
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const isDate = (v: unknown): v is string => typeof v === 'string' && ISO_DATE.test(v);
const isDateOrNull = (v: unknown) => v === null || isDate(v);
const WEIGHT = /^\d{1,4}( \d{1,4})?$/;
const RANGE = /^[Uu+0-9A-Fa-f?,\s-]{1,4000}$/;
const WOFF2_MAGIC = Buffer.from('wOF2');

async function head(path: string, n: number): Promise<Buffer> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Checks data.json and the files against Jot's rules (backup-spec.md §3.5 step 2). */
async function checkPersonal(filesDir: string, check: ArchiveCheck): Promise<Checked> {
  const { manifest, seen } = check;
  if (!seen.has('data.json')) fail('it has no data.json.');
  let raw: any;
  try {
    raw = JSON.parse(await readFile(join(filesDir, 'data.json'), 'utf8'));
  } catch {
    fail('its data.json cannot be read.');
  }
  if (!isObj(raw) || !Array.isArray(raw.notes) || !Array.isArray(raw.photos) || !Array.isArray(raw.fonts) || !Array.isArray(raw.styles)) {
    fail('its data.json is not in the expected shape.');
  }

  const fonts: BFont[] = [];
  const fontIds = new Set<string>();
  const families = new Set<string>();
  for (const f of raw.fonts) {
    if (!isObj(f) || !isId(f.id) || fontIds.has(f.id)) fail('a font has a missing or repeated id.');
    if (!isValidFamilyName(f.family)) fail('a font has an invalid family name.');
    if (families.has(f.family)) fail(`two fonts are both "${f.family}".`);
    if (typeof f.category !== 'string' || f.category.length > 100) fail(`font "${f.family}" has an invalid category.`);
    if (!Array.isArray(f.faces) || f.faces.length > 1000) fail(`font "${f.family}" has an invalid list of files.`);
    const files = new Set<string>();
    const faces: FontFace[] = [];
    for (const face of f.faces) {
      if (
        !isObj(face) ||
        (face.style !== 'normal' && face.style !== 'italic') ||
        typeof face.weight !== 'string' ||
        !WEIGHT.test(face.weight) ||
        !(face.unicodeRange === null || (typeof face.unicodeRange === 'string' && RANGE.test(face.unicodeRange))) ||
        typeof face.file !== 'string' ||
        !FONT_FILE.test(face.file) ||
        files.has(face.file)
      ) {
        fail(`font "${f.family}" has an invalid list of files.`);
      }
      files.add(face.file);
      faces.push({ style: face.style, weight: face.weight, unicodeRange: face.unicodeRange, file: face.file });
    }
    if (!isDateOrNull(f.archivedAt) || !isDate(f.createdAt)) fail(`font "${f.family}" has an invalid date.`);
    fontIds.add(f.id);
    families.add(f.family);
    fonts.push({ id: f.id, family: f.family, category: f.category, faces, archivedAt: f.archivedAt, createdAt: f.createdAt });
  }

  const photos: BPhoto[] = [];
  const photoIds = new Set<string>();
  for (const p of raw.photos) {
    if (!isObj(p) || !isId(p.id) || photoIds.has(p.id)) fail('a photo has a missing or repeated id.');
    if (typeof p.mime !== 'string' || !ACCEPTED_IMAGE_TYPES.has(p.mime as any)) fail('a photo has an unknown type.');
    if (!Number.isSafeInteger(p.size) || p.size < 0) fail('a photo has an invalid size.');
    if (typeof p.originalName !== 'string' || p.originalName.length > 255) fail('a photo has an invalid name.');
    if (!isDate(p.createdAt)) fail('a photo has an invalid date.');
    photoIds.add(p.id);
    photos.push({ id: p.id, mime: p.mime, size: p.size, originalName: p.originalName, createdAt: p.createdAt });
  }

  const styles: BStyle[] = [];
  const styleIds = new Set<string>();
  let skippedStyles = 0;
  for (const s of raw.styles) {
    if (!isObj(s) || !isId(s.id) || styleIds.has(s.id)) fail('a style has a missing or repeated id.');
    const r = validateStyleInput({
      name: s.name,
      fontId: s.fontId,
      size: s.size,
      bold: s.bold,
      italic: s.italic,
      underline: s.underline,
      strike: s.strike,
      textColor: s.textColor,
      highlight: s.highlight,
    });
    const label = typeof s.name === 'string' ? s.name.slice(0, 60) : '?';
    if (!r.ok) fail(`style "${label}": ${r.error}`);
    if (!fontIds.has(r.value.fontId)) fail(`style "${label}" uses a font that is not in the backup.`);
    if (!isDate(s.createdAt) || !isDate(s.updatedAt)) fail(`style "${label}" has an invalid date.`);
    if (s.isDefault !== undefined && typeof s.isDefault !== 'boolean') fail(`style "${label}" has an invalid default flag.`);
    styleIds.add(s.id);
    // Default styles are system styles: the account keeps its own, so the backup's are
    // skipped. Newer backups never hold them; older ones hold the starter styles as
    // ordinary styles, recognised like the migration does: a starter name, created
    // together with the account (= at the same moment as the backup's starter fonts).
    const starter = STARTER_STYLES.find((d) => d.name === r.value.name);
    const withAccount = starter && raw.fonts.some((f: any) => f.family === starter.font && f.createdAt === s.createdAt);
    if (s.isDefault === true || withAccount) {
      skippedStyles++;
      continue;
    }
    styles.push({ id: s.id, ...r.value, createdAt: s.createdAt, updatedAt: s.updatedAt });
  }
  // The default styles are rebuilt on the restored fonts, so the backup must have them.
  for (const family of STARTER_FONT_FAMILIES) if (!families.has(family)) fail(`it does not have the default font "${family}", which the default styles need.`);

  const missingNames = new Set(manifest.missing.map((m) => m.name));
  const notes: BNote[] = [];
  const noteIds = new Set<string>();
  const danglingUsed = new Set<string>();
  let adjusted = 0;
  for (const n of raw.notes) {
    if (!isObj(n) || !isId(n.id) || noteIds.has(n.id)) fail('a note has a missing or repeated id.');
    if (typeof n.title !== 'string') fail('a note has no title.');
    if (n.title.length > MAX_TITLE_LENGTH) fail(`a note title is longer than ${MAX_TITLE_LENGTH} characters.`);
    const label = (n.title || 'Untitled').slice(0, 60);
    // eslint-disable-next-line no-control-regex
    const title = n.title.replace(/[\u0000-\u001f\u007f]/g, ' ');
    let content: TiptapDoc;
    try {
      content = sanitizeDoc(n.content);
    } catch (err) {
      if (err instanceof ContentError) fail(`note "${label}" has content Jot cannot read.`);
      throw err;
    }
    if (title !== n.title || JSON.stringify(content) !== JSON.stringify(n.content)) adjusted++;
    if (!Array.isArray(n.tags) || n.tags.length > 1000) fail(`note "${label}" has an invalid list of tags.`);
    const tags = new Set<string>();
    for (const t of n.tags) {
      const r = normalizeTag(t);
      if (!r.ok || r.tag !== t || tags.has(t)) fail(`note "${label}" has an invalid tag ${JSON.stringify(String(t).slice(0, 40))}.`);
      tags.add(t);
    }
    if (!isDate(n.createdAt) || !isDate(n.updatedAt) || !isDateOrNull(n.deletedAt)) fail(`note "${label}" has an invalid date.`);
    // Backups made before read-only notes have no flag: those notes are writable.
    if (n.readOnly !== undefined && typeof n.readOnly !== 'boolean') fail(`note "${label}" has an invalid read-only flag.`);
    const readOnly = n.readOnly === true;
    if (readOnly && n.deletedAt !== null) fail(`note "${label}" is read-only and in the trash, which Jot never allows.`);
    for (const id of photoRefs(content)) {
      if (photoIds.has(id)) continue;
      if (missingNames.has(`photos/${id}`)) danglingUsed.add(`photos/${id}`);
      else fail(`note "${label}" uses a photo that is not in the backup.`);
    }
    noteIds.add(n.id);
    notes.push({ id: n.id, title, content, tags: [...tags], createdAt: n.createdAt, updatedAt: n.updatedAt, deletedAt: n.deletedAt, readOnly });
  }

  // The entries must be exactly the files the records point at, apart from listed missing ones.
  const expected = new Map<string, string>();
  for (const p of photos) expected.set(`photos/${p.id}`, `photo "${p.originalName || 'untitled'}"`);
  for (const f of fonts) for (const face of f.faces) expected.set(`fonts/${f.id}/${face.file}`, `a file of font "${f.family}"`);
  for (const name of seen.keys()) if (name !== 'data.json' && !expected.has(name)) fail(`it contains ${name}, which no record uses.`);
  for (const [name, what] of expected) if (!seen.has(name) && !missingNames.has(name)) fail(`it is missing ${what} (${name}).`);
  for (const name of missingNames) if (!expected.has(name) && !danglingUsed.has(name)) fail(`it lists ${name} as missing, but nothing uses it.`);

  const counts = { notes: notes.length, photos: photos.length, fonts: fonts.length, styles: styles.length };
  const mc = manifest.counts;
  if (!isObj(mc) || mc.notes !== counts.notes || mc.photos !== counts.photos || mc.fonts !== counts.fonts || mc.styles !== counts.styles + skippedStyles) {
    fail('its counts do not match its contents (it may be damaged).');
  }

  // Real photos and real fonts only.
  for (const p of photos) {
    const name = `photos/${p.id}`;
    if (!seen.has(name)) continue;
    const type = detectImageType(await head(join(filesDir, name), SNIFF_BYTES));
    if (!type) fail(`photo "${p.originalName || 'untitled'}" is not a JPEG, PNG, GIF or WebP image.`);
    p.mime = type;
    p.size = seen.get(name)!.size;
  }
  for (const f of fonts) {
    for (const face of f.faces) {
      const name = `fonts/${f.id}/${face.file}`;
      if (seen.has(name) && !(await head(join(filesDir, name), 4)).equals(WOFF2_MAGIC)) fail(`a file of font "${f.family}" is not a woff2 font.`);
    }
  }

  return {
    summary: { createdAt: manifest.createdAt, counts, adjustedNotes: adjusted, missing: manifest.missing.map((m) => ({ name: m.name, what: m.what })) },
    data: { notes, photos, fonts, styles },
    present: [...seen.keys()],
  };
}

/** Step 1 and 2: the upload goes to a staging folder and is checked. Nothing live is touched. */
export async function stageRestore(ctx: JotContext, userId: string, body: Readable): Promise<{ id: string; summary: RestoreSummary }> {
  const sweep = tryLock(ctx.dataDir);
  if (sweep) {
    try {
      await sweepStaging(ctx);
    } finally {
      sweep.release();
    }
  }
  const id = newId();
  const dir = stagingDir(ctx, userId, id);
  if (!dir) throw new BackupError('Not found.', 404);
  await mkdir(dir, { recursive: true });
  try {
    const upload = join(dir, 'upload.tar');
    await pipeline(body, createWriteStream(upload, { flags: 'wx', mode: 0o600 }));
    const files = join(dir, 'files');
    const check = await readArchive(upload, {
      format: PERSONAL_FORMAT,
      version: PERSONAL_VERSION,
      isEntry: isPersonalEntry,
      isMissingName: isPersonalMissingName,
      extract: (name) => (name === 'manifest.json' ? null : join(files, name)),
      afterEntry: async (i) => {
        if (i === 0) await failpoint('restore:during-check');
      },
    });
    await rm(upload);
    const checked = await checkPersonal(files, check);
    await writeFile(join(dir, 'checked.json'), JSON.stringify(checked), { flag: 'wx', mode: 0o600 });
    return { id, summary: checked.summary };
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}

/** `jot verify` of a personal backup: the same checks as a restore upload, in a scratch folder. */
export async function verifyPersonalFile(file: string, workDir: string): Promise<RestoreSummary> {
  const files = join(workDir, 'files');
  const check = await readArchive(file, {
    format: PERSONAL_FORMAT,
    version: PERSONAL_VERSION,
    isEntry: isPersonalEntry,
    isMissingName: isPersonalMissingName,
    extract: (name) => (name === 'manifest.json' ? null : join(files, name)),
  });
  return (await checkPersonal(files, check)).summary;
}

/** Cancels an upload. */
export async function cancelRestore(ctx: JotContext, userId: string, id: string): Promise<boolean> {
  const dir = stagingDir(ctx, userId, id);
  if (!dir || !existsSync(join(dir, 'checked.json'))) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}

// ------------------------------------------------------------------ restoring

const TIDY_PATH = /^users\/[A-Za-z0-9_-]{22}\/(?:photos|fonts)\/[A-Za-z0-9_-]{22}$/;

/**
 * Deletes every file listed in restore_files, then its row: the new files of a restore
 * that never committed, or the old files of one that did. The caller holds the lock (or
 * the server is starting, before it serves requests).
 */
export async function tidyUp(ctx: JotContext, duringFailpoint?: string): Promise<void> {
  const rows = ctx.db.prepare('SELECT path FROM restore_files ORDER BY path').all() as Array<{ path: string }>;
  if (rows.length === 0) return;
  const dirs = new Set<string>();
  let i = 0;
  for (const { path } of rows) {
    if (TIDY_PATH.test(path)) {
      const abs = join(ctx.dataDir, path);
      await rm(abs, { recursive: true, force: true });
      dirs.add(dirname(abs));
    }
    if (duringFailpoint && i++ === 0) await failpoint(duringFailpoint);
  }
  for (const d of dirs) if (existsSync(d)) await syncDir(d);
  const del = ctx.db.prepare('DELETE FROM restore_files WHERE path = ?');
  ctx.db.transaction(() => rows.forEach((r) => del.run(r.path)))();
}

/** At every server start: finish any interrupted tidy-up and delete what was left in staging. */
export async function tidyUpOnStart(ctx: JotContext, log: (msg: string) => void): Promise<void> {
  const lock = tryLock(ctx.dataDir);
  if (!lock) {
    log('Another backup or restore is running (from the CLI); tidy-up of interrupted restores is left for the next start or restore.');
    return;
  }
  try {
    await tidyUp(ctx);
    await rm(stagingRoot(ctx), { recursive: true, force: true });
  } finally {
    lock.release();
  }
}

/**
 * Steps 3 to 7. The caller has checked the confirmation text. `restoring` holds the ids of
 * users whose saves and uploads are refused while their restore runs.
 */
export async function confirmRestore(ctx: JotContext, userId: string, id: string, restoring: Set<string>): Promise<RestoreSummary> {
  const dir = stagingDir(ctx, userId, id);
  if (!dir || !existsSync(join(dir, 'checked.json'))) throw new BackupError('There is no such restore. Choose the backup file again.', 404);
  const lock = takeLock(ctx.dataDir);
  restoring.add(userId);
  try {
    await failpoint('restore:after-confirm');
    await tidyUp(ctx); // anything a crashed earlier restore left
    const checked: Checked = JSON.parse(await readFile(join(dir, 'checked.json'), 'utf8'));
    const present = new Set(checked.present);
    const files = join(dir, 'files');
    const udir = userDir(ctx, userId);

    // 4. Safety backup of the current data, kept on the server.
    const tmpSafety = join(dir, 'safety.tar');
    await writePersonalBackup(ctx, userId, tmpSafety, 'restore:during-safety-backup');
    const sdir = safetyDir(ctx, userId);
    await mkdir(sdir, { recursive: true });
    await link(tmpSafety, join(sdir, safetyBackupName(new Date())));
    await syncDir(sdir);
    await syncDir(udir);
    await failpoint('restore:after-safety-backup');

    // 5. New ids for everything; record the new file names, then write the files.
    const data = checked.data;
    const photoMap = new Map(data.photos.map((p) => [p.id, newId()]));
    const fontMap = new Map(data.fonts.map((f) => [f.id, newId()]));
    const newFiles = [
      ...data.photos.filter((p) => present.has(`photos/${p.id}`)).map((p) => `users/${userId}/photos/${photoMap.get(p.id)}`),
      ...data.fonts.map((f) => `users/${userId}/fonts/${fontMap.get(f.id)}`),
    ];
    const addNew = ctx.db.prepare("INSERT INTO restore_files (path, state, user_id) VALUES (?, 'new', ?)");
    ctx.db.transaction(() => newFiles.forEach((p) => addNew.run(p, userId)))();
    await failpoint('restore:after-new-file-list');

    const pdir = photosDir(ctx, userId);
    const fdir = fontsDir(ctx, userId);
    await mkdir(pdir, { recursive: true });
    await mkdir(fdir, { recursive: true });
    let written = 0;
    const wrote = async () => {
      if (written++ === 0) await failpoint('restore:during-new-files');
    };
    // link() never replaces an existing file; the staged copy becomes the new file.
    for (const p of data.photos) {
      if (!present.has(`photos/${p.id}`)) continue;
      const dest = join(pdir, photoMap.get(p.id)!);
      await link(join(files, 'photos', p.id), dest);
      await syncFile(dest);
      await wrote();
    }
    for (const f of data.fonts) {
      const d = join(fdir, fontMap.get(f.id)!);
      await mkdir(d);
      for (const face of f.faces) {
        if (!present.has(`fonts/${f.id}/${face.file}`)) continue;
        await link(join(files, 'fonts', f.id, face.file), join(d, face.file));
        await syncFile(join(d, face.file));
        await wrote();
      }
      await syncDir(d);
    }
    await syncDir(pdir);
    await syncDir(fdir);
    await syncDir(udir);
    await failpoint('restore:after-new-files');

    // 6. The switch: one transaction.
    switchData(ctx, userId, data, photoMap, fontMap);
    await failpoint('restore:after-commit');

    // 7. Tidy up: the old files, then the staging folder.
    await tidyUp(ctx, 'restore:during-tidy');
    await failpoint('restore:after-tidy');
    await rm(dir, { recursive: true, force: true });
    return checked.summary;
  } catch (err) {
    // An ordinary failure ends the same way recovery after a crash would.
    await tidyUp(ctx).catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  } finally {
    restoring.delete(userId);
    lock.release();
  }
}

function switchData(ctx: JotContext, userId: string, data: PersonalData, photoMap: Map<string, string>, fontMap: Map<string, string>) {
  const db = ctx.db;
  db.transaction(() => {
    const oldPhotos = db.prepare('SELECT id FROM photos WHERE user_id = ?').all(userId) as Array<{ id: string }>;
    const oldFonts = db.prepare('SELECT id FROM fonts WHERE user_id = ?').all(userId) as Array<{ id: string }>;
    // The account keeps its default styles; they move onto the restored copy of their font.
    const defaults = db
      .prepare('SELECT s.id, f.family FROM styles s JOIN fonts f ON f.id = s.font_id WHERE s.user_id = ? AND s.is_default = 1')
      .all(userId) as Array<{ id: string; family: string }>;
    db.pragma('defer_foreign_keys = ON'); // until the defaults point at the new fonts, below
    db.prepare('DELETE FROM styles WHERE user_id = ? AND is_default = 0').run(userId);
    for (const t of ['notes_fts', 'note_tags', 'notes', 'tags', 'photos', 'fonts']) {
      db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
    }
    const insFont = db.prepare('INSERT INTO fonts (id, user_id, family, category, faces, archived_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const f of data.fonts) insFont.run(fontMap.get(f.id), userId, f.family, f.category, JSON.stringify(f.faces), f.archivedAt, f.createdAt);
    const insPhoto = db.prepare('INSERT INTO photos (id, user_id, mime, size, original_name, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const p of data.photos) insPhoto.run(photoMap.get(p.id), userId, p.mime, p.size, p.originalName, p.createdAt);
    const repoint = db.prepare('UPDATE styles SET font_id = (SELECT id FROM fonts WHERE user_id = ? AND family = ?) WHERE id = ?');
    for (const d of defaults) repoint.run(userId, d.family, d.id);
    ensureDefaultStyles(db, userId, new Date().toISOString());
    const insStyle = db.prepare(
      `INSERT INTO styles (id, user_id, name, font_id, size, bold, italic, underline, strike, text_color, highlight, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const s of data.styles) {
      insStyle.run(newId(), userId, s.name, fontMap.get(s.fontId), s.size, +s.bold, +s.italic, +s.underline, +s.strike, s.textColor, s.highlight, s.createdAt, s.updatedAt);
    }
    const tagIds = new Map<string, string>();
    const insTag = db.prepare('INSERT INTO tags (id, user_id, name) VALUES (?, ?, ?)');
    const insNote = db.prepare(
      'INSERT INTO notes (id, user_id, title, content, body_text, created_at, updated_at, deleted_at, read_only) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insLink = db.prepare('INSERT INTO note_tags (note_id, tag_id, user_id) VALUES (?, ?, ?)');
    for (const n of data.notes) {
      const id = newId();
      const content = remapPhotoRefs(n.content, photoMap);
      insNote.run(id, userId, n.title, JSON.stringify(content), docText(content), n.createdAt, n.updatedAt, n.deletedAt, n.readOnly ? 1 : 0);
      for (const t of n.tags) {
        if (!tagIds.has(t)) {
          tagIds.set(t, newId());
          insTag.run(tagIds.get(t), userId, t);
        }
        insLink.run(id, tagIds.get(t), userId);
      }
      reindexNote(db, id);
    }
    db.prepare("DELETE FROM restore_files WHERE state = 'new' AND user_id = ?").run(userId);
    const addOld = db.prepare("INSERT INTO restore_files (path, state, user_id) VALUES (?, 'old', ?)");
    for (const p of oldPhotos) addOld.run(`users/${userId}/photos/${p.id}`, userId);
    for (const f of oldFonts) addOld.run(`users/${userId}/fonts/${f.id}`, userId);
    failpointSync('restore:before-commit');
  })();
}

// ------------------------------------------------------------------ safety backups

export async function listSafetyBackups(ctx: JotContext, userId: string) {
  const dir = safetyDir(ctx, userId);
  if (!existsSync(dir)) return [];
  const out: Array<{ name: string; size: number; createdAt: string }> = [];
  for (const name of await readdir(dir)) {
    if (!SAFETY_NAME.test(name)) continue;
    const st = await stat(join(dir, name)).catch(() => null);
    if (st?.isFile()) out.push({ name, size: st.size, createdAt: timeFromName(name) ?? st.mtime.toISOString() });
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

export function safetyBackupPath(ctx: JotContext, userId: string, name: string): string | null {
  if (!isId(userId) || !SAFETY_NAME.test(name)) return null;
  const p = join(safetyDir(ctx, userId), name);
  return existsSync(p) ? p : null;
}
