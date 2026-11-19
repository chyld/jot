// Type 1 (per-user isolation): a user cannot make another user's note read-only.
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

it('B cannot make A’s note read-only, and A’s read-only note stays A’s', async () => {
  const n = (await alice.post('/api/notes', { title: 'a note', content: doc('x') })).json.note;
  expect((await bob.post(`/api/notes/${n.id}/read-only`, {})).status).toBe(404);
  expect((await alice.get(`/api/notes/${n.id}`)).json.note.readOnly).toBe(false);
  expect((await alice.post(`/api/notes/${n.id}/read-only`, {})).status).toBe(200);
  expect((await bob.get(`/api/notes/${n.id}`)).status).toBe(404);
  expect((await bob.get('/api/notes')).json.notes).toEqual([]);
});
