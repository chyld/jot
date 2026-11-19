// Type 6 (database): schema version 3 adds the read-only flag and gives every existing
// account its read-only "User manual" note, exactly once. Tested against a copy of a
// database made by the previous version (tests/fixtures/jot-v2.db: alice with a tagged
// and a trashed note, bob with a note already tagged "manual").
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, SCHEMA_VERSION } from '../../src/server/db';
import { manualDoc } from '../../src/server/manual';

const FIXTURE = resolve(__dirname, '../fixtures/jot-v2.db');
let dir: string;
let file: string;

function dump(db: Database.Database) {
  const rows = (sql: string) => db.prepare(sql).all().map((r) => JSON.stringify(r)).sort();
  return {
    users: rows('SELECT * FROM users'),
    notes: rows('SELECT id, user_id, title, content, body_text, created_at, updated_at, deleted_at FROM notes'),
    tags: rows('SELECT * FROM tags'),
    noteTags: rows('SELECT * FROM note_tags'),
    photos: rows('SELECT * FROM photos'),
    fonts: rows('SELECT * FROM fonts'),
    styles: rows('SELECT * FROM styles'),
    sessions: rows('SELECT * FROM sessions'),
    fts: rows('SELECT note_id, user_id, title, body, tags FROM notes_fts'),
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'jot-mig-'));
  file = join(dir, 'jot.db');
  copyFileSync(FIXTURE, file);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('migration to version 3', () => {
  let before: ReturnType<typeof dump>;

  it('starts from a version 2 database', () => {
    const db = new Database(file);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    before = dump(db);
    expect(before.notes.length).toBe(3);
    db.close();
  });

  it('adds read_only (off for every existing note) and one read-only manual per account, and changes nothing else', () => {
    const db = openDatabase(file);
    expect(SCHEMA_VERSION).toBe(3);
    expect(db.pragma('user_version', { simple: true })).toBe(3);
    const notes = db.prepare('SELECT * FROM notes').all() as any[];
    const manuals = notes.filter((n) => n.title === 'User manual');
    expect(notes.length).toBe(5);
    expect(manuals.length).toBe(2);
    expect(new Set(manuals.map((m) => m.user_id)).size).toBe(2);
    for (const n of notes) expect(n.read_only).toBe(n.title === 'User manual' ? 1 : 0);
    for (const m of manuals) {
      expect(JSON.parse(m.content)).toEqual(manualDoc());
      expect(m.deleted_at).toBeNull();
      const tags = db.prepare('SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ?').all(m.id);
      expect(tags).toEqual([{ name: 'manual' }]);
      const fts = db.prepare('SELECT * FROM notes_fts WHERE note_id = ?').all(m.id) as any[];
      expect(fts.length).toBe(1);
      expect(fts[0].tags).toBe('manual');
    }
    // Bob already had a "manual" tag: it is reused, not duplicated.
    expect((db.prepare("SELECT COUNT(*) AS n FROM tags WHERE name = 'manual'").get() as any).n).toBe(2);
    // Everything that was there is unchanged.
    const after = dump(db);
    const manualIds = new Set(manuals.map((m) => m.id));
    expect(after.notes.filter((r) => !manualIds.has(JSON.parse(r).id))).toEqual(before.notes);
    expect(after.users).toEqual(before.users);
    expect(after.photos).toEqual(before.photos);
    expect(after.fonts).toEqual(before.fonts);
    expect(after.styles).toEqual(before.styles);
    expect(after.sessions).toEqual(before.sessions);
    expect(after.noteTags.filter((r) => !manualIds.has(JSON.parse(r).note_id))).toEqual(before.noteTags);
    expect(after.fts.filter((r) => !manualIds.has(JSON.parse(r).note_id))).toEqual(before.fts);
    db.close();
  });

  it('never adds a second manual on later starts', () => {
    for (let i = 0; i < 3; i++) openDatabase(file).close();
    const db = openDatabase(file);
    expect((db.prepare("SELECT COUNT(*) AS n FROM notes WHERE title = 'User manual'").get() as any).n).toBe(2);
    db.close();
  });
});
