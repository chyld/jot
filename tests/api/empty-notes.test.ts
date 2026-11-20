// Type 2 (API integration): empty notes. GET /api/empty-notes counts them and
// DELETE /api/empty-notes moves them all to the trash, leaving every other note alone.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { doc, makeTestEnv, newUser, PNG_1PX, type Client, type TestEnv } from '../helpers/setup';

let env: TestEnv;
let alice: Client;
let bob: Client;

beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
  bob = await newUser(env, 'bob');
});
afterAll(() => env.close());

const titles = async (c: Client, url: string) => ((await c.get(url)).json.notes as any[]).map((n) => n.title).sort();
const create = async (c: Client, body: object = {}) => (await c.post('/api/notes', body)).json.note;

describe('empty notes', () => {
  it('counts and trashes only notes with no title, no tags and nothing in the body', async () => {
    expect((await alice.get('/api/empty-notes')).json).toEqual({ count: 0 });

    const e1 = await create(alice);
    const e2 = await create(alice, { title: '   ' });
    const e3 = await create(alice, { content: { type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph' }] } });
    await create(alice, { title: 'has a title' });
    await create(alice, { content: doc('has a body') });
    const tagged = await create(alice);
    await alice.post(`/api/notes/${tagged.id}/tags`, { tag: 'kept' });
    const photo = (await alice.upload('/api/photos', 'p.png', PNG_1PX, 'image/png')).json.photo;
    const photoOnly = await create(alice, { content: { type: 'doc', content: [{ type: 'image', attrs: { src: photo.url } }] } });
    const rule = await create(alice, { content: { type: 'doc', content: [{ type: 'horizontalRule' }] } });
    const locked = await create(alice);
    await alice.post(`/api/notes/${locked.id}/read-only`, {});
    const bobs = await create(bob);

    expect((await alice.get('/api/empty-notes')).json).toEqual({ count: 3 });
    expect((await bob.get('/api/empty-notes')).json).toEqual({ count: 1 });

    const res = await alice.del('/api/empty-notes');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ trashed: 3 });

    expect((await alice.get('/api/empty-notes')).json).toEqual({ count: 0 });
    const live = ((await alice.get('/api/notes')).json.notes as any[]).map((n) => n.id);
    for (const n of [tagged, photoOnly, rule, locked]) expect(live).toContain(n.id);
    for (const n of [e1, e2, e3]) expect(live).not.toContain(n.id);
    expect(await titles(alice, '/api/notes')).toContain('has a title');
    expect(live.length).toBe(6);

    // In the trash, not deleted for good: each can be restored.
    const trash = ((await alice.get('/api/trash')).json.notes as any[]).map((n) => n.id).sort();
    expect(trash).toEqual([e1.id, e2.id, e3.id].sort());
    expect((await alice.post(`/api/trash/${e1.id}/restore`)).status).toBe(200);
    expect((await alice.get('/api/empty-notes')).json).toEqual({ count: 1 });

    // Another user's notes are untouched.
    expect((await bob.get('/api/empty-notes')).json).toEqual({ count: 1 });
    expect((await bob.get(`/api/notes/${bobs.id}`)).json.note.deletedAt).toBeNull();
  });

  it('answers 0 when there is nothing to trash, and needs a login', async () => {
    await alice.del('/api/empty-notes');
    expect((await alice.del('/api/empty-notes')).json).toEqual({ trashed: 0 });
    const anon = await env.app.inject({ method: 'DELETE', url: '/api/empty-notes' });
    expect(anon.statusCode).toBe(401);
  });
});
