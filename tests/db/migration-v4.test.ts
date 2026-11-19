// Type 6 (database): schema version 4 makes the five starter styles default styles,
// flagged on the record. Tested against a copy of a database made by the previous
// version (tests/fixtures/jot-v3.db):
//   alice  all five starter styles untouched
//   bob    Body edited (20 px, bold, Crimson), Title renamed "My Title", Quote deleted
//   carol  Body deleted, then a style of her own called "Body" (Lora 18)
//   dave   Body kept, plus a style of his own also called "Body" (Caveat 30)
// Each has a note stamped with the Quote look, which must not change.
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, SCHEMA_VERSION } from '../../src/server/db';

const FIXTURE = resolve(__dirname, '../fixtures/jot-v3.db');
const STANDARD: Record<string, [string, number, number, number, string]> = {
  Body: ['Inter', 16, 0, 0, 'Jet'],
  Title: ['Playfair Display', 40, 1, 0, 'Jet'],
  Quote: ['Lora', 20, 0, 1, 'Violet'],
  Aside: ['Caveat', 24, 0, 0, 'Electric'],
  Code: ['Fira Code', 14, 0, 0, 'Jade'],
};
let dir: string;
let file: string;
let before: Record<string, any[]>;
let notesBefore: string[];

const stylesOf = (db: Database.Database, username: string) =>
  db
    .prepare(
      `SELECT s.*, f.family FROM styles s JOIN fonts f ON f.id = s.font_id JOIN users u ON u.id = s.user_id WHERE u.username = ? ORDER BY s.name, s.created_at`,
    )
    .all(username) as any[];
// The User manual notes are left out: version 5 updates their text (tested in migration-v5).
const notes = (db: Database.Database) =>
  db.prepare("SELECT id, content, updated_at FROM notes WHERE NOT (title = 'User manual' AND read_only = 1) ORDER BY id").all().map((r) => JSON.stringify(r));

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'jot-mig4-'));
  file = join(dir, 'jot.db');
  copyFileSync(FIXTURE, file);
  const db = new Database(file);
  expect(db.pragma('user_version', { simple: true })).toBe(3);
  before = Object.fromEntries(['alice', 'bob', 'carol', 'dave'].map((u) => [u, stylesOf(db, u)]));
  notesBefore = notes(db);
  db.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function expectStandardDefaults(styles: any[]) {
  const defaults = styles.filter((s) => s.is_default === 1);
  expect(defaults.map((s) => s.name).sort()).toEqual(Object.keys(STANDARD).sort());
  for (const s of defaults) {
    const [family, size, bold, italic, colour] = STANDARD[s.name];
    expect([s.family, s.size, s.bold, s.italic, s.underline, s.strike, s.text_color, s.highlight], s.name).toEqual([family, size, bold, italic, 0, 0, colour, null]);
  }
}

describe('migration to version 4', () => {
  let db: Database.Database;
  beforeAll(() => {
    db = openDatabase(file);
  });
  afterAll(() => db.close());

  it('is migrated (through version 4, and any later ones)', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(4);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });

  it('every user has exactly the five default styles with their standard definitions', () => {
    for (const u of ['alice', 'bob', 'carol', 'dave']) expectStandardDefaults(stylesOf(db, u));
  });

  it('untouched starter styles are flagged and otherwise unchanged', () => {
    const after = stylesOf(db, 'alice');
    expect(after.map(({ is_default, ...rest }) => rest)).toEqual(before.alice);
    expect(after.every((s) => s.is_default === 1)).toBe(true);
  });

  it('an edited starter style is flagged (same record) and set back to its standard definition', () => {
    const was = before.bob.find((s) => s.name === 'Body');
    const now = stylesOf(db, 'bob').find((s) => s.name === 'Body' && s.is_default === 1);
    expect(now.id).toBe(was.id);
    expect(was.size).toBe(20);
    expect([now.size, now.bold, now.text_color]).toEqual([16, 0, 'Jet']);
  });

  it('a renamed starter style is left exactly as it is (ordinary, editable), and the default is created again', () => {
    const was = before.bob.find((s) => s.name === 'My Title');
    const now = stylesOf(db, 'bob');
    expect(now.find((s) => s.id === was.id)).toEqual({ ...was, is_default: 0 });
    const title = now.find((s) => s.name === 'Title');
    expect(title.is_default).toBe(1);
    expect(title.id).not.toBe(was.id);
  });

  it('a deleted starter style is created again', () => {
    expect(before.bob.some((s) => s.name === 'Quote')).toBe(false);
    expect(stylesOf(db, 'bob').filter((s) => s.name === 'Quote').map((s) => s.is_default)).toEqual([1]);
    const untouched = before.bob.filter((s) => ['Aside', 'Code'].includes(s.name)).map((s) => s.id).sort();
    expect(stylesOf(db, 'bob').filter((s) => ['Aside', 'Code'].includes(s.name)).map((s) => s.id).sort()).toEqual(untouched);
  });

  it('a style the user made called Body stays exactly as it is, next to the default Body', () => {
    for (const u of ['carol', 'dave']) {
      const own = before[u].filter((s) => s.name === 'Body' && s.created_at === '2026-11-20T10:00:00.000Z');
      expect(own.length, u).toBe(1);
      const now = stylesOf(db, u).filter((s) => s.name === 'Body');
      expect(now.find((s) => s.id === own[0].id)).toEqual({ ...own[0], is_default: 0 });
      expect(now.filter((s) => s.is_default === 1).length).toBe(1);
      expect(now.length).toBe(2);
    }
    // dave's starter Body was kept (same record).
    const daveStarter = before.dave.find((s) => s.name === 'Body' && s.created_at !== '2026-11-20T10:00:00.000Z');
    expect(stylesOf(db, 'dave').find((s) => s.is_default === 1 && s.name === 'Body').id).toBe(daveStarter.id);
  });

  it('never touches note text (styles are stamps)', () => {
    expect(notes(db)).toEqual(notesBefore);
  });

  it('later starts change nothing', () => {
    const snap = ['alice', 'bob', 'carol', 'dave'].map((u) => stylesOf(db, u));
    db.close();
    for (let i = 0; i < 2; i++) openDatabase(file).close();
    db = openDatabase(file);
    expect(['alice', 'bob', 'carol', 'dave'].map((u) => stylesOf(db, u))).toEqual(snap);
  });
});
