// Type 2 (API integration): deleting a tag from the Tags page. The tag comes off every
// note of the user (live, Inbox and trash) and the notes are kept. A tag carried by a
// read-only note cannot be deleted. Another user's tag of the same name is untouched.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, doc, makeTestEnv, newUser, type Client, type TestEnv } from '../helpers/setup';

let env: TestEnv;
let alice: Client;
let bob: Client;

beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
  bob = await newUser(env, 'bob');
});
afterAll(() => env.close());

const make = async (c: Client, title: string, ...tags: string[]) => {
  const note = (await c.post('/api/notes', { title, content: doc(`${title} body`) })).json.note;
  for (const tag of tags) await c.post(`/api/notes/${note.id}/tags`, { tag });
  return note;
};
const tagsOf = async (c: Client, id: string) => (await c.get(`/api/notes/${id}`)).json.note.tags as string[];
const tagList = async (c: Client) => (await c.get('/api/tags')).json.tags as Array<{ name: string; count: number }>;
const count = async (c: Client, name: string) => (await tagList(c)).find((t) => t.name === name)?.count;

describe('DELETE /api/tags/:tag', () => {
  it('takes the tag off every note and keeps the notes', async () => {
    const a = await make(alice, 'first', 'garnet', 'keepme');
    const b = await make(alice, 'second', 'garnet');
    expect(await count(alice, 'garnet')).toBe(2);

    const res = await alice.del('/api/tags/garnet');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ tag: 'garnet', removedFrom: 2 });

    expect(await count(alice, 'garnet')).toBeUndefined();
    expect(await tagsOf(alice, a.id)).toEqual(['keepme']);
    expect(await tagsOf(alice, b.id)).toEqual([]);
    expect((await alice.get(`/api/notes/${a.id}`)).json.note.deletedAt).toBeNull();
    expect((await alice.get('/api/notes?tag=garnet')).json.notes).toEqual([]);
    // Search no longer finds the notes by the deleted tag.
    expect((await alice.get('/api/search?q=garnet')).json.notes).toEqual([]);
    expect(((await alice.get('/api/search?q=keepme')).json.notes as any[]).map((n) => n.id)).toEqual([a.id]);
  });

  it('also takes the tag off notes in the trash, so restoring does not bring it back', async () => {
    const live = await make(alice, 'live opal', 'opal');
    const binned = await make(alice, 'binned opal', 'opal');
    await alice.del(`/api/notes/${binned.id}`);
    expect(await count(alice, 'opal')).toBe(1); // the count shows live notes only

    expect((await alice.del('/api/tags/opal')).json).toEqual({ tag: 'opal', removedFrom: 2 });
    expect((await alice.post(`/api/trash/${binned.id}/restore`)).status).toBe(200);
    expect(await tagsOf(alice, binned.id)).toEqual([]);
    expect(await tagsOf(alice, live.id)).toEqual([]);
    expect(await count(alice, 'opal')).toBeUndefined();
  });

  it('refuses while a read-only note has the tag, and changes nothing', async () => {
    const locked = await make(alice, 'locked', 'topaz');
    const open = await make(alice, 'open', 'topaz');
    await alice.post(`/api/notes/${locked.id}/read-only`, {});

    const res = await alice.del('/api/tags/topaz');
    expect(res.status).toBe(409);
    expect(res.json.error).toMatch(/read-only/i);
    expect(await tagsOf(alice, locked.id)).toEqual(['topaz']);
    expect(await tagsOf(alice, open.id)).toEqual(['topaz']);
    expect(await count(alice, 'topaz')).toBe(2);
  });

  it('refuses the tag of the read-only User manual', async () => {
    const carol = await newUser(env, 'carol', undefined, { keepManual: true });
    expect(await count(carol, 'manual')).toBe(1);
    expect((await carol.del('/api/tags/manual')).status).toBe(409);
    expect(await count(carol, 'manual')).toBe(1);
  });

  it('is 404 for a tag the user does not have, and for names that cannot be tags', async () => {
    expect((await alice.del('/api/tags/nosuchtag')).status).toBe(404);
    expect((await alice.del('/api/tags/not-a-tag')).status).toBe(404);
    expect((await alice.del('/api/tags/123')).status).toBe(404);
    // Deleting twice: the second time the tag is gone.
    await make(alice, 'once', 'onyx');
    expect((await alice.del('/api/tags/onyx')).status).toBe(200);
    expect((await alice.del('/api/tags/onyx')).status).toBe(404);
  });

  it('accepts the name in any letter case', async () => {
    await make(alice, 'cased', 'jasper');
    expect((await alice.del('/api/tags/JASPER')).json).toEqual({ tag: 'jasper', removedFrom: 1 });
  });

  it('never touches another user’s tag of the same name', async () => {
    const a = await make(alice, 'alice shared', 'shared');
    const b = await make(bob, 'bob shared', 'shared');

    expect((await alice.del('/api/tags/shared')).json).toEqual({ tag: 'shared', removedFrom: 1 });
    expect(await tagsOf(alice, a.id)).toEqual([]);
    expect(await tagsOf(bob, b.id)).toEqual(['shared']);
    expect(await count(bob, 'shared')).toBe(1);

    // Bob cannot delete a tag only Alice has.
    await make(alice, 'alice only', 'aliceonly');
    expect((await bob.del('/api/tags/aliceonly')).status).toBe(404);
    expect(await count(alice, 'aliceonly')).toBe(1);
  });

  it('needs a login', async () => {
    expect((await client(env.app).del('/api/tags/anything')).status).toBe(401);
  });
});
