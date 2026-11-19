// Helpers for the backup and restore tests.
//
//  - accountSnapshot: everything a user owns, read straight from the database and the
//    files, with identifiers left out (a restore gives everything new ids), so "same
//    data" can be compared exactly.
//  - strayFiles: files in a user's folder that no record points to, leftover staging,
//    and unfinished tidy-up rows.
//  - A tar reader/writer written independently of Jot's, for crafting bad backups.
//  - Running Jot's server and CLI as real child processes (for crash tests).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import type { DB } from '../../src/server/db';
import type { Client, Res } from './setup';

export const ROOT = resolve(__dirname, '../..');
export const TAR = 'application/x-tar';

export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const fileSha = (p: string) => (existsSync(p) ? sha256(readFileSync(p)) : null);

// ------------------------------------------------------------------ snapshots

/** Everything the user owns, without ids. Equal snapshots mean equal data. */
export function accountSnapshot(db: DB, dataDir: string, userId: string) {
  const udir = join(dataDir, 'users', userId);
  const photos = db.prepare('SELECT * FROM photos WHERE user_id = ?').all(userId) as any[];
  const photoKey = new Map<string, string>();
  for (const p of photos) photoKey.set(p.id, `${fileSha(join(udir, 'photos', p.id))}|${p.original_name}|${p.created_at}`);
  const swapPhotos = (json: string) =>
    json.replace(/\/api\/photos\/([A-Za-z0-9_-]+)/g, (_m, id) => `photo:${photoKey.get(id) ?? 'not-a-photo-of-this-user'}`);

  const notes = (db.prepare('SELECT * FROM notes WHERE user_id = ?').all(userId) as any[]).map((n) => ({
    title: n.title,
    content: JSON.parse(swapPhotos(n.content)),
    bodyText: n.body_text,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
    deletedAt: n.deleted_at,
    readOnly: !!n.read_only,
    tags: (
      db
        .prepare('SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? ORDER BY t.name')
        .all(n.id) as any[]
    ).map((t) => t.name),
  }));
  const fonts = (db.prepare('SELECT * FROM fonts WHERE user_id = ?').all(userId) as any[]).map((f) => {
    const faces = JSON.parse(f.faces) as Array<{ file: string }>;
    return {
      family: f.family,
      category: f.category,
      faces,
      archivedAt: f.archived_at,
      createdAt: f.created_at,
      files: Object.fromEntries(faces.map((face) => [face.file, fileSha(join(udir, 'fonts', f.id, face.file))])),
    };
  });
  const styles = (
    db.prepare('SELECT s.*, f.family FROM styles s JOIN fonts f ON f.id = s.font_id WHERE s.user_id = ?').all(userId) as any[]
  ).map(({ id: _id, user_id: _u, font_id: _f, ...rest }) => rest);
  const tags = (db.prepare('SELECT name FROM tags WHERE user_id = ? ORDER BY name').all(userId) as any[]).map((t) => t.name);
  const fts = (db.prepare('SELECT title, body, tags FROM notes_fts WHERE user_id = ?').all(userId) as any[]).map((r) => ({ ...r }));
  const sortBy = <T>(xs: T[]) => xs.map((x) => JSON.stringify(x)).sort();
  return {
    notes: sortBy(notes),
    photos: sortBy(photos.map((p) => ({ mime: p.mime, size: p.size, name: p.original_name, createdAt: p.created_at, sha: fileSha(join(udir, 'photos', p.id)) }))),
    fonts: sortBy(fonts),
    styles: sortBy(styles),
    tags,
    fts: sortBy(fts),
  };
}

