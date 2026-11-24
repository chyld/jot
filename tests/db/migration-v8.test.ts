// Type 6 (database): schema version 8 adds style_buttons (ten fixed slots per user).
// Existing tables are untouched, no backfill is needed, deleting a style clears bindings
// and deleting a user removes their rows. Tested against tests/fixtures/jot-v7.db.
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openDatabase, SCHEMA_VERSION } from '../../src/server/db';

const FIXTURE = resolve(__dirname, '../fixtures/jot-v7.db');
let dir: string;
let file: string;
let others: Record<string, string[]>;
const TABLES = ['users', 'sessions', 'notes', 'tags', 'note_tags', 'photos', 'fonts', 'styles', 'restore_files', 'notes_fts', 'bot_tokens', 'sections'];
const dump = (db: Database.Database) => Object.fromEntries(TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all().map((r) => JSON.stringify(r)).sort()]));

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'jot-mig8-'));
  file = join(dir, 'jot.db');
  copyFileSync(FIXTURE, file);
  const db = new Database(file);
  expect(db.pragma('user_version', { simple: true })).toBe(7);
  others = dump(db);
  db.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it('adds style_buttons with constraints and cascades; nothing existing changes', () => {
  const db = openDatabase(file);
  expect(SCHEMA_VERSION).toBe(8);
  expect(db.pragma('user_version', { simple: true })).toBe(8);
  expect(dump(db)).toEqual(others);

  const cols = db.prepare('PRAGMA table_info(style_buttons)').all().map((c: any) => c.name);
  expect(cols).toEqual(['user_id', 'slot', 'style_id', 'hidden']);
  expect(db.prepare('SELECT COUNT(*) AS n FROM style_buttons').get()).toEqual({ n: 0 });

  // Constraints: slot 1..10, hidden 0/1.
  const u = (db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get() as { id: string }).id;
  const f = (db.prepare('SELECT id FROM fonts WHERE user_id = ? LIMIT 1').get(u) as { id: string }).id;
  db.prepare(
    `INSERT INTO styles (id, user_id, name, font_id, size, bold, italic, underline, strike, text_color, highlight, created_at, updated_at, is_default)
     VALUES ('custom_style_1', ?, 'Custom', ?, 18, 0, 0, 0, 0, NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0)`,
  ).run(u, f);
  expect(() => db.prepare('INSERT INTO style_buttons (user_id, slot, style_id, hidden) VALUES (?, 0, NULL, 0)').run(u)).toThrow();
  expect(() => db.prepare('INSERT INTO style_buttons (user_id, slot, style_id, hidden) VALUES (?, 11, NULL, 0)').run(u)).toThrow();
  expect(() => db.prepare('INSERT INTO style_buttons (user_id, slot, style_id, hidden) VALUES (?, 1, NULL, 2)').run(u)).toThrow();

  // Deleting a style clears the binding (ON DELETE SET NULL).
  db.prepare("INSERT INTO style_buttons (user_id, slot, style_id, hidden) VALUES (?, 1, 'custom_style_1', 1)").run(u);
  db.prepare("DELETE FROM styles WHERE id = 'custom_style_1'").run();
  expect(db.prepare('SELECT style_id, hidden FROM style_buttons WHERE user_id = ? AND slot = 1').get(u)).toEqual({ style_id: null, hidden: 1 });

  // Deleting a user removes their style_buttons rows (ON DELETE CASCADE).
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES ('temp_user', 'temp_u', 'h', '2026-01-01T00:00:00Z')").run();
  db.prepare("INSERT INTO style_buttons (user_id, slot, style_id, hidden) VALUES ('temp_user', 2, NULL, 1)").run();
  db.prepare("DELETE FROM users WHERE id = 'temp_user'").run();
  expect(db.prepare("SELECT COUNT(*) AS n FROM style_buttons WHERE user_id = 'temp_user'").get()).toEqual({ n: 0 });
  db.close();
});

it('later starts change nothing', () => {
  const db = openDatabase(file);
  expect(db.pragma('user_version', { simple: true })).toBe(8);
  db.close();
});
