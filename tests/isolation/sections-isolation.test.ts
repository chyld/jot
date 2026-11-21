// Type 1 (per-user isolation): sections (sections-spec.md §10). One user can never see,
// use or change another user's sections, also when both have a section with the same ID.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { doc, makeTestEnv, newUser, type Client, type TestEnv } from '../helpers/setup';

let env: TestEnv;
let alice: Client;
let bob: Client;
let aliceWork: any;
let aliceSecret: any;
const db = () => (env.app as any).jot.db;

beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
  bob = await newUser(env, 'bob');
  await alice.post('/api/sections', { id: 'work', name: 'Alice Work', colour: 'blue' });
  await alice.post('/api/sections', { id: 'secret', name: 'Alice Secret', colour: 'violet' });
  await bob.post('/api/sections', { id: 'work', name: 'Bob Work', colour: 'teal' });
  aliceWork = (await alice.post('/api/notes?section=work', { title: 'Alice plan', content: doc('zebraword') })).json.note;
  await alice.post(`/api/notes/${aliceWork.id}/tags`, { tag: 'alicetag' });
  aliceSecret = (await alice.post('/api/notes?section=secret', { title: 'Alice secret' })).json.note;
  await alice.post('/api/notes?section=work', {}); // an empty note
  const binned = (await alice.post('/api/notes?section=work', { title: 'Alice binned' })).json.note;
  await alice.del(`/api/notes/${binned.id}`);
});
afterAll(() => env.close());

it('lists only the user’s own sections, with their own names, colours and counts', async () => {
  expect((await alice.get('/api/sections')).json.sections.map((s: any) => [s.id, s.name, s.colour, s.noteCount, s.trashCount])).toEqual([
    ['default', 'Default', 'olive', 0, 0],
    ['work', 'Alice Work', 'blue', 2, 1],
    ['secret', 'Alice Secret', 'violet', 1, 0],
  ]);
  expect((await bob.get('/api/sections')).json.sections.map((s: any) => [s.id, s.name, s.colour, s.noteCount, s.trashCount])).toEqual([
    ['default', 'Default', 'olive', 0, 0],
    ['work', 'Bob Work', 'teal', 0, 0],
  ]);
});

it('the same ID in two accounts names two different sections', async () => {
  for (const url of ['/api/notes?section=work', '/api/search?q=zebraword&section=work', '/api/trash?section=work', '/api/tags?section=work']) {
    const r = await bob.get(url);
    expect(r.status, url).toBe(200);
    expect(r.json.notes ?? r.json.tags, url).toEqual([]);
  }
  expect((await bob.get('/api/empty-notes?section=work')).json.count).toBe(0);
  expect((await bob.del('/api/empty-notes?section=work')).json.trashed).toBe(0);
  expect((await bob.del('/api/trash?section=work')).json.deleted).toBe(0);
  const mine = (await bob.post('/api/notes?section=work', { title: 'Bob plan' })).json.note;
  expect(mine.section).toBe('work');
  expect((await alice.get('/api/notes?section=work')).json.notes.map((n: any) => n.title)).not.toContain('Bob plan');
  // Alice's empty note and trash are untouched.
  expect((await alice.get('/api/empty-notes?section=work')).json.count).toBe(1);
  expect((await alice.get('/api/trash?section=work')).json.notes.map((n: any) => n.title)).toEqual(['Alice binned']);
});

it('another user’s section cannot be used: not to list, search, create, empty or keep into', async () => {
  for (const url of ['/api/notes?section=secret', '/api/search?q=x&section=secret', '/api/trash?section=secret', '/api/empty-notes?section=secret', '/api/tags?section=secret']) {
    expect((await bob.get(url)).status, url).toBe(404);
  }
  expect((await bob.post('/api/notes?section=secret', { title: 'sneak' })).status).toBe(404);
  expect((await bob.del('/api/trash?section=secret')).status).toBe(404);
  expect((await bob.del('/api/empty-notes?section=secret')).status).toBe(404);
  expect(db().prepare("SELECT COUNT(*) AS n FROM notes WHERE section_id = 'secret'").get().n).toBe(1);
});

it('another user’s section cannot be renamed or recoloured', async () => {
  expect((await bob.patch('/api/sections/secret', { name: 'Taken', colour: 'amber' })).status).toBe(404);
  await bob.patch('/api/sections/work', { name: 'Bob Work 2' });
  const a = (await alice.get('/api/sections')).json.sections;
  expect(a.find((s: any) => s.id === 'secret')).toMatchObject({ name: 'Alice Secret', colour: 'violet' });
  expect(a.find((s: any) => s.id === 'work')).toMatchObject({ name: 'Alice Work', colour: 'blue' });
});

it('another user’s note cannot be moved, and a note cannot be moved into another user’s section', async () => {
  expect((await bob.post(`/api/notes/${aliceWork.id}/section`, { section: 'work' })).status).toBe(404);
  const bobs = (await bob.post('/api/notes', { title: 'Bob note' })).json.note;
  expect((await bob.post(`/api/notes/${bobs.id}/section`, { section: 'secret' })).status).toBe(404);
  expect(db().prepare('SELECT section_id FROM notes WHERE id = ?').get(aliceWork.id).section_id).toBe('work');
  expect(db().prepare('SELECT section_id FROM notes WHERE id = ?').get(bobs.id).section_id).toBe('default');
  // Bob moving his own note to his own "work" never lands it in Alice's.
  expect((await bob.post(`/api/notes/${bobs.id}/section`, { section: 'work' })).status).toBe(200);
  expect((await alice.get('/api/notes?section=work')).json.notes.map((n: any) => n.title)).not.toContain('Bob note');
  expect(aliceSecret.section).toBe('secret');
});
