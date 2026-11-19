// Type 1 (per-user isolation): Empty trash only ever touches the logged-in user's
// trashed notes.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { doc, makeTestEnv, newUser, type Client, type TestEnv } from '../helpers/setup';

let env: TestEnv;
let alice: Client;
let bob: Client;
beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
  bob = await newUser(env, 'bob');
});
afterAll(() => env.close());

const ids = async (c: Client, url: string) => ((await c.get(url)).json.notes as any[]).map((n) => n.id).sort();

it('B emptying their trash leaves A’s trash and notes alone, and the other way round', async () => {
  const aLive = (await alice.post('/api/notes', { title: 'a live', content: doc('x') })).json.note;
  const aTrash = (await alice.post('/api/notes', { title: 'a trashed', content: doc('x') })).json.note;
  await alice.post(`/api/notes/${aTrash.id}/tags`, { tag: 'atag' });
  await alice.del(`/api/notes/${aTrash.id}`);
  const bTrash = (await bob.post('/api/notes', { title: 'b trashed', content: doc('x') })).json.note;
  await bob.del(`/api/notes/${bTrash.id}`);

  expect((await bob.del('/api/trash')).json).toEqual({ deleted: 1 });
  expect(await ids(alice, '/api/trash')).toEqual([aTrash.id]);
  expect(await ids(alice, '/api/notes')).toEqual([aLive.id]);
  expect((await alice.get(`/api/notes/${aTrash.id}`)).json.note.tags).toEqual(['atag']);
  expect((await alice.post(`/api/trash/${aTrash.id}/restore`)).status).toBe(200);
  await alice.del(`/api/notes/${aTrash.id}`);

  const bLive = (await bob.post('/api/notes', { title: 'b live', content: doc('x') })).json.note;
  const bTrash2 = (await bob.post('/api/notes', { title: 'b trashed 2', content: doc('x') })).json.note;
  await bob.del(`/api/notes/${bTrash2.id}`);
  expect((await alice.del('/api/trash')).json).toEqual({ deleted: 1 });
  expect(await ids(bob, '/api/trash')).toEqual([bTrash2.id]);
  expect(await ids(bob, '/api/notes')).toEqual([bLive.id]);
  expect(await ids(alice, '/api/notes')).toEqual([aLive.id]);
});
