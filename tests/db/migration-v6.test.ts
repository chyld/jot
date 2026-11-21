// Type 6 (database): schema version 6 adds the Inbox flag, the bot name and the bot's
// request id to notes, and the bot_tokens table. Every existing note is unchanged and
// none is in the Inbox. Tested against a copy of a database made by the previous version
// (tests/fixtures/jot-v5.db).
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openDatabase, SCHEMA_VERSION } from '../../src/server/db';

const FIXTURE = resolve(__dirname, '../fixtures/jot-v5.db');
let dir: string;
let file: string;
let before: any[];
let others: Record<string, string[]>;
const TABLES = ['users', 'sessions', 'tags', 'note_tags', 'photos', 'fonts', 'styles', 'restore_files', 'notes_fts'];
const dump = (db: Database.Database) => Object.fromEntries(TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all().map((r) => JSON.stringify(r)).sort()]));

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'jot-mig6-'));
  file = join(dir, 'jot.db');
  copyFileSync(FIXTURE, file);
  const db = new Database(file);
  expect(db.pragma('user_version', { simple: true })).toBe(5);
  before = db.prepare('SELECT * FROM notes ORDER BY id').all();
  others = dump(db);
  db.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it('adds the Inbox flag, bot name and request id to notes, and the bot_tokens table; nothing existing changes', () => {
  const db = openDatabase(file);
  expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(6);
  expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  // The columns version 6 had (later versions add more, tested on their own).
  const v6cols = [...Object.keys(before[0]), 'inbox', 'bot_name', 'bot_request_id'].join(', ');
  const after = db.prepare(`SELECT ${v6cols} FROM notes ORDER BY id`).all() as any[];
  expect(after.length).toBe(before.length);
  for (const [i, n] of after.entries()) {
    const { inbox, bot_name, bot_request_id, ...rest } = n;
    expect(rest).toEqual(before[i]);
    expect([inbox, bot_name, bot_request_id]).toEqual([0, null, null]);
  }
  expect(dump(db)).toEqual(others);
  const cols = db.prepare('PRAGMA table_info(bot_tokens)').all().map((c: any) => c.name);
  expect(cols).toEqual(['id', 'user_id', 'name', 'token', 'created_at', 'last_used_at']);
  expect(db.prepare('SELECT COUNT(*) AS n FROM bot_tokens').get()).toEqual({ n: 0 });
  // One name per user, and each token is unique.
  const u = (db.prepare('SELECT id FROM users LIMIT 1').get() as any).id;
  db.prepare("INSERT INTO bot_tokens VALUES ('t1', ?, 'Grok', 'jot_a', '2026-01-01T00:00:00Z', NULL)").run(u);
  expect(() => db.prepare("INSERT INTO bot_tokens VALUES ('t2', ?, 'Grok', 'jot_b', '2026-01-01T00:00:00Z', NULL)").run(u)).toThrow();
  expect(() => db.prepare("INSERT INTO bot_tokens VALUES ('t3', ?, 'Other', 'jot_a', '2026-01-01T00:00:00Z', NULL)").run(u)).toThrow();
  db.close();
});
