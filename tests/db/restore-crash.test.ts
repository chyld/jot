// Type 6 (database): a personal restore is decided by one database transaction.
//  - Crash at every step: Jot's real server runs as a child process and is killed
//    (SIGKILL, via an env-guarded failpoint) at each step. Afterwards the account is
//    exactly the old data (before the switch) or exactly the new data (after it), and
//    no stray files remain after the next start.
//  - Tidy-up after a committed restore removes none of the restored files.
//  - Schema: version 2 adds the restore_files table to an existing database.
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app';
import { openDatabase, SCHEMA_VERSION } from '../../src/server/db';
import { doc, GIF_1PX, login, PASSWORD, PNG_1PX, type Client } from '../helpers/setup';
import { accountSnapshot, httpClient, restore, stage, startServer, strayFiles, takeBackup } from '../helpers/backup';
import { createUser } from '../../src/server/users';
import { DEFAULT_STARTER_FONTS_DIR } from '../../src/server/context';
import { GOOGLE_FONTS } from '../../src/server/fonts';

const scratch: string[] = [];
const tmp = (n: string) => {
  const d = mkdtempSync(join(tmpdir(), `jot-${n}-`));
  scratch.push(d);
  return d;
};

let template: string;
let userId: string;
let backupFile: Buffer;
let newData: ReturnType<typeof accountSnapshot>; // what the backup holds
let oldData: ReturnType<typeof accountSnapshot>; // what the account holds before the restore

async function withApp<T>(dataDir: string, fn: (app: FastifyInstance, c: Client) => Promise<T>): Promise<T> {
  const app = await buildApp({ dataDir, logger: false });
  try {
    return await fn(app, await login(app, 'alice', PASSWORD));
  } finally {
    await app.close();
  }
}
const snapshotOf = (app: FastifyInstance, dataDir: string) => accountSnapshot((app as any).jot.db, dataDir, userId);
const strayOf = (app: FastifyInstance, dataDir: string) => strayFiles((app as any).jot.db, dataDir, userId);

beforeAll(async () => {
  template = tmp('crash-template');
  const db = openDatabase(join(template, 'jot.db'));
  userId = (await createUser({ db, dataDir: template, starterFontsDir: DEFAULT_STARTER_FONTS_DIR, fontSource: GOOGLE_FONTS }, 'alice', PASSWORD)).id;
  db.close();
  await withApp(template, async (app, c) => {
    // The data the backup will hold.
    const p = (await c.upload('/api/photos', 'one.png', PNG_1PX, 'image/png')).json.photo;
    const n = (await c.post('/api/notes', { title: 'kept', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'new data' }] }, { type: 'image', attrs: { src: p.url } }] } })).json.note;
    await c.post(`/api/notes/${n.id}/tags`, { tag: 'fresh' });
    await c.upload('/api/photos', 'spare.gif', GIF_1PX, 'image/gif');
    const fonts = (await c.get('/api/fonts')).json.fonts;
    // An archived starter font, as accounts archived before default fonts existed have.
    (app as any).jot.db.prepare('UPDATE fonts SET archived_at = ? WHERE id = ?').run('2026-11-19T06:59:17.696Z', fonts[1].id);
    await c.post('/api/styles', { name: 'Backed up', fontId: fonts[0].id, size: 33 });
    newData = snapshotOf(app, template);
    backupFile = (await takeBackup(c)).file;
    // Then the account changes: this is the "old" data a restore replaces.
    await c.patch(`/api/notes/${n.id}`, { title: 'edited later', content: doc('old data') });
    await c.post('/api/notes', { title: 'added later', content: doc('more old data') });
    await c.upload('/api/photos', 'later.png', PNG_1PX, 'image/png');
    for (const s of (await c.get('/api/styles')).json.styles.slice(0, 2)) await c.del(`/api/styles/${s.id}`);
    oldData = snapshotOf(app, template);
  });
  expect(oldData).not.toEqual(newData);
}, 120_000);

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

const STEPS: Array<[string, 'old' | 'new']> = [
  ['restore:during-check', 'old'],
  ['restore:after-confirm', 'old'],
  ['restore:during-safety-backup', 'old'],
  ['restore:after-safety-backup', 'old'],
  ['restore:after-new-file-list', 'old'],
  ['restore:during-new-files', 'old'],
  ['restore:after-new-files', 'old'],
  ['restore:before-commit', 'old'],
  ['restore:after-commit', 'new'],
  ['restore:during-tidy', 'new'],
  ['restore:after-tidy', 'new'],
];

