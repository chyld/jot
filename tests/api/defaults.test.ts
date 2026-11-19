// Type 2 (API integration): the five starter fonts are default fonts and can never be
// archived (for every user); fonts a user added can be archived and restored as before;
// a starter font that is already archived can be restored, and then not archived again.
// The five starter styles are ordinary styles: a new user can delete each one, and text
// already stamped with a style is unchanged.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestEnv, newUser, type Client, type TestEnv } from '../helpers/setup';

const STARTER_FONTS = ['Inter', 'Lora', 'Playfair Display', 'Caveat', 'Fira Code'];
const STARTER_STYLES = ['Body', 'Title', 'Quote', 'Aside', 'Code'];

let env: TestEnv;
let alice: Client;
let bob: Client;
const db = () => (env.app as any).jot.db;
const fontsOf = async (c: Client) => (await c.get('/api/fonts')).json.fonts as any[];

beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
  bob = await newUser(env, 'bob');
});
afterAll(() => env.close());

describe('default fonts', () => {
  it.each(STARTER_FONTS)('%s cannot be archived, for any user', async (family) => {
    for (const c of [alice, bob]) {
      const font = (await fontsOf(c)).find((f) => f.family === family);
      const res = await c.post(`/api/fonts/${font.id}/archive`);
      expect(res.status).toBe(400);
      expect(res.json.error).toMatch(/default font/i);
      expect((await fontsOf(c)).find((f) => f.id === font.id).archived).toBe(false);
    }
  });

  it('fonts the user added can still be archived and restored', async () => {
    const slab = (await alice.post('/api/fonts', { family: 'Roboto Slab' })).json.font;
    expect((await alice.post(`/api/fonts/${slab.id}/archive`)).json.font.archived).toBe(true);
    expect((await alice.post(`/api/fonts/${slab.id}/unarchive`)).json.font.archived).toBe(false);
    expect((await alice.post(`/api/fonts/${slab.id}/archive`)).json.font.archived).toBe(true);
  });

  it('a starter font that is already archived can be restored, and then not archived again', async () => {
    const lora = (await fontsOf(bob)).find((f) => f.family === 'Lora');
    // As in an account archived before this rule (no migration changes such data).
    db().prepare('UPDATE fonts SET archived_at = ? WHERE id = ?').run('2026-11-19T06:59:17.696Z', lora.id);
    expect((await fontsOf(bob)).find((f) => f.id === lora.id).archived).toBe(true);
    // Archiving it again is refused too (it stays archived until restored).
    expect((await bob.post(`/api/fonts/${lora.id}/archive`)).status).toBe(400);
    expect((await bob.post(`/api/fonts/${lora.id}/unarchive`)).json.font.archived).toBe(false);
    const again = await bob.post(`/api/fonts/${lora.id}/archive`);
    expect(again.status).toBe(400);
    expect((await fontsOf(bob)).find((f) => f.id === lora.id).archived).toBe(false);
  });

  it('the font list says which fonts are defaults', async () => {
    const fonts = await fontsOf(alice);
    for (const f of fonts) expect(f.isDefault, f.family).toBe(STARTER_FONTS.includes(f.family));
  });
});

describe('default styles', () => {
  const STANDARD = {
    Body: { fontFamily: 'Inter', size: 16, bold: false, italic: false, underline: false, strike: false, textColor: 'Jet', highlight: null },
    Title: { fontFamily: 'Playfair Display', size: 40, bold: true, italic: false, underline: false, strike: false, textColor: 'Jet', highlight: null },
    Quote: { fontFamily: 'Lora', size: 20, bold: false, italic: true, underline: false, strike: false, textColor: 'Violet', highlight: null },
    Aside: { fontFamily: 'Caveat', size: 24, bold: false, italic: false, underline: false, strike: false, textColor: 'Electric', highlight: null },
    Code: { fontFamily: 'Fira Code', size: 14, bold: false, italic: false, underline: false, strike: false, textColor: 'Jade', highlight: null },
  } as Record<string, object>;

  it('every new user has the five default styles, flagged, with their standard definitions', async () => {
    for (const c of [alice, bob]) {
      const styles = (await c.get('/api/styles')).json.styles as any[];
      expect(styles.map((s) => s.name).sort()).toEqual([...STARTER_STYLES].sort());
      for (const s of styles) {
        expect(s.isDefault, s.name).toBe(true);
        expect(s).toMatchObject(STANDARD[s.name]);
      }
    }
  });

  it.each(STARTER_STYLES)('%s cannot be edited, renamed or deleted, by any user; stamped text is untouched', async (name) => {
    for (const c of [alice, bob]) {
      const s = ((await c.get('/api/styles')).json.styles as any[]).find((x) => x.name === name);
      const stamped = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${name} text`, marks: [{ type: 'textStyle', attrs: { fontFamily: `"${s.fontFamily}"`, fontSize: `${s.size}px` } }] }] }] };
      const note = (await c.post('/api/notes', { title: `stamped ${name}`, content: stamped })).json.note;
      for (const res of [
        await c.put(`/api/styles/${s.id}`, { ...s, size: s.size + 2 }),
        await c.put(`/api/styles/${s.id}`, { ...s, name: `${name} 2` }),
        await c.put(`/api/styles/${s.id}`, { ...s, isDefault: false, bold: !s.bold }),
        await c.del(`/api/styles/${s.id}`),
      ]) {
        expect(res.status).toBe(400);
        expect(res.json.error).toMatch(/default style/i);
      }
      expect(((await c.get('/api/styles')).json.styles as any[]).find((x) => x.id === s.id)).toEqual(s);
      const after = (await c.get(`/api/notes/${note.id}`)).json.note;
      expect(after.content).toEqual(note.content);
    }
  });

  it('a style the user makes is ordinary, even when it is called Body, and stays editable and deletable', async () => {
    const inter = (await fontsOf(alice)).find((f) => f.family === 'Inter');
    // "Save selection as style" and "New style" both create ordinary styles.
    const mine = (await alice.post('/api/styles', { name: 'Body', fontId: inter.id, size: 30, isDefault: true })).json.style;
    expect(mine.isDefault).toBe(false);
    const edited = await alice.put(`/api/styles/${mine.id}`, { ...mine, name: 'My Body', size: 31 });
    expect(edited.status).toBe(200);
    expect(edited.json.style).toMatchObject({ name: 'My Body', size: 31, isDefault: false });
    expect((await alice.del(`/api/styles/${mine.id}`)).status).toBe(204);
    expect(((await alice.get('/api/styles')).json.styles as any[]).filter((s) => s.isDefault).length).toBe(5);
  });
});
