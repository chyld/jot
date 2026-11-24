// Type 1 (per-user isolation): style buttons. One user can never read or change
// another user's buttons, nor bind another user's style (default or custom).
import { afterAll, beforeAll, expect, it } from 'vitest';
import { client, makeTestEnv, newUser, type Client, type TestEnv } from '../helpers/setup';

let env: TestEnv;
let alice: Client;
let bob: Client;
let aliceCustom: any;
let aliceDefault: any;
let bobDefault: any;

beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
  bob = await newUser(env, 'bob');
  const aliceFont = (await alice.get('/api/fonts')).json.fonts[0];
  aliceCustom = (await alice.post('/api/styles', { name: 'Alice Accent', fontId: aliceFont.id, size: 22, bold: true })).json.style;
  aliceDefault = (await alice.get('/api/styles')).json.styles.find((s: any) => s.isDefault && s.name === 'Quote');
  bobDefault = (await bob.get('/api/styles')).json.styles.find((s: any) => s.isDefault && s.name === 'Body');
});
afterAll(() => env.close());

it('requires login', async () => {
  const anon = client(env.app);
  expect((await anon.get('/api/buttons')).status).toBe(401);
  expect((await anon.patch('/api/buttons/1', { hidden: true })).status).toBe(401);
});

it('buttons are strictly per user: Alice’s changes are invisible to Bob and vice versa', async () => {
  expect((await alice.patch('/api/buttons/1', { styleId: aliceCustom.id, hidden: true })).status).toBe(200);
  expect((await alice.patch('/api/buttons/2', { styleId: aliceDefault.id })).status).toBe(200);

  const bobButtons = (await bob.get('/api/buttons')).json.buttons;
  expect(bobButtons).toHaveLength(10);
  expect(bobButtons.every((b: any) => b.styleId === null && b.hidden === false)).toBe(true);

  expect((await bob.patch('/api/buttons/1', { styleId: bobDefault.id, hidden: false })).status).toBe(200);
  const aliceButtons = (await alice.get('/api/buttons')).json.buttons;
  expect(aliceButtons[0]).toEqual({ slot: 1, styleId: aliceCustom.id, hidden: true });
  expect(aliceButtons[1]).toEqual({ slot: 2, styleId: aliceDefault.id, hidden: false });
});

it('binding another user’s style (custom or default) is refused identically to a non-existent style', async () => {
  const missing = await bob.patch('/api/buttons/3', { styleId: 'nonexistentstyleid1234' });
  const foreignCustom = await bob.patch('/api/buttons/3', { styleId: aliceCustom.id });
  const foreignDefault = await bob.patch('/api/buttons/3', { styleId: aliceDefault.id });

  expect(missing.status).toBe(400);
  expect(foreignCustom.status).toBe(missing.status);
  expect(foreignCustom.json).toEqual(missing.json);
  expect(foreignDefault.status).toBe(missing.status);
  expect(foreignDefault.json).toEqual(missing.json);

  // Slot 3 stayed untouched.
  const bobSlot3 = (await bob.get('/api/buttons')).json.buttons.find((b: any) => b.slot === 3);
  expect(bobSlot3).toEqual({ slot: 3, styleId: null, hidden: false });
});

it('deleting Alice’s style never affects Bob’s buttons', async () => {
  const bobBefore = (await bob.get('/api/buttons')).json.buttons;
  expect((await alice.del(`/api/styles/${aliceCustom.id}`)).status).toBe(204);
  expect((await bob.get('/api/buttons')).json.buttons).toEqual(bobBefore);
  expect((await alice.get('/api/buttons')).json.buttons[0]).toEqual({ slot: 1, styleId: null, hidden: true });
});