describe('crash at every step of a personal restore', () => {
  it.each(STEPS)('killed at %s: the account is exactly the %s data, with no stray files after the next start', async (fp, expected) => {
    const dir = tmp('crash');
    cpSync(template, dir, { recursive: true });
    const server = await startServer(dir, { JOT_FAILPOINT: fp });
    const c = httpClient(server.url);
    await c.login('alice', PASSWORD);
    try {
      const s = await c.raw('/api/restore', backupFile);
      if (s.status === 201) await c.post(`/api/restore/${s.json.restore.id}/confirm`, { confirm: 'RESTORE' });
    } catch {
      // The connection drops when the server is killed.
    }
    const exit = await server.exited;
    expect(exit.signal, `the failpoint was not reached:\n${server.output()}`).toBe('SIGKILL');

    await withApp(dir, async (app, client) => {
      expect(snapshotOf(app, dir)).toEqual(expected === 'old' ? oldData : newData);
      expect(strayOf(app, dir)).toEqual([]);
      // Any safety backup that was kept is complete.
      const safety = (await client.get('/api/safety-backups')).json.backups;
      for (const b of safety) {
        const file = (await client.get(`/api/safety-backups/${b.name}`)).rawPayload;
        const st = await stage(client, file);
        expect(st.status, st.body).toBe(201);
        await client.del(`/api/restore/${st.json.restore.id}`);
      }
      expect(safety.length).toBe(['restore:during-check', 'restore:after-confirm', 'restore:during-safety-backup'].includes(fp) ? 0 : 1);
      // The lock did not outlive the crash: the restore can be run again, and it completes.
      expect((await restore(client, backupFile)).done.status).toBe(200);
      expect(snapshotOf(app, dir)).toEqual(newData);
      expect(strayOf(app, dir)).toEqual([]);
    });
  }, 120_000);
});

describe('tidy-up after a committed restore', () => {
  it('restarting the server after a successful restore removes none of the restored files', async () => {
    const dir = tmp('tidy');
    cpSync(template, dir, { recursive: true });
    await withApp(dir, async (app, c) => {
      expect((await restore(c, backupFile)).done.status).toBe(200);
      expect(snapshotOf(app, dir)).toEqual(newData);
    });
    // Restart twice, once as the real server process.
    const server = await startServer(dir);
    await server.stop();
    await withApp(dir, async (app) => {
      expect(snapshotOf(app, dir)).toEqual(newData);
      expect(strayOf(app, dir)).toEqual([]);
      const db = (app as any).jot.db;
      for (const p of db.prepare('SELECT id FROM photos WHERE user_id = ?').all(userId) as any[]) {
        expect(existsSync(join(dir, 'users', userId, 'photos', p.id))).toBe(true);
      }
      for (const f of db.prepare('SELECT id, faces FROM fonts WHERE user_id = ?').all(userId) as any[]) {
        expect(readdirSync(join(dir, 'users', userId, 'fonts', f.id)).sort()).toEqual(JSON.parse(f.faces).map((x: any) => x.file).sort());
      }
    });
  }, 120_000);
});

// Turns a current database back into a version 1 one: no restore_files, no read_only, no manual notes.
function makeVersion1(db: Database.Database) {
  for (const m of db.prepare("SELECT id FROM notes WHERE title = 'User manual' AND read_only = 1").all() as any[]) {
    db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(m.id);
    db.prepare('DELETE FROM notes WHERE id = ?').run(m.id);
  }
  db.exec("DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM note_tags nt WHERE nt.tag_id = tags.id)");
  db.exec('ALTER TABLE notes DROP COLUMN read_only');
  db.exec('ALTER TABLE styles DROP COLUMN is_default');
  db.exec('DROP TABLE IF EXISTS restore_files');
  db.pragma('user_version = 1');
}

describe('schema versions 2 and 3', () => {
  it('a version 1 database gets the restore_files table, read-only notes and its manual, and keeps its data', () => {
    const dir = tmp('v1');
    const file = join(dir, 'jot.db');
    cpSync(join(template, 'jot.db'), file);
    const raw = new Database(file);
    makeVersion1(raw);
    raw.close();
    const db = openDatabase(file);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(4);
    const cols = db.prepare('PRAGMA table_info(restore_files)').all().map((c: any) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['path', 'state', 'user_id']));
    expect((db.prepare('SELECT COUNT(*) AS n FROM notes WHERE read_only = 0').get() as any).n).toBe(2);
    expect((db.prepare("SELECT COUNT(*) AS n FROM notes WHERE title = 'User manual' AND read_only = 1").get() as any).n).toBe(1);
    expect(() => db.prepare("INSERT INTO restore_files (path, state, user_id) VALUES ('x', 'maybe', ?)").run(userId)).toThrow();
    db.close();
  });
});
