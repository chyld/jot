// Type 2 (API integration): style buttons CRUD, style deletion unbinding, validation,
// and personal backup/restore (format 5, including default-style bindings and older backups).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openBackup, packBackup, restore, stage, takeBackup } from '../helpers/backup';
import { makeTestEnv, newUser, type Client, type TestEnv } from '../helpers/setup';

let env: TestEnv;
let alice: Client;
let interId: string;

beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
  interId = (await alice.get('/api/fonts')).json.fonts.find((f: any) => f.family === 'Inter').id;
});
afterAll(() => env.close());

describe('style buttons API', () => {
  it('defaults to ten unbound, shown buttons in slot order 1–10', async () => {
    const res = await alice.get('/api/buttons');
    expect(res.status).toBe(200);
    expect(res.json.buttons).toEqual(Array.from({ length: 10 }, (_, i) => ({ slot: i + 1, styleId: null, hidden: false })));
  });

  it('binds default and custom styles, swaps, clears, allows duplicates, and hides/shows keeping binding', async () => {
    const styles = (await alice.get('/api/styles')).json.styles as any[];
    const quote = styles.find((s) => s.isDefault && s.name === 'Quote');
    const custom = (await alice.post('/api/styles', { name: 'Warning', fontId: interId, size: 18, bold: true, textColor: 'Crimson' })).json.style;

    // Bind default style to slot 1 and custom style to slots 2 and 7 (same style on two buttons).
    expect((await alice.patch('/api/buttons/1', { styleId: quote.id })).json.button).toEqual({ slot: 1, styleId: quote.id, hidden: false });
    expect((await alice.patch('/api/buttons/2', { styleId: custom.id })).json.button).toEqual({ slot: 2, styleId: custom.id, hidden: false });
    expect((await alice.patch('/api/buttons/7', { styleId: custom.id })).json.button).toEqual({ slot: 7, styleId: custom.id, hidden: false });

    // Swap slot 1 to custom, then back to Quote.
    expect((await alice.patch('/api/buttons/1', { styleId: custom.id })).json.button).toEqual({ slot: 1, styleId: custom.id, hidden: false });
    expect((await alice.patch('/api/buttons/1', { styleId: quote.id })).json.button).toEqual({ slot: 1, styleId: quote.id, hidden: false });

    // Hide slot 2: binding is kept while hidden; show again restores visibility with same binding.
    expect((await alice.patch('/api/buttons/2', { hidden: true })).json.button).toEqual({ slot: 2, styleId: custom.id, hidden: true });
    expect((await alice.get('/api/buttons')).json.buttons[1]).toEqual({ slot: 2, styleId: custom.id, hidden: true });
    expect((await alice.patch('/api/buttons/2', { hidden: false })).json.button).toEqual({ slot: 2, styleId: custom.id, hidden: false });

    // Clear slot 7 back to no style.
    expect((await alice.patch('/api/buttons/7', { styleId: null })).json.button).toEqual({ slot: 7, styleId: null, hidden: false });
    expect((await alice.get('/api/buttons')).json.buttons[6]).toEqual({ slot: 7, styleId: null, hidden: false });
  });

  it('deleting a style unbinds every button bound to it', async () => {
    const temp = (await alice.post('/api/styles', { name: 'Temporary', fontId: interId, size: 15 })).json.style;
    await alice.patch('/api/buttons/4', { styleId: temp.id });
    await alice.patch('/api/buttons/9', { styleId: temp.id, hidden: true });

    expect((await alice.del(`/api/styles/${temp.id}`)).status).toBe(204);
    const list = (await alice.get('/api/buttons')).json.buttons;
    expect(list[3]).toEqual({ slot: 4, styleId: null, hidden: false });
    expect(list[8]).toEqual({ slot: 9, styleId: null, hidden: true });
  });

  it('refuses invalid slots, unknown fields, wrong types and unknown styles', async () => {
    for (const slot of ['0', '11', '-1', '1.5', '01', 'abc']) {
      const r = await alice.patch(`/api/buttons/${slot}`, { hidden: true });
      expect(r.status, slot).toBe(400);
      expect(typeof r.json.error).toBe('string');
    }
    for (const bad of [{}, { foo: 'bar' }, { hidden: true, extra: 1 }, { hidden: 'yes' }, { styleId: 123 }, { styleId: '' }, { styleId: 'nosuchstyleid123456789' }]) {
      const r = await alice.patch('/api/buttons/1', bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(typeof r.json.error).toBe('string');
    }
  });
});

describe('personal backup and restore of style buttons', () => {
  it('round-trips bindings (custom, default, duplicate, custom named "Body") and hidden flags, including across accounts', async () => {
    const src = await newUser(env, 'btn_src');
    const dst = await newUser(env, 'btn_dst');
    const srcInter = (await src.get('/api/fonts')).json.fonts.find((f: any) => f.family === 'Inter').id;
    const srcDefaults = Object.fromEntries((await src.get('/api/styles')).json.styles.filter((s: any) => s.isDefault).map((s: any) => [s.name, s]));
    const ownBody = (await src.post('/api/styles', { name: 'Body', fontId: srcInter, size: 22, bold: true })).json.style;
    const shout = (await src.post('/api/styles', { name: 'Shout', fontId: srcInter, size: 28, textColor: 'Tangerine' })).json.style;

    await src.patch('/api/buttons/1', { styleId: srcDefaults['Quote'].id, hidden: false });
    await src.patch('/api/buttons/2', { styleId: shout.id, hidden: false });
    await src.patch('/api/buttons/3', { styleId: shout.id, hidden: true });
    await src.patch('/api/buttons/4', { styleId: ownBody.id, hidden: false });
    await src.patch('/api/buttons/5', { styleId: srcDefaults['Body'].id, hidden: true });
    await src.patch('/api/buttons/8', { hidden: true });

    const { file } = await takeBackup(src);
    const opened = openBackup(file);
    expect(opened.manifest.version).toBe(6);
    expect(opened.data.buttons).toHaveLength(10);
    expect(opened.data.buttons[0]).toEqual({ slot: 1, styleId: null, defaultStyle: 'Quote', hidden: false });
    expect(opened.data.buttons[1]).toEqual({ slot: 2, styleId: shout.id, defaultStyle: null, hidden: false });
    expect(opened.data.buttons[2]).toEqual({ slot: 3, styleId: shout.id, defaultStyle: null, hidden: true });
    expect(opened.data.buttons[3]).toEqual({ slot: 4, styleId: ownBody.id, defaultStyle: null, hidden: false });
    expect(opened.data.buttons[4]).toEqual({ slot: 5, styleId: null, defaultStyle: 'Body', hidden: true });
    expect(opened.data.buttons[7]).toEqual({ slot: 8, styleId: null, defaultStyle: null, hidden: true });

    // Scramble src's buttons and styles, then restore.
    for (let slot = 1; slot <= 10; slot++) await src.patch(`/api/buttons/${slot}`, { styleId: null, hidden: false });
    await src.del(`/api/styles/${shout.id}`);
    expect((await restore(src, file)).done.status).toBe(200);

    const checkAccount = async (c: Client) => {
      const styles = (await c.get('/api/styles')).json.styles as any[];
      const byId = new Map(styles.map((s) => [s.id, s]));
      const btns = (await c.get('/api/buttons')).json.buttons as any[];
      const summary = btns.map((b) => {
        const s = b.styleId ? byId.get(b.styleId) : null;
        return { slot: b.slot, hidden: b.hidden, style: s ? `${s.isDefault ? 'default:' : 'own:'}${s.name}` : null };
      });
      expect(summary).toEqual([
        { slot: 1, hidden: false, style: 'default:Quote' },
        { slot: 2, hidden: false, style: 'own:Shout' },
        { slot: 3, hidden: true, style: 'own:Shout' },
        { slot: 4, hidden: false, style: 'own:Body' },
        { slot: 5, hidden: true, style: 'default:Body' },
        { slot: 6, hidden: false, style: null },
        { slot: 7, hidden: false, style: null },
        { slot: 8, hidden: true, style: null },
        { slot: 9, hidden: false, style: null },
        { slot: 10, hidden: false, style: null },
      ]);
    };

    await checkAccount(src);

    // Restoring into another account remaps both custom styles and default styles cleanly.
    expect((await restore(dst, file)).done.status).toBe(200);
    await checkAccount(dst);
  });

  it('restores an older format 4 backup (without buttons) with all ten buttons unbound and shown', async () => {
    const u = await newUser(env, 'btn_old');
    const quote = (await u.get('/api/styles')).json.styles.find((s: any) => s.name === 'Quote');
    const b = openBackup((await takeBackup(u)).file);
    b.manifest.version = 4;
    delete b.data.buttons;
    const oldTar = packBackup(b);

    // Bind and hide buttons before restoring the older backup.
    await u.patch('/api/buttons/1', { styleId: quote.id, hidden: true });
    await u.patch('/api/buttons/2', { styleId: quote.id, hidden: false });

    const r = await restore(u, oldTar);
    expect(r.done.status, r.done.body).toBe(200);
    expect((await u.get('/api/buttons')).json.buttons).toEqual(
      Array.from({ length: 10 }, (_, i) => ({ slot: i + 1, styleId: null, hidden: false })),
    );
  });

  it('refuses a format 5 backup with invalid button entries', async () => {
    const u = await newUser(env, 'btn_bad');
    const inter = (await u.get('/api/fonts')).json.fonts.find((f: any) => f.family === 'Inter').id;
    const mine = (await u.post('/api/styles', { name: 'Mine', fontId: inter, size: 17 })).json.style;
    const base = (await takeBackup(u)).file;

    const badCases: Record<string, (data: any) => void> = {
      missingArray: (d) => (d.buttons = 'nope'),
      badSlot: (d) => (d.buttons = [{ slot: 11, styleId: null, defaultStyle: null, hidden: false }]),
      dupSlot: (d) =>
        (d.buttons = [
          { slot: 1, styleId: null, defaultStyle: null, hidden: false },
          { slot: 1, styleId: null, defaultStyle: null, hidden: true },
        ]),
      badHidden: (d) => (d.buttons = [{ slot: 1, styleId: null, defaultStyle: null, hidden: 1 }]),
      unknownDefault: (d) => (d.buttons = [{ slot: 1, styleId: null, defaultStyle: 'MadeUp', hidden: false }]),
      unknownStyle: (d) => (d.buttons = [{ slot: 1, styleId: 'Abcdefghijklmnopqrstuv', defaultStyle: null, hidden: false }]),
      bothSet: (d) => (d.buttons = [{ slot: 1, styleId: mine.id, defaultStyle: 'Quote', hidden: false }]),
    };

    for (const [name, mutate] of Object.entries(badCases)) {
      const b = openBackup(base);
      mutate(b.data);
      const res = await stage(u, packBackup(b));
      expect(res.status, name).toBe(400);
    }
  });
});
