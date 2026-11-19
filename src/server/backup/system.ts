// Full system backup, verify and restore (backup-spec.md §4), run by the CLI.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { link, mkdir, mkdtemp, open, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_VERSION } from '../db';
import { syncDir, syncFile } from '../durable';
import { FONT_FILE } from '../fonts';
import { isId, newId } from '../ids';
import { readArchive, type MissingFile } from './archive';
import { BackupError } from './errors';
import { failpoint } from './failpoint';
import { LOCK_FILE, takeLock } from './lock';
import { sealManifest } from './manifest';
import { isSystemEntry, systemBackupName } from './names';
import { verifyPersonalFile } from './personal';
import { TarWriter } from './tar';

export const SYSTEM_FORMAT = 'jot-system-backup';
export const SYSTEM_VERSION = 1;

export interface SystemCounts {
  users: number;
  notes: number;
  photos: number;
  fonts: number;
  styles: number;
}

interface DbFile {
  name: string; // entry name, which is also the path under the data folder
  what: string;
}

/** The files a Jot database points at, and its counts. Ids and file names are checked before use. */
function listDatabase(db: Database.Database): { files: DbFile[]; counts: SystemCounts } {
  const users = new Map((db.prepare('SELECT id, username FROM users').all() as any[]).map((u) => [u.id, u.username]));
  const files: DbFile[] = [];
  const bad = () => {
    throw new BackupError('The database holds an id or file name Jot would never write; it may be damaged.');
  };
  for (const p of db.prepare('SELECT id, user_id, original_name FROM photos ORDER BY user_id, id').all() as any[]) {
    if (!isId(p.id) || !isId(p.user_id)) bad();
    files.push({ name: `users/${p.user_id}/photos/${p.id}`, what: `Photo "${p.original_name || 'untitled'}" of user ${users.get(p.user_id) ?? '?'}` });
  }
  for (const f of db.prepare('SELECT id, user_id, family, faces FROM fonts ORDER BY user_id, id').all() as any[]) {
    if (!isId(f.id) || !isId(f.user_id)) bad();
    let faces: Array<{ file: string }>;
    try {
      faces = JSON.parse(f.faces);
    } catch {
      return bad();
    }
    for (const face of faces) {
      if (!FONT_FILE.test(face?.file)) bad();
      files.push({ name: `users/${f.user_id}/fonts/${f.id}/${face.file}`, what: `Font "${f.family}" (file ${face.file}) of user ${users.get(f.user_id) ?? '?'}` });
    }
  }
  const n = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return { files, counts: { users: n('users'), notes: n('notes'), photos: n('photos'), fonts: n('fonts'), styles: n('styles') } };
}

async function fileSha256(path: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) h.update(chunk);
  return h.digest('hex');
}

async function exists(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** True when `child` is `parent` or inside it. */
function inside(child: string, parent: string) {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p + '/');
}

const PARTIAL = /^\.jot-backup-[0-9A-Za-z_-]+\.(?:tar|db)\.partial$/;

export interface SystemBackupResult {
  file: string;
  sha256: string;
  counts: SystemCounts;
  missing: MissingFile[];
  sameDisk: boolean;
}