/** Files and rows a finished (or tidied-up) restore must not leave behind. */
export function strayFiles(db: DB, dataDir: string, userId: string): string[] {
  const out: string[] = [];
  const udir = join(dataDir, 'users', userId);
  const photoIds = new Set((db.prepare('SELECT id FROM photos WHERE user_id = ?').all(userId) as any[]).map((r) => r.id));
  const fonts = new Map(
    (db.prepare('SELECT id, faces FROM fonts WHERE user_id = ?').all(userId) as any[]).map((r) => [
      r.id,
      new Set((JSON.parse(r.faces) as any[]).map((f) => f.file)),
    ]),
  );
  const pdir = join(udir, 'photos');
  if (existsSync(pdir)) for (const f of readdirSync(pdir)) if (!photoIds.has(f)) out.push(`photos/${f}`);
  const fdir = join(udir, 'fonts');
  if (existsSync(fdir)) {
    for (const d of readdirSync(fdir)) {
      const files = fonts.get(d);
      if (!files) {
        out.push(`fonts/${d}/`);
        continue;
      }
      for (const f of readdirSync(join(fdir, d))) if (!files.has(f)) out.push(`fonts/${d}/${f}`);
    }
  }
  const staging = join(dataDir, 'staging');
  if (existsSync(staging)) for (const f of walk(staging)) out.push(`staging/${f}`);
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'restore_files'").get();
  if (hasTable) for (const r of db.prepare('SELECT path, state FROM restore_files').all() as any[]) out.push(`restore_files row: ${r.state} ${r.path}`);
  return out;
}

/** Every file under dir, relative to it. */
export function walk(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(join(dir, e.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

/** sha256 of every file under dir (relative path -> hash). */
export function treeHashes(dir: string): Record<string, string> {
  return Object.fromEntries(walk(dir).map((f) => [f, sha256(readFileSync(join(dir, f)))]));
}

// ------------------------------------------------------------------ personal backup over the API

export async function takeBackup(c: Client): Promise<{ info: any; file: Buffer }> {
  const made = await c.post('/api/backup', {});
  if (made.status !== 201) throw new Error(`backup failed: ${made.status} ${made.body}`);
  const info = made.json.backup;
  const dl = await c.get(`/api/backup/${info.id}`);
  if (dl.status !== 200) throw new Error(`download failed: ${dl.status} ${dl.body}`);
  return { info, file: dl.rawPayload };
}

export const stage = (c: Client, file: Buffer): Promise<Res> => c.raw('/api/restore', file, TAR);

export async function restore(c: Client, file: Buffer): Promise<{ staged: Res; done: Res }> {
  const staged = await stage(c, file);
  if (staged.status !== 201) return { staged, done: staged };
  const done = await c.post(`/api/restore/${staged.json.restore.id}/confirm`, { confirm: 'RESTORE' });
  return { staged, done };
}

// ------------------------------------------------------------------ an independent tar implementation
// Jot's archives are POSIX ustar with fixed field formats (see src/server/backup/tar.ts).

export interface TarEntry {
  name: string;
  data: Buffer;
  type?: string;
  linkname?: string;
  mtime?: number;
}

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, '0') + '\0';
}

export function tarHeader(e: TarEntry): Buffer {
  const h = Buffer.alloc(512);
  h.write(e.name, 0, 100, 'utf8');
  h.write(octal(0o600, 8), 100, 'latin1');
  h.write(octal(0, 8), 108, 'latin1');
  h.write(octal(0, 8), 116, 'latin1');
  h.write(octal(e.data.length, 12), 124, 'latin1');
  h.write(octal(e.mtime ?? 1700000000, 12), 136, 'latin1');
  h.write('        ', 148, 'latin1');
  h.write(e.type ?? '0', 156, 'latin1');
  if (e.linkname) h.write(e.linkname, 157, 100, 'utf8');
  h.write('ustar\0', 257, 'latin1');
  h.write('00', 263, 'latin1');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'latin1');
  return h;
}

