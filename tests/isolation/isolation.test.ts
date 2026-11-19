// Type 1 (per-user isolation): for every route and every kind of data (notes, tags,
// photos, fonts, styles, search, trash), user B can never read or change user A's.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { doc, makeTestEnv, newUser, PNG_1PX, type Client, type TestEnv } from '../helpers/setup';

let env: TestEnv;
let alice: Client;
let bob: Client;

// Alice's data
let note: any; // live note with a tag and a unique word
let trashed: any; // note in alice's trash
let photo: any;
let font: any; // a font alice added
let starterFont: any; // one of alice's starter fonts
let style: any;

const SECRET = 'xylophonesecret';
const SECRET_TAG = 'privatetag';

beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
  bob = await newUser(env, 'bob');

  note = (await alice.post('/api/notes', { title: `Alice ${SECRET}`, content: doc(`body ${SECRET}`) })).json.note;
  await alice.post(`/api/notes/${note.id}/tags`, { tag: SECRET_TAG });
  trashed = (await alice.post('/api/notes', { title: 'Alice trashed', content: doc('trashedword') })).json.note;
  await alice.post(`/api/notes/${trashed.id}/tags`, { tag: 'trashtag' });
  await alice.del(`/api/notes/${trashed.id}`);
  photo = (await alice.upload('/api/photos', 'a.png', PNG_1PX, 'image/png')).json.photo;
  font = (await alice.post('/api/fonts', { family: 'Roboto Slab' })).json.font;
  starterFont = (await alice.get('/api/fonts')).json.fonts.find((f: any) => f.family === 'Inter');
  style = (await alice.post('/api/styles', { name: 'Alice Style', fontId: font.id, size: 22, bold: true })).json.style;
});
afterAll(() => env.close());

async function aliceStillHasEverything() {
  const n = await alice.get(`/api/notes/${note.id}`);
  expect(n.status).toBe(200);
  expect(n.json.note.title).toBe(`Alice ${SECRET}`);
  expect(n.json.note.tags).toEqual([SECRET_TAG]);
  expect(n.json.note.deletedAt).toBeNull();
  expect((await alice.get('/api/trash')).json.notes.map((x: any) => x.id)).toContain(trashed.id);
  expect((await alice.get(photo.url)).status).toBe(200);
  const f = (await alice.get('/api/fonts')).json.fonts.find((x: any) => x.id === font.id);
  expect(f.archived).toBe(false);
  const s = (await alice.get('/api/styles')).json.styles.find((x: any) => x.id === style.id);
  expect(s).toMatchObject({ name: 'Alice Style', size: 22, bold: true });
}

describe('notes', () => {
  it('B cannot read A’s note by id', async () => {
    expect((await bob.get(`/api/notes/${note.id}`)).status).toBe(404);
    expect((await bob.get(`/api/notes/${trashed.id}`)).status).toBe(404);
  });

  it('B does not see A’s notes in the list', async () => {
    const ids = (await bob.get('/api/notes')).json.notes.map((n: any) => n.id);
    expect(ids).not.toContain(note.id);
    expect((await bob.get(`/api/notes?tag=${SECRET_TAG}`)).json.notes).toEqual([]);
  });

  it('B cannot change, tag, untag or trash A’s note', async () => {
    expect((await bob.patch(`/api/notes/${note.id}`, { title: 'pwned', content: doc('pwned') })).status).toBe(404);
    expect((await bob.post(`/api/notes/${note.id}/tags`, { tag: 'pwned' })).status).toBe(404);
    expect((await bob.del(`/api/notes/${note.id}/tags/${SECRET_TAG}`)).status).toBe(404);
    expect((await bob.del(`/api/notes/${note.id}`)).status).toBe(404);
    await aliceStillHasEverything();
  });
});

describe('tags', () => {
  it('B does not see A’s tags', async () => {
    const names = (await bob.get('/api/tags')).json.tags.map((t: any) => t.name);
    expect(names).not.toContain(SECRET_TAG);
    expect(names).not.toContain('trashtag');
  });

  it('B using the same tag name gets a separate tag', async () => {
    const bnote = (await bob.post('/api/notes', { title: 'Bob note' })).json.note;
    await bob.post(`/api/notes/${bnote.id}/tags`, { tag: SECRET_TAG });
    expect((await bob.get(`/api/notes?tag=${SECRET_TAG}`)).json.notes.map((n: any) => n.id)).toEqual([bnote.id]);
    expect((await alice.get(`/api/notes?tag=${SECRET_TAG}`)).json.notes.map((n: any) => n.id)).toEqual([note.id]);
    expect((await bob.get('/api/tags')).json.tags.find((t: any) => t.name === SECRET_TAG).count).toBe(1);
    expect((await alice.get('/api/tags')).json.tags.find((t: any) => t.name === SECRET_TAG).count).toBe(1);
  });
});