/** `jot backup`: a full backup of the data folder, checked with verify before it reports success. */
export async function createSystemBackup(dataDir: string, outDir: string): Promise<SystemBackupResult> {
  const lock = takeLock(dataDir);
  try {
    await mkdir(outDir, { recursive: true, mode: 0o700 });
    // Pieces of a backup that was killed part-way.
    for (const f of await readdir(outDir)) if (PARTIAL.test(f)) await rm(join(outDir, f), { force: true });

    const tag = newId();
    const dbCopy = join(outDir, `.jot-backup-${tag}.db.partial`);
    const partial = join(outDir, `.jot-backup-${tag}.tar.partial`);
    try {
      // 1. One consistent copy of the database, including saves still in the WAL.
      const live = new Database(join(dataDir, 'jot.db'), { fileMustExist: true });
      try {
        const v = live.pragma('user_version', { simple: true }) as number;
        if (v > SCHEMA_VERSION) throw new BackupError(`The database (version ${v}) is newer than this Jot (${SCHEMA_VERSION}).`);
        live.prepare('VACUUM INTO ?').run(dbCopy);
      } finally {
        live.close();
      }
      await failpoint('backup:after-db-copy');

      // 2. Sessions out; integrity check. 3. The files to include come from the copy.
      const copy = new Database(dbCopy);
      let schemaVersion: number;
      let listing: ReturnType<typeof listDatabase>;
      try {
        copy.exec('DELETE FROM sessions');
        if (copy.prepare("SELECT 1 FROM sqlite_master WHERE name = 'restore_files'").get()) copy.exec('DELETE FROM restore_files');
        copy.exec('VACUUM'); // the deleted rows are gone from the file too
        copy.pragma('journal_mode = DELETE');
        const ok = copy.pragma('integrity_check', { simple: true });
        if (ok !== 'ok') throw new BackupError(`The database copy failed SQLite's integrity check: ${ok}`);
        schemaVersion = copy.pragma('user_version', { simple: true }) as number;
        listing = listDatabase(copy);
      } finally {
        copy.close();
      }

      // 4. The archive: jot.db, the users' files, then the manifest.
      const w = await TarWriter.create(partial);
      const entries: Array<{ name: string; size: number; sha256: string }> = [];
      const missing: MissingFile[] = [];
      let sha: string;
      try {
        entries.push({ name: 'jot.db', ...(await w.addFile('jot.db', dbCopy)) });
        let copied = 0;
        for (const f of listing.files) {
          const src = join(dataDir, f.name);
          if (!(await exists(src))) {
            missing.push({ name: f.name, what: f.what });
            continue;
          }
          entries.push({ name: f.name, ...(await w.addFile(f.name, src)) });
          if (copied++ === 0) await failpoint('backup:during-files');
        }
        const manifest = {
          format: SYSTEM_FORMAT,
          version: SYSTEM_VERSION,
          schemaVersion,
          createdAt: new Date().toISOString(),
          counts: listing.counts,
          entries,
          missing,
        };
        await w.addBuffer('manifest.json', sealManifest(manifest));
        sha = await w.finish();
      } catch (err) {
        await w.abort();
        throw err;
      }
      await rm(dbCopy, { force: true });

      // Name it, write the .sha256 beside it, force both to disk.
      let name = systemBackupName(new Date());
      for (let i = 2; existsSync(join(outDir, name)); i++) name = systemBackupName(new Date()).replace(/\.tar$/, `-${i}.tar`);
      const file = join(outDir, name);
      await link(partial, file); // never replaces an existing file
      await unlink(partial);
      await writeFile(`${file}.sha256`, `${sha}  ${name}\n`, { flag: 'wx', mode: 0o600 });
      await syncFile(file);
      await syncFile(`${file}.sha256`);
      await syncDir(outDir);

      // 5. Checked with verify before reporting success.
      await verifyBackup(file);
      return { file, sha256: sha, counts: listing.counts, missing, sameDisk: inside(outDir, dataDir) };
    } finally {
      await rm(dbCopy, { force: true });
      await rm(partial, { force: true });
    }
  } finally {
    lock.release();
  }
}

export interface VerifyResult {
  kind: 'system' | 'personal';
  createdAt: string;
  counts: { users?: number; notes: number; photos: number; fonts: number; styles: number };
  missing: MissingFile[];
  sha256File: 'matched' | 'absent';
}