export function makeTar(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    parts.push(tarHeader(e), e.data, Buffer.alloc((512 - (e.data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

export function parseTar(buf: Buffer): TarEntry[] {
  const out: TarEntry[] = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(h.subarray(124, 136).toString('latin1'), 8);
    const mtime = parseInt(h.subarray(136, 148).toString('latin1'), 8);
    const type = String.fromCharCode(h[156]);
    off += 512;
    out.push({ name, data: Buffer.from(buf.subarray(off, off + size)), type, mtime });
    off += Math.ceil(size / 512) * 512;
  }
  return out;
}

/** Seals a manifest the way Jot does: `check` is the SHA-256 of the rest, as compact JSON. */
export function seal(manifest: any): Buffer {
  const { check: _old, ...rest } = manifest;
  return Buffer.from(JSON.stringify({ ...rest, check: sha256(JSON.stringify(rest)) }));
}

export interface OpenedBackup {
  entries: TarEntry[]; // everything except manifest.json
  manifest: any;
  data: any | null; // parsed data.json (personal backups)
}

export function openBackup(file: Buffer): OpenedBackup {
  const all = parseTar(file);
  const m = all.find((e) => e.name === 'manifest.json');
  const d = all.find((e) => e.name === 'data.json');
  return {
    entries: all.filter((e) => e.name !== 'manifest.json'),
    manifest: m ? JSON.parse(m.data.toString('utf8')) : null,
    data: d ? JSON.parse(d.data.toString('utf8')) : null,
  };
}

/**
 * Rebuilds a backup after a test changed it. By default data.json is rewritten from
 * `data`, the manifest's entry list is recomputed from the entries, and the manifest
 * is resealed, so the result is a well-formed backup unless the test says otherwise.
 */
export function packBackup(b: OpenedBackup, opts: { rehash?: boolean; reseal?: boolean } = {}): Buffer {
  const entries = b.entries.map((e) => (e.name === 'data.json' && b.data ? { ...e, data: Buffer.from(JSON.stringify(b.data)) } : e));
  const manifest = { ...b.manifest };
  if (opts.rehash !== false) {
    manifest.entries = entries.map((e) => ({ name: e.name, size: e.data.length, sha256: sha256(e.data) }));
  }
  const mdata = opts.reseal === false ? Buffer.from(JSON.stringify(manifest)) : seal(manifest);
  return makeTar([...entries, { name: 'manifest.json', data: mdata, mtime: entries[0]?.mtime }]);
}

// ------------------------------------------------------------------ child processes

export async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as any).port;
      s.close(() => res(port));
    });
    s.on('error', rej);
  });
}

export interface ServerProcess {
  url: string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  output: () => string;
  stop(): Promise<void>;
}

/** Runs Jot's real server (src/server/main.ts) as a child process on its own port. */
export async function startServer(dataDir: string, env: Record<string, string> = {}): Promise<ServerProcess> {
  const port = await freePort();
  const proc = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'src/server/main.ts')], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (out += d));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) =>
    proc.on('exit', (code, signal) => res({ code, signal })),
  );
  let gone = false;
  void exited.then(() => (gone = true));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  for (;;) {
    if (gone) throw new Error(`server exited during start:\n${out}`);
    try {
      if ((await fetch(`${url}/api/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server did not start:\n${out}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url,
    exited,
    output: () => out,
    async stop() {
      if (!gone) {
        proc.kill('SIGTERM');
        await exited;
      }
    },
  };
}

export interface HttpRes {
  status: number;
  json: any;
  body: Buffer;
}

/** A fetch-based client with a cookie, for servers running in child processes. */
export function httpClient(base: string) {
  let cookie = '';
  const req = async (method: string, path: string, body?: Buffer | string, type?: string): Promise<HttpRes> => {
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;
    if (type) headers['content-type'] = type;
    const r = await fetch(base + path, { method, headers, body: body as BodyInit | undefined });
    const set = r.headers.get('set-cookie');
    const m = set && /^(jot_session=[^;]+)/.exec(set);
    if (m) cookie = m[1];
    const raw = Buffer.from(await r.arrayBuffer());
    let json: any;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch {
      json = undefined;
    }
    return { status: r.status, json, body: raw };
  };
  return {
    login: async (username: string, password: string) => {
      const r = await req('POST', '/api/login', JSON.stringify({ username, password }), 'application/json');
      if (r.status !== 200) throw new Error(`login ${r.status}`);
    },
    get: (p: string) => req('GET', p),
    post: (p: string, b: unknown = {}) => req('POST', p, JSON.stringify(b), 'application/json'),
    patch: (p: string, b: unknown) => req('PATCH', p, JSON.stringify(b), 'application/json'),
    del: (p: string) => req('DELETE', p),
    raw: (p: string, b: Buffer, type = TAR) => req('POST', p, b, type),
  };
}

export interface CliResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  out: string;
  err: string;
}

/** Runs the jot CLI as a child process without blocking this process's event loop. */
export function runCli(dataDir: string, args: string[], opts: { input?: string; env?: Record<string, string> } = {}): Promise<CliResult> {
  return new Promise((res) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'src/cli/main.ts'), ...args], {
      cwd: ROOT,
      env: { ...process.env, DATA_DIR: dataDir, JOT_APP_URLS: 'http://127.0.0.1:1', ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.stdin.end(opts.input ?? '');
    proc.on('exit', (code, signal) => res({ code, signal, out, err }));
  });
}

export const fileSize = (p: string) => statSync(p).size;
