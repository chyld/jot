// Type 6 (database): schema setup, and the FTS5 search index staying in sync after
// edit, tagging, trash, restore and permanent delete.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, SCHEMA_VERSION } from '../../src/server/db';
import { doc, makeTestEnv, newUser, type Client, type TestEnv } from '../helpers/setup';

describe('schema setup', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'jot-db-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('creates every table, the FTS5 index and the schema version', () => {
    const db = openDatabase(join(dir, 'jot.db'));
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name")
      .all()
      .map((r: any) => r.name);
    for (const t of ['users', 'sessions', 'notes', 'tags', 'note_tags', 'photos', 'fonts', 'styles', 'notes_fts']) {
      expect(names).toContain(t);
    }
    const fts = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'notes_fts'").get() as any;
    expect(fts.sql).toMatch(/fts5/i);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    db.close();
  });

  it('every owned table carries its owner', () => {
    const db = openDatabase(join(dir, 'jot.db'));
    for (const t of ['sessions', 'notes', 'tags', 'note_tags', 'photos', 'fonts', 'styles']) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c: any) => c.name);
      expect(cols, t).toContain('user_id');
    }
    db.close();
  });

  it('is idempotent and keeps data when reopened', () => {
    const db = openDatabase(join(dir, 'jot.db'));
    db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1', 'keep', 'h', '2026-01-01')").run();
    db.close();
    const again = openDatabase(join(dir, 'jot.db'));
    expect((again.prepare('SELECT username FROM users').get() as any).username).toBe('keep');
    again.close();
  });

  it('enforces one username per account', () => {
    const db = openDatabase(join(dir, 'jot.db'));
    expect(() =>
      db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES ('u2', 'keep', 'h', '2026-01-01')").run(),
    ).toThrow();
    db.close();
  });
});

describe('search index sync', () => {
  let env: TestEnv;
  let alice: Client;
  const fts = (noteId: string) =>
    (env.app as any).jot.db.prepare('SELECT title, body, tags FROM notes_fts WHERE note_id = ?').all(noteId);

  beforeAll(async () => {
    env = await makeTestEnv();
    alice = await newUser(env, 'alice');
  });
  afterAll(() => env.close());

  it('indexes a new note', async () => {
    const note = (await alice.post('/api/notes', { title: 'Harbour', content: doc('mackerel and fennel') })).json.note;
    expect(fts(note.id)).toEqual([{ title: 'Harbour', body: 'mackerel and fennel', tags: '' }]);
  });

  it('indexes text inside tables, lists and headings', async () => {
    const content = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Menu' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'oysters' }] }] }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'posset' }] }] }] }] },
      ],
    };
    const note = (await alice.post('/api/notes', { title: 'Nested', content })).json.note;
    const row = fts(note.id)[0];
    expect(row.body).toMatch(/Menu/);
    expect(row.body).toMatch(/oysters/);
    expect(row.body).toMatch(/posset/);
    // separate blocks do not run together
    expect(row.body).not.toMatch(/Menuoysters|oysterposset/);
  });

  it('updates the index on edit', async () => {
    const note = (await alice.post('/api/notes', { title: 'Before', content: doc('old words') })).json.note;
    await alice.patch(`/api/notes/${note.id}`, { title: 'After', content: doc('new words') });
    expect(fts(note.id)).toEqual([{ title: 'After', body: 'new words', tags: '' }]);
  });

  it('updates the index when tags change', async () => {
    const note = (await alice.post('/api/notes', { title: 'Tags' })).json.note;
    await alice.post(`/api/notes/${note.id}/tags`, { tag: 'demo' });
    await alice.post(`/api/notes/${note.id}/tags`, { tag: 'fonts' });
    expect(fts(note.id)[0].tags).toBe('demo fonts');
    await alice.del(`/api/notes/${note.id}/tags/demo`);
    expect(fts(note.id)[0].tags).toBe('fonts');
  });

  it('removes the note from the index on trash and puts it back on restore', async () => {
    const note = (await alice.post('/api/notes', { title: 'Trash cycle', content: doc('lobster') })).json.note;
    await alice.post(`/api/notes/${note.id}/tags`, { tag: 'cycle' });
    await alice.del(`/api/notes/${note.id}`);
    expect(fts(note.id)).toEqual([]);
    await alice.post(`/api/trash/${note.id}/restore`);
    expect(fts(note.id)).toEqual([{ title: 'Trash cycle', body: 'lobster', tags: 'cycle' }]);
  });

  it('removes the note, its tags links and index row on permanent delete', async () => {
    const note = (await alice.post('/api/notes', { title: 'Doomed', content: doc('squid') })).json.note;
    await alice.post(`/api/notes/${note.id}/tags`, { tag: 'doomed' });
    await alice.del(`/api/notes/${note.id}`);
    await alice.del(`/api/trash/${note.id}`);
    const db = (env.app as any).jot.db;
    expect(fts(note.id)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM notes WHERE id = ?').get(note.id).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM note_tags WHERE note_id = ?').get(note.id).n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM tags WHERE name = 'doomed'").get().n).toBe(0);
  });

  it('the index never holds rows for trashed or missing notes', async () => {
    const db = (env.app as any).jot.db;
    const orphans = db
      .prepare('SELECT COUNT(*) AS n FROM notes_fts f LEFT JOIN notes n ON n.id = f.note_id WHERE n.id IS NULL OR n.deleted_at IS NOT NULL')
      .get();
    expect(orphans.n).toBe(0);
    const missing = db
      .prepare('SELECT COUNT(*) AS n FROM notes n LEFT JOIN notes_fts f ON f.note_id = n.id WHERE n.deleted_at IS NULL AND f.note_id IS NULL')
      .get();
    expect(missing.n).toBe(0);
  });

  it('search results match the index after a full cycle', async () => {
    const note = (await alice.post('/api/notes', { title: 'Cycle', content: doc('anchovy') })).json.note;
    const hits = async () => (await alice.get('/api/search?q=anchovy')).json.notes.length;
    expect(await hits()).toBe(1);
    await alice.patch(`/api/notes/${note.id}`, { content: doc('sardine') });
    expect(await hits()).toBe(0);
    await alice.patch(`/api/notes/${note.id}`, { content: doc('anchovy again') });
    expect(await hits()).toBe(1);
    await alice.del(`/api/notes/${note.id}`);
    expect(await hits()).toBe(0);
    await alice.post(`/api/trash/${note.id}/restore`);
    expect(await hits()).toBe(1);
    await alice.del(`/api/notes/${note.id}`);
    await alice.del(`/api/trash/${note.id}`);
    expect(await hits()).toBe(0);
  });
});