/** Reads the first entry name, to tell the two kinds of backup apart. */
async function firstEntryName(file: string): Promise<string | null> {
  const fh = await open(file, 'r');
  try {
    const h = Buffer.alloc(100);
    const { bytesRead } = await fh.read(h, 0, 100, 0);
    const nul = h.indexOf(0);
    return h.subarray(0, nul >= 0 ? Math.min(nul, bytesRead) : bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

async function checkSidecar(file: string): Promise<'matched' | 'absent'> {
  const side = `${file}.sha256`;
  if (!existsSync(side)) return 'absent';
  const m = /^([0-9a-f]{64}) [ *](.+)\n?$/.exec(await readFile(side, 'utf8'));
  if (!m) throw new BackupError(`${basename(side)} is not a SHA-256 checksum file.`);
  if (m[1] !== (await fileSha256(file))) throw new BackupError(`This backup does not match ${basename(side)}: it is damaged.`);
  return 'matched';
}

/** `jot verify`: checks a backup completely without changing anything. */
export async function verifyBackup(file: string): Promise<VerifyResult> {
  if (!(await exists(file))) throw new BackupError(`No such file: ${file}`);
  const sha256File = await checkSidecar(file);
  const work = await mkdtemp(join(tmpdir(), 'jot-verify-'));
  try {
    const first = await firstEntryName(file);
    if (first === 'data.json') {
      const r = await verifyPersonalFile(file, work);
      return { kind: 'personal', createdAt: r.createdAt, counts: { ...r.counts }, missing: r.missing, sha256File };
    }
    const r = await checkSystemArchive(file, (name) => (name === 'jot.db' ? join(work, 'jot.db') : null));
    return { kind: 'system', createdAt: r.createdAt, counts: { ...r.counts }, missing: r.missing, sha256File };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Reads a system backup (extracting what `extract` says), checks it against its manifest,
 * and checks the database inside: integrity, version, and that the entries are exactly
 * the files its records point at, apart from the ones listed as missing.
 */
async function checkSystemArchive(file: string, extract: (name: string) => string | null, afterEntry?: (i: number) => Promise<void>, onExtracted?: (p: string) => void) {
  let dbPath: string | null = null;
  const check = await readArchive(file, {
    format: SYSTEM_FORMAT,
    version: SYSTEM_VERSION,
    isEntry: isSystemEntry,
    extract: (name) => {
      const dest = extract(name);
      if (name === 'jot.db') dbPath = dest;
      return dest;
    },
    afterEntry,
    onExtracted,
  });
  const m = check.manifest;
  if (!Number.isInteger(m.schemaVersion) || m.schemaVersion < 1) throw new BackupError('This backup is damaged: its database version is missing.');
  if (m.schemaVersion > SCHEMA_VERSION) throw new BackupError(`This backup's database (version ${m.schemaVersion}) is newer than this Jot (${SCHEMA_VERSION}).`);
  if (!check.seen.has('jot.db') || check.order[0] !== 'jot.db' || !dbPath) throw new BackupError('This backup has no database (jot.db).');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  let listing: ReturnType<typeof listDatabase>;
  try {
    let ok: unknown;
    try {
      ok = db.pragma('integrity_check', { simple: true });
    } catch {
      ok = 'not a database';
    }
    if (ok !== 'ok') throw new BackupError(`The database in this backup failed SQLite's integrity check (${String(ok)}).`);
    const v = db.pragma('user_version', { simple: true }) as number;
    if (v !== m.schemaVersion) throw new BackupError('This backup is damaged: its database version does not match its manifest.');
    listing = listDatabase(db);
  } finally {
    db.close();
  }
  const missingNames = new Set(m.missing.map((x) => x.name));
  const expected = new Set(listing.files.map((f) => f.name));
  for (const name of check.seen.keys()) if (name !== 'jot.db' && !expected.has(name)) throw new BackupError(`This backup contains ${name}, which no record uses.`);
  for (const f of listing.files) if (!check.seen.has(f.name) && !missingNames.has(f.name)) throw new BackupError(`This backup is missing ${f.what} (${f.name}).`);
  for (const name of missingNames) if (!expected.has(name)) throw new BackupError(`This backup lists ${name} as missing, but no record uses it.`);
  const mc = m.counts ?? {};
  for (const k of Object.keys(listing.counts) as Array<keyof SystemCounts>) {
    if (mc[k] !== listing.counts[k]) throw new BackupError('This backup is damaged: its counts do not match its database.');
  }
  return { createdAt: m.createdAt, counts: listing.counts, missing: m.missing, files: listing.files };
}

/** Is a Jot server answering at any of these addresses? */
export async function appIsRunning(urls: string[]): Promise<string | null> {
  for (const url of urls) {
    try {
      const r = await fetch(`${url.replace(/\/$/, '')}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok && ((await r.json()) as any)?.ok === true) return url;
    } catch {
      /* nothing there */
    }
  }
  return null;
}

const ALLOWED_IN_EMPTY = new Set(['backups', LOCK_FILE]);

async function leftovers(dataDir: string): Promise<string[]> {
  if (!existsSync(dataDir)) return [];
  return (await readdir(dataDir)).filter((e) => !ALLOWED_IN_EMPTY.has(e));
}

/** `jot restore`: rebuilds the system from a backup, into an empty data folder, with the app stopped. */
export async function restoreSystemBackup(dataDir: string, file: string, appUrls: string[]) {
  const running = await appIsRunning(appUrls);
  if (running) throw new BackupError(`Jot is running (it answers at ${running}). Stop it first: docker compose stop app`);
  const before = await leftovers(dataDir);
  if (before.length) {
    throw new BackupError(
      `The data folder is not empty (it has ${before.slice(0, 5).join(', ')}${before.length > 5 ? ', …' : ''}). Move the old data folder aside and create an empty one; a backups folder may stay.`,
    );
  }
  await mkdir(dataDir, { recursive: true });
  const lock = takeLock(dataDir);
  try {
    if ((await leftovers(dataDir)).length) throw new BackupError('The data folder is not empty.');
    // 2. Check the backup as verify does.
    const info = await verifyBackup(file);
    if (info.kind !== 'system') throw new BackupError('This is a personal backup. Restore it in the web app, on the Account page.');

    // 3. Extract into the data folder, every file created fresh, then force it all to disk.
    const extracted: string[] = [];
    try {
      const r = await checkSystemArchive(
        file,
        (name) => join(dataDir, name),
        async (i) => {
          if (i === 1) await failpoint('system-restore:during-extract');
        },
        (p) => extracted.push(p),
      );
      const root = resolve(dataDir);
      const dirs = new Set<string>([root]);
      for (const p of extracted) {
        await syncFile(p);
        for (let d = resolve(dirname(p)); d.startsWith(root + '/'); d = dirname(d)) dirs.add(d);
      }
      for (const d of [...dirs].sort((a, b) => b.length - a.length)) await syncDir(d);
      // Every record's file is present, apart from those listed as missing.
      const missingNames = new Set(r.missing.map((x) => x.name));
      for (const f of r.files) {
        if (!missingNames.has(f.name) && !(await exists(join(dataDir, f.name)))) throw new BackupError(`After extracting, ${f.name} is not there.`);
      }
      return { createdAt: r.createdAt, counts: r.counts, missing: r.missing };
    } catch (err) {
      // Remove what was extracted; never the backups folder.
      for (const e of ['jot.db', 'jot.db-journal', 'jot.db-wal', 'jot.db-shm', 'users']) await rm(join(dataDir, e), { recursive: true, force: true });
      throw err;
    }
  } finally {
    lock.release();
  }
}