describe('search', () => {
  it('B’s search never returns A’s notes', async () => {
    for (const q of [SECRET, 'alice', `#${SECRET_TAG}`, SECRET_TAG, 'trashedword', 'body', '*', '"', 'a OR b']) {
      const res = await bob.get(`/api/search?q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      const ids = res.json.notes.map((n: any) => n.id);
      expect(ids).not.toContain(note.id);
      expect(ids).not.toContain(trashed.id);
    }
  });
});

describe('trash', () => {
  it('B does not see A’s trash', async () => {
    expect((await bob.get('/api/trash')).json.notes.map((n: any) => n.id)).not.toContain(trashed.id);
  });

  it('B cannot restore or permanently delete A’s trashed note', async () => {
    expect((await bob.post(`/api/trash/${trashed.id}/restore`)).status).toBe(404);
    expect((await bob.del(`/api/trash/${trashed.id}`)).status).toBe(404);
    await aliceStillHasEverything();
  });
});

describe('photos', () => {
  it('B cannot fetch A’s photo', async () => {
    const res = await bob.get(photo.url);
    expect(res.status).toBe(404);
    expect(res.rawPayload.includes(PNG_1PX)).toBe(false);
  });

  it('B’s note referencing A’s photo still does not unlock it', async () => {
    const bnote = (await bob.post('/api/notes', { title: 'steal', content: { type: 'doc', content: [{ type: 'image', attrs: { src: photo.url } }] } })).json.note;
    expect(bnote.id).toBeTruthy();
    expect((await bob.get(photo.url)).status).toBe(404);
  });
});

describe('fonts', () => {
  it('B does not see A’s fonts', async () => {
    const ids = (await bob.get('/api/fonts')).json.fonts.map((f: any) => f.id);
    expect(ids).not.toContain(font.id);
    expect(ids).not.toContain(starterFont.id);
    expect((await bob.get('/api/fonts')).json.fonts.map((f: any) => f.family)).not.toContain('Roboto Slab');
  });

  it('B’s font CSS does not reference A’s fonts', async () => {
    const css = (await bob.get('/api/fonts.css')).body;
    expect(css).not.toContain(font.id);
    expect(css).not.toContain(starterFont.id);
  });

  it('B cannot download A’s font files', async () => {
    expect((await bob.get(`/api/fonts/${font.id}/files/0.woff2`)).status).toBe(404);
    expect((await bob.get(`/api/fonts/${starterFont.id}/files/0.woff2`)).status).toBe(404);
  });

  it('B cannot archive or unarchive A’s fonts', async () => {
    expect((await bob.post(`/api/fonts/${font.id}/archive`)).status).toBe(404);
    expect((await bob.post(`/api/fonts/${font.id}/unarchive`)).status).toBe(404);
    await aliceStillHasEverything();
  });
});

describe('styles', () => {
  it('B does not see A’s styles', async () => {
    const styles = (await bob.get('/api/styles')).json.styles;
    expect(styles.map((s: any) => s.id)).not.toContain(style.id);
    expect(styles.map((s: any) => s.name)).not.toContain('Alice Style');
  });

  it('B cannot edit or delete A’s style', async () => {
    const bobFont = (await bob.get('/api/fonts')).json.fonts[0];
    expect((await bob.put(`/api/styles/${style.id}`, { name: 'pwned', fontId: bobFont.id, size: 10 })).status).toBe(404);
    expect((await bob.del(`/api/styles/${style.id}`)).status).toBe(404);
    await aliceStillHasEverything();
  });

  it('B cannot build a style on A’s font', async () => {
    const res = await bob.post('/api/styles', { name: 'Borrowed', fontId: font.id, size: 12 });
    expect(res.status).toBe(400);
    const bobStyle = (await bob.get('/api/styles')).json.styles[0];
    expect((await bob.put(`/api/styles/${bobStyle.id}`, { ...bobStyle, fontId: starterFont.id })).status).toBe(400);
  });
});

describe('every route, both directions', () => {
  it('A cannot reach B’s data either', async () => {
    const bnote = (await bob.post('/api/notes', { title: 'Bob only', content: doc('bobword') })).json.note;
    const bphoto = (await bob.upload('/api/photos', 'b.png', PNG_1PX, 'image/png')).json.photo;
    const bfont = (await bob.get('/api/fonts')).json.fonts[0];
    const bstyle = (await bob.get('/api/styles')).json.styles[0];
    const checks: Array<[string, Promise<any>]> = [
      ['GET note', alice.get(`/api/notes/${bnote.id}`)],
      ['PATCH note', alice.patch(`/api/notes/${bnote.id}`, { title: 'x' })],
      ['POST tag', alice.post(`/api/notes/${bnote.id}/tags`, { tag: 'x' })],
      ['DELETE note', alice.del(`/api/notes/${bnote.id}`)],
      ['GET photo', alice.get(bphoto.url)],
      ['GET font file', alice.get(`/api/fonts/${bfont.id}/files/0.woff2`)],
      ['archive font', alice.post(`/api/fonts/${bfont.id}/archive`)],
      ['PUT style', alice.put(`/api/styles/${bstyle.id}`, { name: 'x', fontId: starterFont.id, size: 12 })],
      ['DELETE style', alice.del(`/api/styles/${bstyle.id}`)],
    ];
    for (const [label, p] of checks) {
      const res = await p;
      expect(res.status, label).toBe(404);
    }
    expect((await alice.get('/api/search?q=bobword')).json.notes).toEqual([]);
    expect((await bob.get(`/api/notes/${bnote.id}`)).json.note.title).toBe('Bob only');
  });
});
