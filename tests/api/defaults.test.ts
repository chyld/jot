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
  it('a new user can delete each starter style; text already stamped with it is unchanged', async () => {
    const carol = await newUser(env, 'carol');
    const styles = (await carol.get('/api/styles')).json.styles as any[];
    expect(styles.map((s) => s.name).sort()).toEqual([...STARTER_STYLES].sort());
    // A note stamped with each style (a style is stamped as plain formatting).
    const stamped = {
      type: 'doc',
      content: styles.map((s) => ({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: `${s.name} text`,
            marks: [
              ...(s.bold ? [{ type: 'bold' }] : []),
              ...(s.italic ? [{ type: 'italic' }] : []),
              { type: 'textStyle', attrs: { fontFamily: `"${s.fontFamily}"`, fontSize: `${s.size}px`, ...(s.textColor ? { color: s.textColor } : {}) } },
            ],
          },
        ],
      })),
    };
    const note = (await carol.post('/api/notes', { title: 'stamped', content: stamped })).json.note;
    const before = (await carol.get(`/api/notes/${note.id}`)).json.note;
    for (const s of styles) expect((await carol.del(`/api/styles/${s.id}`)).status, s.name).toBe(204);
    expect((await carol.get('/api/styles')).json.styles).toEqual([]);
    const after = (await carol.get(`/api/notes/${note.id}`)).json.note;
    expect(after.content).toEqual(before.content);
    expect(after.updatedAt).toBe(before.updatedAt);
  });
});
