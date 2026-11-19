// Type 6 (database): schema version 5 replaces the text of each account's User manual note
// (the Backup screen became the Account page) and touches nothing else. Tested against a
// copy of a database made by the previous version (tests/fixtures/jot-v4.db): alice and bob
// with their manuals, alice's own writable note also called "User manual" (tagged manual),
// and a read-only note of bob's that is not the manual.
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { docText } from '../../src/server/content';
import { openDatabase, SCHEMA_VERSION } from '../../src/server/db';
import { manualDoc } from '../../src/server/manual';

const FIXTURE = resolve(__dirname, '../fixtures/jot-v4.db');
let dir: string;
let file: string;
let before: any[];
let ftsBefore: any[];
const tables = ['users', 'sessions', 'tags', 'note_tags', 'photos', 'fonts', 'styles', 'restore_files'];
let otherBefore: Record<string, string[]>;
const dumpTables = (db: Database.Database) => Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all().map((r) => JSON.stringify(r)).sort()]));

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'jot-mig5-'));
  file = join(dir, 'jot.db');
  copyFileSync(FIXTURE, file);
  const db = new Database(file);
  expect(db.pragma('user_version', { simple: true })).toBe(4);
  before = db.prepare('SELECT * FROM notes ORDER BY id').all();
  ftsBefore = db.prepare('SELECT * FROM notes_fts ORDER BY note_id').all();
  otherBefore = dumpTables(db);
  db.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it('replaces only the text of each account’s User manual note; id, tags, dates and read-only stay', () => {
  const db = openDatabase(file);
  expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(5);
  expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  // The columns version 5 had (later versions add more, tested on their own).
  const cols = Object.keys(before[0]).join(', ');
  const after = db.prepare(`SELECT ${cols} FROM notes ORDER BY id`).all() as any[];
  expect(after.map((n) => n.id)).toEqual(before.map((n) => n.id));
  const manuals = before.filter((n) => n.title === 'User manual' && n.read_only === 1);
  expect(manuals.length).toBe(2); // alice's and bob's; not alice's own writable "User manual"
  for (const [i, old] of before.entries()) {
    const now = after[i];
    if (manuals.includes(old)) {
      expect(JSON.parse(old.content)).not.toEqual(manualDoc());
      expect(JSON.parse(now.content)).toEqual(manualDoc());
      expect(now.body_text).toBe(docText(manualDoc()));
      expect({ ...now, content: old.content, body_text: old.body_text }).toEqual(old); // nothing else changed
      expect(now.read_only).toBe(1);
    } else {
      expect(now).toEqual(old);
    }
  }
  // The search index follows the new text for the manuals only.
  const fts = db.prepare('SELECT * FROM notes_fts ORDER BY note_id').all() as any[];
  for (const [i, old] of ftsBefore.entries()) {
    if (manuals.some((m) => m.id === old.note_id)) expect(fts[i]).toEqual({ ...old, body: docText(manualDoc()) });
    else expect(fts[i]).toEqual(old);
  }
  expect(dumpTables(db)).toEqual(otherBefore);
  db.close();
});

it('later starts change nothing', () => {
  const db = openDatabase(file);
  const snap = db.prepare('SELECT * FROM notes ORDER BY id').all();
  void snap;
  db.close();
  const again = openDatabase(file);
  expect(again.prepare('SELECT * FROM notes ORDER BY id').all()).toEqual(snap);
  again.close();
});
