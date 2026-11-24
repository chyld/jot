// Type 5 (CLI): full system backup, verify and restore (backup-spec.md §4, §7).
// The CLI runs as a real child process next to a running app on the same data folder.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app';
import { tryLock } from '../../src/server/backup/lock';
import { SCHEMA_VERSION } from '../../src/server/db';
import { doc, login, makeTestEnv, newUser, PASSWORD, PNG_1PX, type Client, type TestEnv } from '../helpers/setup';
import { openBackup, packBackup, parseTar, runCli, sha256, treeHashes, walk } from '../helpers/backup';

let env: TestEnv;
let alice: Client;
let bob: Client;
let carol: Client;
const scratch: string[] = [];

function tmp(name: string) {
  const d = mkdtempSync(join(tmpdir(), `jot-${name}-`));
  scratch.push(d);
  return d;
}

/** An empty data folder with the backup copied into its backups folder, as the owner would set it up. */
function emptyDataWith(file: string) {
  const d = tmp('restore');
  mkdirSync(join(d, 'backups'));
  cpSync(file, join(d, 'backups', basename(file)));
  return { dir: d, file: join(d, 'backups', basename(file)) };
}

// Turns a current database back into a version 1 one: no restore_files, no read_only, no manual notes.
function makeVersion1(db: Database.Database) {
  for (const m of db.prepare("SELECT id FROM notes WHERE title = 'User manual' AND read_only = 1").all() as any[]) {
    db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(m.id);
    db.prepare('DELETE FROM notes WHERE id = ?').run(m.id);
  }
  db.exec("DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM note_tags nt WHERE nt.tag_id = tags.id)");
  db.exec('ALTER TABLE notes DROP COLUMN read_only');
  db.exec('ALTER TABLE styles DROP COLUMN is_default');
  db.exec('DROP INDEX IF EXISTS notes_bot_request');
  for (const c of ['inbox', 'bot_name', 'bot_request_id']) db.exec(`ALTER TABLE notes DROP COLUMN ${c}`);
  db.exec('DROP TABLE IF EXISTS bot_tokens');
  db.exec('DROP TABLE IF EXISTS style_buttons');
  db.exec('ALTER TABLE notes DROP COLUMN section_id');
  db.exec('DROP TABLE IF EXISTS sections');
  db.exec('DROP TABLE IF EXISTS restore_files');
  db.pragma('user_version = 1');
}

// bot_tokens: full system backups carry the bots' tokens (agent-spec.md §2); sections and style_buttons ride along unchanged.
const TABLES = ['users', 'notes', 'tags', 'note_tags', 'photos', 'fonts', 'styles', 'bot_tokens', 'sections', 'style_buttons'];
function dump(dbFile: string) {
  const db = new Database(dbFile, { readonly: true });
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) out[t] = db.prepare(`SELECT * FROM ${t}`).all().map((r) => JSON.stringify(r)).sort();
  out.notes_fts = db.prepare('SELECT note_id, user_id, title, body, tags FROM notes_fts').all().map((r) => JSON.stringify(r)).sort();
  out.sessions = db.prepare('SELECT * FROM sessions').all();
  db.close();
  return out;
}

async function backup(args: string[] = []) {
  const r = await runCli(env.dataDir, ['backup', ...args]);
  expect(r.code, r.err + r.out).toBe(0);
  const file = /Backup written: (\S+)/.exec(r.out)?.[1];
  expect(file, r.out).toBeTruthy();
  return { ...r, file: file! };
}

beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
  bob = await newUser(env, 'bob');
  carol = await newUser(env, 'carol');
  for (const [c, word] of [
    [alice, 'apple'],
    [bob, 'banana'],
    [carol, 'cherry'],
  ] as const) {
    const p = (await c.upload('/api/photos', `${word}.png`, PNG_1PX, 'image/png')).json.photo;
    const n = (await c.post('/api/notes', { title: word, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: word }] }, { type: 'image', attrs: { src: p.url } }] } })).json.note;
    await c.post(`/api/notes/${n.id}/tags`, { tag: word });
    const t = (await c.post('/api/notes', { title: `${word} trashed`, content: doc('bin') })).json.note;
    await c.del(`/api/notes/${t.id}`);
  }
  await alice.post('/api/fonts', { family: 'Roboto Slab' });
  expect((await alice.post('/api/bots', { name: 'Grok' })).status).toBe(201);
  const aliceQuote = (await alice.get('/api/styles')).json.styles.find((s: any) => s.name === 'Quote');
  expect((await alice.patch('/api/buttons/1', { styleId: aliceQuote.id, hidden: false })).status).toBe(200);
  expect((await alice.patch('/api/buttons/4', { styleId: aliceQuote.id, hidden: true })).status).toBe(200);
  await bob.post(`/api/fonts/${(await bob.post('/api/fonts', { family: 'Bebas Neue' })).json.font.id}/archive`);
});
afterAll(async () => {
  await env.close();
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

describe('jot backup', () => {
  it('is listed in the usage text with verify and restore', async () => {
    const r = await runCli(env.dataDir, []);
    expect(r.code).not.toBe(0);
    expect(r.err + r.out).toMatch(/jot backup/);
    expect(r.err + r.out).toMatch(/jot verify/);
    expect(r.err + r.out).toMatch(/jot restore/);
  });

  it('writes a full backup to data/backups, prints its name and SHA-256, and says it is on the same disk', async () => {
    const r = await backup();
    expect(r.file.startsWith(join(env.dataDir, 'backups'))).toBe(true);
    expect(basename(r.file)).toMatch(/^jot-backup-\d{8}-\d{6}\.tar$/);
    const bytes = readFileSync(r.file);
    expect(r.out).toContain(`SHA-256: ${sha256(bytes)}`);
    expect(r.out).toMatch(/same disk/i);
    expect(r.out).toMatch(/verified/i);
    // The .sha256 file beside it, in the format sha256sum -c reads.
    expect(readFileSync(`${r.file}.sha256`, 'utf8')).toBe(`${sha256(bytes)}  ${basename(r.file)}\n`);
    // Readable only by the owner: it holds password hashes.
    expect(statSync(r.file).mode & 0o777).toBe(0o600);
    expect(statSync(`${r.file}.sha256`).mode & 0o777).toBe(0o600);
    // jot.db first, manifest last, sessions removed.
    const entries = parseTar(bytes);
    expect(entries[0].name).toBe('jot.db');
    expect(entries.at(-1)!.name).toBe('manifest.json');
    const dbFile = join(tmp('peek'), 'jot.db');
    writeFileSync(dbFile, entries[0].data);
    expect(dump(dbFile).sessions).toEqual([]);
    expect(dump(join(env.dataDir, 'jot.db')).sessions.length).toBeGreaterThan(0);
  });

  it('writes to another folder with --out', async () => {
    const out = tmp('out');
    const r = await backup(['--out', out]);
    expect(r.file.startsWith(out)).toBe(true);
    expect(readdirSync(out).sort()).toEqual([basename(r.file), `${basename(r.file)}.sha256`].sort());
    expect(r.out).not.toMatch(/same disk/i);
  });

  it('includes data saved a moment before', async () => {
    const n = (await alice.post('/api/notes', { title: 'just now', content: doc('saved a moment ago') })).json.note;
    const r = await backup(['--out', tmp('recent')]);
    const { dir, file } = emptyDataWith(r.file);
    expect((await runCli(dir, ['restore', file])).code).toBe(0);
    const db = new Database(join(dir, 'jot.db'), { readonly: true });
    expect((db.prepare('SELECT content FROM notes WHERE id = ?').get(n.id) as any).content).toContain('saved a moment ago');
    db.close();
  });
});

describe('jot restore', () => {
  it('round trip: every table except sessions and every file are identical', async () => {
    const r = await backup(['--out', tmp('rt')]);
    const { dir, file } = emptyDataWith(r.file);
    const res = await runCli(dir, ['restore', file]);
    expect(res.code, res.err + res.out).toBe(0);
    expect(res.out).toMatch(/3 users/);
    expect(res.out).toMatch(/sign in again/i);
    const before = dump(join(env.dataDir, 'jot.db'));
    const after = dump(join(dir, 'jot.db'));
    for (const t of [...TABLES, 'notes_fts']) expect(after[t], t).toEqual(before[t]);
    expect(after.sessions).toEqual([]);
    expect(treeHashes(join(dir, 'users'))).toEqual(treeHashes(join(env.dataDir, 'users')));
    // The backups folder is left alone.
    expect(readdirSync(join(dir, 'backups'))).toEqual([basename(file)]);
    // The restored system works: users sign in with their passwords.
    const app = await buildApp({ dataDir: dir, logger: false });
    try {
      const c = await login(app, 'bob', PASSWORD);
      expect((await c.get('/api/notes')).json.notes.map((n: any) => n.title)).toEqual(['banana']);
    } finally {
      await app.close();
    }
  });

  it('refuses while the app is running', async () => {
    const r = await backup(['--out', tmp('guard')]);
    const { dir, file } = emptyDataWith(r.file);
    // A running Jot (on its own folder; the guard asks it over HTTP, as the CLI does in Compose).
    const running = await buildApp({ dataDir: tmp('running'), logger: false });
    await running.listen({ port: 0, host: '127.0.0.1' });
    try {
      const url = `http://127.0.0.1:${(running.server.address() as any).port}`;
      const res = await runCli(dir, ['restore', file], { env: { JOT_APP_URLS: `http://127.0.0.1:1,${url}` } });
      expect(res.code).not.toBe(0);
      expect(res.err).toMatch(/running/i);
      expect(walk(dir)).toEqual([`backups/${basename(file)}`]);
    } finally {
      await running.close();
    }
  });

  it('refuses a data folder that is not empty (a backups folder is allowed)', async () => {
    const r = await backup(['--out', tmp('notempty')]);
    for (const leftover of ['jot.db', 'notes.txt', 'users/x']) {
      const { dir, file } = emptyDataWith(r.file);
      mkdirSync(join(dir, leftover, '..'), { recursive: true });
      writeFileSync(join(dir, leftover), 'old');
      const res = await runCli(dir, ['restore', file]);
      expect(res.code, leftover).not.toBe(0);
      expect(res.err).toMatch(/not empty/i);
      expect(readFileSync(join(dir, leftover), 'utf8')).toBe('old');
    }
  });

  it('a restore that fails removes what it extracted, keeps backups, and succeeds when re-run', async () => {
    const r = await backup(['--out', tmp('fail')]);
    const { dir, file } = emptyDataWith(r.file);
    const failed = await runCli(dir, ['restore', file], { env: { JOT_FAILPOINT: 'system-restore:during-extract:throw' } });
    expect(failed.code).not.toBe(0);
    expect(walk(dir).filter((f) => f !== '.lock')).toEqual([`backups/${basename(file)}`]);
    expect(sha256(readFileSync(file))).toBe(sha256(readFileSync(r.file)));
    const again = await runCli(dir, ['restore', file]);
    expect(again.code, again.err).toBe(0);
    expect(treeHashes(join(dir, 'users'))).toEqual(treeHashes(join(env.dataDir, 'users')));
  });

  it('after a restore killed part-way, emptying the folder (keeping backups) and re-running succeeds', async () => {
    const r = await backup(['--out', tmp('kill')]);
    const { dir, file } = emptyDataWith(r.file);
    const killed = await runCli(dir, ['restore', file], { env: { JOT_FAILPOINT: 'system-restore:during-extract' } });
    expect(killed.signal).toBe('SIGKILL');
    expect(walk(dir).length).toBeGreaterThan(1); // it could not clean up
    expect((await runCli(dir, ['restore', file])).code).not.toBe(0); // not empty
    for (const e of readdirSync(dir)) if (e !== 'backups') rmSync(join(dir, e), { recursive: true, force: true });
    const again = await runCli(dir, ['restore', file]);
    expect(again.code, again.err).toBe(0);
    expect(treeHashes(join(dir, 'users'))).toEqual(treeHashes(join(env.dataDir, 'users')));
  });

  it('refuses a personal backup (those are restored in the web app)', async () => {
    const made = (await alice.post('/api/backup', {})).json.backup;
    const personal = join(tmp('personal'), 'p.tar');
    writeFileSync(personal, (await alice.get(`/api/backup/${made.id}`)).rawPayload);
    const v = await runCli(env.dataDir, ['verify', personal]);
    expect(v.code, v.err).toBe(0);
    expect(v.out).toMatch(/personal backup/i);
    const { dir, file } = emptyDataWith(personal);
    const res = await runCli(dir, ['restore', file]);
    expect(res.code).not.toBe(0);
    expect(res.err).toMatch(/personal backup/i);
  });

  it('restores an older database version, which the app then updates', async () => {
    const r = await backup(['--out', tmp('old')]);
    const b = openBackup(readFileSync(r.file));
    const dbEntry = b.entries.find((e) => e.name === 'jot.db')!;
    const work = join(tmp('olddb'), 'jot.db');
    writeFileSync(work, dbEntry.data);
    const odb = new Database(work);
    makeVersion1(odb);
    odb.close();
    dbEntry.data = readFileSync(work);
    b.manifest.schemaVersion = 1;
    const oldFile = join(tmp('oldfile'), 'jot-backup-old.tar');
    writeFileSync(oldFile, packBackup(b));
    const { dir, file } = emptyDataWith(oldFile);
    const res = await runCli(dir, ['restore', file]);
    expect(res.code, res.err).toBe(0);
    const app = await buildApp({ dataDir: dir, logger: false });
    await app.close();
    const db = new Database(join(dir, 'jot.db'), { readonly: true });
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    db.close();
  });
});

describe('jot verify', () => {
  it('accepts a good backup and refuses damaged ones without changing them', async () => {
    const r = await backup(['--out', tmp('verify')]);
    const ok = await runCli(env.dataDir, ['verify', r.file]);
    expect(ok.code, ok.err).toBe(0);
    expect(ok.out).toMatch(/OK/);
    const good = readFileSync(r.file);
    const dir = tmp('damaged');
    const cases: Record<string, Buffer> = {
      flipped: Buffer.from(good).fill(good[2000] ^ 1, 2000, 2001),
      truncated: good.subarray(0, good.length - 700),
      empty: Buffer.alloc(0),
    };
    for (const [name, bytes] of Object.entries(cases)) {
      const f = join(dir, `${name}.tar`);
      writeFileSync(f, bytes);
      const res = await runCli(env.dataDir, ['verify', f]);
      expect(res.code, name).not.toBe(0);
      expect(readFileSync(f).equals(bytes)).toBe(true);
    }
    // A .sha256 file that does not match is reported.
    const f = join(dir, 'sidecar.tar');
    writeFileSync(f, good);
    writeFileSync(`${f}.sha256`, `${sha256('other')}  sidecar.tar\n`);
    expect((await runCli(env.dataDir, ['verify', f])).code).not.toBe(0);
  });

  it('refuses newer versions, wrong entries and link entries', async () => {
    const r = await backup(['--out', tmp('bad')]);
    const dir = tmp('badfiles');
    const variants: Record<string, (b: ReturnType<typeof openBackup>) => void> = {
      newerFormat: (b) => (b.manifest.version = 99),
      newerSchema: (b) => (b.manifest.schemaVersion = SCHEMA_VERSION + 1),
      traversal: (b) => b.entries.push({ name: 'users/../../evil', data: Buffer.from('x') }),
      extra: (b) => b.entries.push({ name: `users/${'A'.repeat(22)}/photos/${'B'.repeat(22)}`, data: PNG_1PX }),
      missing: (b) => (b.entries = b.entries.filter((e) => !e.name.includes('/photos/'))),
      link: (b) => {
        const i = b.entries.findIndex((e) => e.name.includes('/photos/'));
        b.entries[i] = { ...b.entries[i], data: Buffer.alloc(0), type: '2', linkname: '/etc/passwd' };
      },
    };
    for (const [name, change] of Object.entries(variants)) {
      const b = openBackup(readFileSync(r.file));
      change(b);
      const f = join(dir, `${name}.tar`);
      writeFileSync(f, packBackup(b));
      const res = await runCli(env.dataDir, ['verify', f]);
      expect(res.code, `${name}: ${res.out}`).not.toBe(0);
    }
  });
});

describe('missing files', () => {
  it('a missing file does not stop a backup; it is listed, and that backup restores with the file named', async () => {
    const c = await newUser(env, 'dave');
    const id = (await c.get('/api/me')).json.user.id;
    const p = (await c.upload('/api/photos', 'lost.png', PNG_1PX, 'image/png')).json.photo;
    unlinkSync(join(env.dataDir, 'users', id, 'photos', p.id));
    const r = await backup(['--out', tmp('missing')]);
    expect(r.out + r.err).toMatch(new RegExp(`users/${id}/photos/${p.id}`));
    expect(r.out + r.err).toMatch(/lost\.png/);
    const v = await runCli(env.dataDir, ['verify', r.file]);
    expect(v.code).toBe(0);
    expect(v.out).toMatch(/missing/i);
    const { dir, file } = emptyDataWith(r.file);
    const res = await runCli(dir, ['restore', file]);
    expect(res.code, res.err).toBe(0);
    expect(res.out).toMatch(/lost\.png/);
    const db = new Database(join(dir, 'jot.db'), { readonly: true });
    expect(db.prepare('SELECT original_name FROM photos WHERE id = ?').get(p.id)).toEqual({ original_name: 'lost.png' });
    db.close();
    expect(existsSync(join(dir, 'users', id, 'photos', p.id))).toBe(false);
    // Put things back for the other tests.
    await c.post('/api/notes', { title: 'dave', content: doc('d') });
    (env.app as any).jot.db.prepare('DELETE FROM photos WHERE id = ?').run(p.id);
  });
});

describe('while the app is writing', () => {
  it('backups taken during continuous saves and uploads all verify, with every file present', async () => {
    let stop = false;
    const n = (await carol.post('/api/notes', { title: 'busy', content: doc('x') })).json.note;
    const writer = (async () => {
      let i = 0;
      while (!stop) {
        i++;
        await carol.patch(`/api/notes/${n.id}`, { content: doc(`edit ${i}`) });
        await carol.upload('/api/photos', `w${i}.png`, PNG_1PX, 'image/png');
        await new Promise((r) => setTimeout(r, 5));
      }
    })();
    try {
      const out = tmp('busy');
      for (let k = 0; k < 4; k++) {
        const r = await backup(['--out', out]);
        expect(r.out + r.err).not.toMatch(/missing/i);
        const v = await runCli(env.dataDir, ['verify', r.file]);
        expect(v.code, v.err).toBe(0);
      }
    } finally {
      stop = true;
      await writer;
    }
  });
});

describe('the lock', () => {
  it('a backup killed part-way does not block the next one, and leaves no partial file', async () => {
    const out = tmp('killed');
    const killed = await runCli(env.dataDir, ['backup', '--out', out], { env: { JOT_FAILPOINT: 'backup:during-files' } });
    expect(killed.signal).toBe('SIGKILL');
    const r = await backup(['--out', out]);
    expect(readdirSync(out).sort()).toEqual([basename(r.file), `${basename(r.file)}.sha256`].sort());
  });

  it('a second backup is refused while one is running', async () => {
    const lock = tryLock(env.dataDir)!;
    expect(lock).not.toBeNull();
    try {
      const r = await runCli(env.dataDir, ['backup', '--out', tmp('busy2')]);
      expect(r.code).not.toBe(0);
      expect(r.err).toMatch(/another backup or restore is running/i);
    } finally {
      lock.release();
    }
  });

  it('the web app and the CLI share it', async () => {
    const running = runCli(env.dataDir, ['backup', '--out', tmp('shared')], { env: { JOT_FAILPOINT: 'backup:after-db-copy:sleep=3000' } });
    // Wait until the CLI holds the lock.
    for (let i = 0; i < 100; i++) {
      const l = tryLock(env.dataDir);
      if (!l) break;
      l.release();
      await new Promise((r) => setTimeout(r, 100));
    }
    expect((await alice.post('/api/backup', {})).status).toBe(409);
    expect((await running).code).toBe(0);
    expect((await alice.post('/api/backup', {})).status).toBe(201);
  });
});
