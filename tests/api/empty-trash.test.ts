// Type 2 (API integration): Empty trash (DELETE /api/trash) permanently deletes every
// note in the user's trash in one action, leaves live notes alone, keeps photo files on
// disk (as permanent delete does), and keeps the search index and tags consistent.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { doc, makeTestEnv, newUser, PNG_1PX, type Client, type TestEnv } from '../helpers/setup';

let env: TestEnv;
let alice: Client;
let aliceId: string;
const db = () => (env.app as any).jot.db;

beforeAll(async () => {
  env = await newEnv();
});
afterAll(() => env.close());

async function newEnv() {
  const e = await makeTestEnv();
  alice = await newUserIn(e);
  return e;
}
async function newUserIn(e: TestEnv) {
  const c = await newUser(e, 'alice');
  aliceId = (await c.get('/api/me')).json.user.id;
  return c;
}

const titles = async (url: string) => ((await alice.get(url)).json.notes as any[]).map((n) => n.title).sort();

describe('empty trash', () => {
  it('deletes every trashed note for good and nothing else', async () => {
    const photo = (await alice.upload('/api/photos', 'p.png', PNG_1PX, 'image/png')).json.photo;
    const live = (await alice.post('/api/notes', { title: 'live quartz', content: doc('stays') })).json.note;
    await alice.post(`/api/notes/${live.id}/tags`, { tag: 'shared' });
    const ids: string[] = [];
    for (const [title, tag] of [
      ['gone one quartz', 'shared'],
      ['gone two', 'onlytrash'],
      ['gone three', 'onlytrash'],
    ]) {
      const n = (await alice.post('/api/notes', { title, content: { type: 'doc', content: [{ type: 'image', attrs: { src: photo.url } }] } })).json.note;
      await alice.post(`/api/notes/${n.id}/tags`, { tag });
      await alice.del(`/api/notes/${n.id}`);
      ids.push(n.id);
    }
    expect((await titles('/api/trash')).length).toBe(3);

    const res = await alice.del('/api/trash');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ deleted: 3 });

    expect(await titles('/api/trash')).toEqual([]);
    expect(await titles('/api/notes')).toEqual(['live quartz']);
    for (const id of ids) {
      expect((await alice.get(`/api/notes/${id}`)).status).toBe(404);
      expect((await alice.post(`/api/trash/${id}/restore`)).status).toBe(404);
    }
    // Tags: one used only by trashed notes is gone; one a live note uses stays.
    expect((await alice.get('/api/tags')).json.tags).toEqual([{ name: 'shared', count: 1 }]);
    expect((db().prepare('SELECT name FROM tags WHERE user_id = ?').all(aliceId) as any[]).map((t) => t.name)).toEqual(['shared']);
    // Search index: only the live note.
    expect(await titles('/api/search?q=quartz')).toEqual(['live quartz']);
    expect((db().prepare('SELECT COUNT(*) AS n FROM notes_fts WHERE user_id = ?').get(aliceId) as any).n).toBe(1);
    // Photos stay on disk, as with permanent delete.
    expect(existsSync(join(env.dataDir, 'users', aliceId, 'photos', photo.id))).toBe(true);
    expect((await alice.get(photo.url)).status).toBe(200);
  });

  it('with an empty trash it deletes nothing', async () => {
    const res = await alice.del('/api/trash');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ deleted: 0 });
    expect(await titles('/api/notes')).toEqual(['live quartz']);
  });

  it('needs a login', async () => {
    const { client } = await import('../helpers/setup');
    expect((await client(env.app).del('/api/trash')).status).toBe(401);
  });
});
