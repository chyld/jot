// Type 6 (database): schema version 7 adds sections (sections-spec.md §8). Every existing
// user gets a Default section (Olive) holding every note, with tags intact. The notes
// table gains a column and is not rebuilt; no existing row is rewritten. Tested against a
// copy of a database made by the previous version (tests/fixtures/jot-v6.db).
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openDatabase, SCHEMA_VERSION } from '../../src/server/db';

const FIXTURE = resolve(__dirname, '../fixtures/jot-v6.db');
let dir: string;
let file: string;
let before: any[];
let rowids: any[];
let others: Record<string, string[]>;
const TABLES = ['users', 'sessions', 'tags', 'note_tags', 'photos', 'fonts', 'styles', 'restore_files', 'notes_fts', 'bot_tokens'];
const dump = (db: Database.Database) => Object.fromEntries(TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all().map((r) => JSON.stringify(r)).sort()]));
const tagsOf = (db: Database.Database) =>
  db.prepare("SELECT n.id, group_concat(t.name, ' ') AS tags FROM notes n JOIN note_tags nt ON nt.note_id = n.id JOIN tags t ON t.id = nt.tag_id GROUP BY n.id ORDER BY n.id").all();

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'jot-mig7-'));
  file = join(dir, 'jot.db');
  copyFileSync(FIXTURE, file);
  const db = new Database(file);
  expect(db.pragma('user_version', { simple: true })).toBe(6);
  before = db.prepare('SELECT * FROM notes ORDER BY id').all();
  rowids = db.prepare('SELECT rowid, id FROM notes ORDER BY id').all();
  others = { ...dump(db), noteTagNames: tagsOf(db).map((r) => JSON.stringify(r)) };
  expect(before.length).toBeGreaterThan(4);
  expect(before.some((n: any) => n.inbox === 1)).toBe(true);
  db.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it('gives every user a Default section holding every note, tags intact; nothing else changes', () => {
  const db = openDatabase(file);
  expect(SCHEMA_VERSION).toBe(7);
  expect(db.pragma('user_version', { simple: true })).toBe(7);
  const users = db.prepare('SELECT id, created_at FROM users ORDER BY id').all() as any[];
  const sections = db.prepare('SELECT * FROM sections ORDER BY user_id').all();
  expect(sections).toEqual(users.map((u) => ({ user_id: u.id, id: 'default', name: 'Default', colour: 'olive', created_at: u.created_at })));
  const after = db.prepare('SELECT * FROM notes ORDER BY id').all() as any[];
  expect(after.length).toBe(before.length);
  for (const [i, n] of after.entries()) {
    const { section_id, ...rest } = n;
    expect(rest).toEqual(before[i]);
    expect(section_id).toBe('default');
  }
  // The table was not rebuilt: every note keeps its row.
  expect(db.prepare('SELECT rowid, id FROM notes ORDER BY id').all()).toEqual(rowids);
  expect({ ...dump(db), noteTagNames: tagsOf(db).map((r) => JSON.stringify(r)) }).toEqual(others);
  db.close();
});

it('later starts change nothing', () => {
  const db = openDatabase(file);
  expect(db.prepare('SELECT COUNT(*) AS n FROM sections').get()).toEqual({ n: 2 });
  db.close();
});
