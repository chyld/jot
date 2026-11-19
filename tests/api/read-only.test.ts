// Type 2 (API integration): read-only notes. Once a note is read-only nothing about it
// can change through the web app; every route that changes a note refuses it on the
// server. The web app has no way to turn read-only off. Every new account gets a
// read-only "User manual" note.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { doc, makeTestEnv, newUser, type Client, type TestEnv } from '../helpers/setup';

let env: TestEnv;
let alice: Client;
let note: any;

beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
  note = (await alice.post('/api/notes', { title: 'Locked quartz', content: doc('locked body quartz') })).json.note;
  await alice.post(`/api/notes/${note.id}/tags`, { tag: 'kept' });
});
afterAll(() => env.close());

const READ_ONLY = /read-only/i;

describe('making a note read-only', () => {
  it('is one request, and the note says so', async () => {
    expect(note.readOnly).toBe(false);
    const res = await alice.post(`/api/notes/${note.id}/read-only`, {});
    expect(res.status).toBe(200);
    expect(res.json.note.readOnly).toBe(true);
    expect((await alice.get(`/api/notes/${note.id}`)).json.note.readOnly).toBe(true);
    // Asking again changes nothing.
    expect((await alice.post(`/api/notes/${note.id}/read-only`, {})).json.note.readOnly).toBe(true);
  });

  it('a note in the trash cannot be made read-only', async () => {
    const t = (await alice.post('/api/notes', { title: 'binned', content: doc('x') })).json.note;
    await alice.del(`/api/notes/${t.id}`);
    expect((await alice.post(`/api/notes/${t.id}/read-only`, {})).status).toBe(409);
    expect((await alice.get(`/api/notes/${t.id}`)).json.note.readOnly).toBe(false);
  });

  it('an unknown note is 404', async () => {
    expect((await alice.post('/api/notes/AAAAAAAAAAAAAAAAAAAAAA/read-only', {})).status).toBe(404);
  });
});

describe('a read-only note cannot change through any route', () => {
  const unchanged = async () => {
    const n = (await alice.get(`/api/notes/${note.id}`)).json.note;
    expect(n.title).toBe('Locked quartz');
    expect(n.content).toEqual(doc('locked body quartz'));
    expect(n.tags).toEqual(['kept']);
    expect(n.deletedAt).toBeNull();
    expect(n.readOnly).toBe(true);
    expect(n.updatedAt).toBe(note.updatedAt);
  };

  it.each([
    ['change the title', () => alice.patch(`/api/notes/${note.id}`, { title: 'changed' })],
    ['change the body', () => alice.patch(`/api/notes/${note.id}`, { content: doc('changed') })],
    ['turn read-only off by saving', () => alice.patch(`/api/notes/${note.id}`, { readOnly: false })],
    ['add a tag', () => alice.post(`/api/notes/${note.id}/tags`, { tag: 'more' })],
    ['remove a tag', () => alice.del(`/api/notes/${note.id}/tags/kept`)],
    ['move it to the trash', () => alice.del(`/api/notes/${note.id}`)],
    ['delete it permanently', () => alice.del(`/api/trash/${note.id}`)],
  ])('refuses to %s', async (_what, call) => {
    const res = await call();
    expect([403, 404]).toContain(res.status);
    if (res.status === 403) expect(res.json.error).toMatch(READ_ONLY);
    await unchanged();
  });

  it('the first five are refused with 403 and a clear message', async () => {
    for (const res of [
      await alice.patch(`/api/notes/${note.id}`, { title: 'x' }),
      await alice.patch(`/api/notes/${note.id}`, { content: doc('x') }),
      await alice.post(`/api/notes/${note.id}/tags`, { tag: 'more' }),
      await alice.del(`/api/notes/${note.id}/tags/kept`),
      await alice.del(`/api/notes/${note.id}`),
    ]) {
      expect(res.status).toBe(403);
      expect(res.json.error).toMatch(/read-only.*command line/i);
    }
  });

  it('Empty trash never touches it', async () => {
    await alice.del('/api/trash');
    await unchanged();
  });

  it('there is no web route that turns read-only off', async () => {
    for (const res of [
      await alice.post(`/api/notes/${note.id}/writable`, {}),
      await alice.del(`/api/notes/${note.id}/read-only`),
      await alice.post(`/api/notes/${note.id}/unlock`, {}),
      await alice.put(`/api/notes/${note.id}`, { readOnly: false }),
    ]) {
      expect([404, 405]).toContain(res.status);
    }
    await unchanged();
  });

  it('still shows in the list, the tag filter and search', async () => {
    const find = (r: any) => r.json.notes.find((n: any) => n.id === note.id);
    expect(find(await alice.get('/api/notes')).readOnly).toBe(true);
    expect(find(await alice.get('/api/notes?tag=kept'))).toBeTruthy();
    expect(find(await alice.get('/api/search?q=quartz'))).toBeTruthy();
    expect((await alice.get('/api/tags')).json.tags).toContainEqual({ name: 'kept', count: 1 });
  });
});

describe('the user manual', () => {
  it('every new account gets one read-only note titled User manual, tagged manual', async () => {
    const carol = await newUser(env, 'carol', undefined, { keepManual: true });
    const list = (await carol.get('/api/notes')).json.notes;
    expect(list.map((n: any) => n.title)).toEqual(['User manual']);
    expect(list[0]).toMatchObject({ readOnly: true, tags: ['manual'] });
    const manual = (await carol.get(`/api/notes/${list[0].id}`)).json.note;
    expect(JSON.stringify(manual.content)).toContain('jot backup');
    // It cannot be edited or deleted.
    expect((await carol.patch(`/api/notes/${manual.id}`, { title: 'mine now' })).status).toBe(403);
    expect((await carol.del(`/api/notes/${manual.id}`)).status).toBe(403);
    // It can be found.
    expect((await carol.get('/api/search?q=RESTORE')).json.notes.map((n: any) => n.id)).toContain(manual.id);
    expect((await carol.get('/api/notes?tag=manual')).json.notes.map((n: any) => n.id)).toEqual([manual.id]);
  });
});
