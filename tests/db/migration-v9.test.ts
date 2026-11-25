// Type 6 (database): schema version 9 adds notes.kind ('doc' | 'sheet', default 'doc').
// Existing notes keep their rows and rowids, every other table is untouched, invalid kind
// values are refused by the CHECK constraint, and later starts change nothing.
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
let others: Record<string, string[]>;
const TABLES = ['users', 'sessions', 'tags', 'note_tags', 'photos', 'fonts', 'styles', 'restore_files', 'notes_fts', 'bot_tokens', 'sections', 'style_buttons'];
const dump = (db: Database.Database) => Object.fromEntries(TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all().map((r) => JSON.stringify(r)).sort()]));

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'jot-mig9-'));
  file = join(dir, 'jot.db');
  copyFileSync(FIXTURE, file);
  // Advance fixture from v7 to v8 so we test the v8 -> v9 migration directly.
  const db = new Database(file);
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
  `);
  db.pragma('user_version = 8');
  beforeNotes = db.prepare('SELECT * FROM notes ORDER BY id').all();
  rowids = db.prepare('SELECT rowid, id FROM notes ORDER BY id').all();
  others = dump(db);
  expect(beforeNotes.length).toBeGreaterThan(0);
  db.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it('adds notes.kind defaulting to doc, preserves rowids and other tables, and enforces the CHECK constraint', () => {
  const db = openDatabase(file);
  expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(9);
  expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);

  const afterNotes = db.prepare('SELECT * FROM notes ORDER BY id').all() as any[];
  expect(afterNotes.length).toBe(beforeNotes.length);
  for (const [i, n] of afterNotes.entries()) {
    const { kind, ...rest } = n;
    expect(rest).toEqual(beforeNotes[i]);
    expect(kind).toBe('doc');
  }
  expect(db.prepare('SELECT rowid, id FROM notes ORDER BY id').all()).toEqual(rowids);
  expect(dump(db)).toEqual(others);

  const sample = afterNotes[0];
  expect(() =>
    db
      .prepare(
        `INSERT INTO notes (id, user_id, title, content, body_text, created_at, updated_at, kind)
         VALUES ('bad_kind_note', ?, 'Bad', '{}', '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'invalid')`,
      )
      .run(sample.user_id),
  ).toThrow();
  db.close();
});

it('later starts change nothing', () => {
  const db = openDatabase(file);
  expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  expect(db.prepare("SELECT COUNT(*) AS n FROM notes WHERE kind = 'doc'").get()).toEqual({ n: beforeNotes.length });
  db.close();
});
