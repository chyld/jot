// Type 6 (database): schema version 10 widens notes.kind to ('doc' | 'sheet' | 'board').
// Existing docs, sheets, rowids, and note_tags survive untouched (no ON DELETE CASCADE loss),
// invalid kind values remain refused by CHECK, and later starts change nothing.
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openDatabase, SCHEMA_VERSION } from '../../src/server/db';

const FIXTURE = resolve(__dirname, '../fixtures/jot-v7.db');
let dir: string;
let file: string;
let beforeNotes: any[];
let rowids: any[];
let noteTagsBefore: any[];
let others: Record<string, string[]>;
const TABLES = ['users', 'sessions', 'tags', 'note_tags', 'photos', 'fonts', 'styles', 'restore_files', 'notes_fts', 'bot_tokens', 'sections', 'style_buttons'];
const dump = (db: Database.Database) => Object.fromEntries(TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all().map((r) => JSON.stringify(r)).sort()]));

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'jot-mig10-'));
  file = join(dir, 'jot.db');
  copyFileSync(FIXTURE, file);
  // Advance fixture from v7 -> v8 -> v9 and seed a sheet + tagged note to test v9 -> v10 directly.
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  expect(db.pragma('user_version', { simple: true })).toBe(7);
  db.exec(`
    CREATE TABLE style_buttons (
      user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slot     INTEGER NOT NULL CHECK (slot >= 1 AND slot <= 10),
      style_id TEXT REFERENCES styles(id) ON DELETE SET NULL,
      hidden   INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
      PRIMARY KEY (user_id, slot)
    );
    CREATE INDEX style_buttons_style ON style_buttons(style_id);
    ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'doc' CHECK (kind IN ('doc', 'sheet'));
  `);
  const sample = db.prepare('SELECT id, user_id FROM notes ORDER BY id LIMIT 1').get() as { id: string; user_id: string };
  db.prepare(
    `INSERT INTO notes (id, user_id, title, content, body_text, created_at, updated_at, kind)
     VALUES ('v9_sheet_note', ?, 'V9 Sheet', '{"type":"sheet","version":1,"workbook":{"sheets":{"s1":{"cellData":{}}}}}', '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'sheet')`,
  ).run(sample.user_id);
  db.prepare(`INSERT OR IGNORE INTO tags (id, user_id, name) VALUES ('mig10_tag', ?, 'preserved')`).run(sample.user_id);
  db.prepare(`INSERT OR IGNORE INTO note_tags (note_id, tag_id, user_id) VALUES (?, 'mig10_tag', ?)`).run(sample.id, sample.user_id);
  db.pragma('user_version = 9');

  beforeNotes = db.prepare('SELECT * FROM notes ORDER BY id').all();
  rowids = db.prepare('SELECT rowid, id FROM notes ORDER BY id').all();
  noteTagsBefore = db.prepare('SELECT * FROM note_tags ORDER BY note_id, tag_id').all();
  others = dump(db);
  expect(beforeNotes.length).toBeGreaterThan(1);
  expect(noteTagsBefore.length).toBeGreaterThan(0);
  db.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it('widens notes.kind to allow board while preserving docs, sheets, rowids, and note_tags', () => {
  const db = openDatabase(file);
  expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(10);
  expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);

  const afterNotes = db.prepare('SELECT * FROM notes ORDER BY id').all() as any[];
  expect(afterNotes).toEqual(beforeNotes);
  expect(afterNotes.find((n) => n.id === 'v9_sheet_note')?.kind).toBe('sheet');
  expect(db.prepare('SELECT rowid, id FROM notes ORDER BY id').all()).toEqual(rowids);
  expect(db.prepare('SELECT * FROM note_tags ORDER BY note_id, tag_id').all()).toEqual(noteTagsBefore);
  expect(dump(db)).toEqual(others);
  expect(db.pragma('foreign_key_check')).toEqual([]);

  // Board kind is accepted; invalid kind is refused.
  const sample = afterNotes[0];
  db.prepare(
    `INSERT INTO notes (id, user_id, title, content, body_text, created_at, updated_at, kind)
     VALUES ('v10_board_note', ?, 'V10 Board', '{"type":"board","version":1,"elements":[],"appState":{},"files":{}}', '', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', 'board')`,
  ).run(sample.user_id);
  expect((db.prepare("SELECT kind FROM notes WHERE id = 'v10_board_note'").get() as any).kind).toBe('board');

  expect(() =>
    db
      .prepare(
        `INSERT INTO notes (id, user_id, title, content, body_text, created_at, updated_at, kind)
         VALUES ('bad_kind_note', ?, 'Bad', '{}', '', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', 'invalid')`,
      )
      .run(sample.user_id),
  ).toThrow();
  db.close();
});

it('later starts change nothing', () => {
  const db = openDatabase(file);
  expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  expect(db.prepare("SELECT COUNT(*) AS n FROM notes WHERE kind = 'board'").get()).toEqual({ n: 1 });
  expect(db.prepare("SELECT COUNT(*) AS n FROM notes WHERE kind = 'sheet'").get()).toEqual({ n: 1 });
  db.close();
});
