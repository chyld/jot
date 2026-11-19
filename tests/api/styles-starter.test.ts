// Type 2 (API integration): styles, and the starter pack every new user receives.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestEnv, newUser, type Client, type TestEnv } from '../helpers/setup';

let env: TestEnv;
let alice: Client;
let bob: Client;
let fontsByFamily: Record<string, any>;
beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
  bob = await newUser(env, 'bob');
  fontsByFamily = Object.fromEntries((await alice.get('/api/fonts')).json.fonts.map((f: any) => [f.family, f]));
});
afterAll(() => env.close());

describe('starter pack', () => {
  it('gives a new user the five starter fonts', async () => {
    const fonts = (await alice.get('/api/fonts')).json.fonts;
    expect(fonts.map((f: any) => f.family).sort()).toEqual(['Caveat', 'Fira Code', 'Inter', 'Lora', 'Playfair Display']);
    expect(fonts.every((f: any) => f.archived === false)).toBe(true);
  });

  it('stores real font files for each starter font in the user’s folder', async () => {
    const me = (await alice.get('/api/me')).json.user;
    for (const font of (await alice.get('/api/fonts')).json.fonts) {
      const dir = join(env.dataDir, 'users', me.id, 'fonts', font.id);
      expect(existsSync(dir)).toBe(true);
      expect(readdirSync(dir).some((f) => f.endsWith('.woff2'))).toBe(true);
      const file = await alice.get(`/api/fonts/${font.id}/files/0.woff2`);
      expect(file.status).toBe(200);
      expect(file.rawPayload.subarray(0, 4).toString()).toBe('wOF2');
    }
    const css = (await alice.get('/api/fonts.css')).body;
    for (const fam of ['Inter', 'Lora', 'Playfair Display', 'Caveat', 'Fira Code']) expect(css).toContain(`font-family: "${fam}"`);
  });

  it('gives a new user the five starter styles exactly as specified', async () => {
    const styles = (await alice.get('/api/styles')).json.styles;
    const simplify = (s: any) => [s.name, s.fontFamily, s.size, s.bold, s.italic, s.underline, s.strike, s.textColor, s.highlight];
    expect(styles.map(simplify)).toEqual([
      ['Aside', 'Caveat', 24, false, false, false, false, 'Electric', null],
      ['Body', 'Inter', 16, false, false, false, false, 'Jet', null],
      ['Code', 'Fira Code', 14, false, false, false, false, 'Jade', null],
      ['Quote', 'Lora', 20, false, true, false, false, 'Violet', null],
      ['Title', 'Playfair Display', 40, true, false, false, false, 'Jet', null],
    ]);
    for (const s of styles) expect(s.fontId).toBe(fontsByFamily[s.fontFamily].id);
  });

  it('gives each user their own copy', async () => {
    const aFonts = (await alice.get('/api/fonts')).json.fonts.map((f: any) => f.id);
    const bFonts = (await bob.get('/api/fonts')).json.fonts.map((f: any) => f.id);
    expect(aFonts.filter((id: string) => bFonts.includes(id))).toEqual([]);
    const aStyles = (await alice.get('/api/styles')).json.styles;
    const bStyles = (await bob.get('/api/styles')).json.styles;
    expect(aStyles.map((s: any) => s.id).filter((id: string) => bStyles.some((b: any) => b.id === id))).toEqual([]);

  });

  it('starter fonts are default fonts (not archivable); starter styles are default styles (not editable or deletable)', async () => {
    const carol = await newUser(env, 'carol');
    const fonts = (await carol.get('/api/fonts')).json.fonts;
    const caveat = fonts.find((f: any) => f.family === 'Caveat');
    expect((await carol.post(`/api/fonts/${caveat.id}/archive`)).status).toBe(400);
    const aside = (await carol.get('/api/styles')).json.styles.find((s: any) => s.name === 'Aside');
    expect((await carol.del(`/api/styles/${aside.id}`)).status).toBe(400);
  });
});

describe('styles', () => {
  it('creates a style', async () => {
    const res = await alice.post('/api/styles', {
      name: 'Key Term',
      fontId: fontsByFamily['Inter'].id,
      size: 16,
      bold: true,
      highlight: 'Sunflower',
    });
    expect(res.status).toBe(201);
    expect(res.json.style).toMatchObject({
      name: 'Key Term',
      fontId: fontsByFamily['Inter'].id,
      fontFamily: 'Inter',
      size: 16,
      bold: true,
      italic: false,
      underline: false,
      strike: false,
      textColor: null,
      highlight: 'Sunflower',
    });
    expect(res.json.style.id).toBeTruthy();
  });

  it('lists styles sorted by name', async () => {
    const names = (await alice.get('/api/styles')).json.styles.map((s: any) => s.name.toLowerCase());
    expect([...names].sort()).toEqual(names);
  });

  it('edits a style', async () => {
    const style = (await alice.post('/api/styles', { name: 'Edit me', fontId: fontsByFamily['Lora'].id, size: 20 })).json.style;
    const res = await alice.put(`/api/styles/${style.id}`, {
      name: 'Edited',
      fontId: fontsByFamily['Caveat'].id,
      size: 30,
      italic: true,
      textColor: 'Crimson',
    });
    expect(res.status).toBe(200);
    expect(res.json.style).toMatchObject({ id: style.id, name: 'Edited', fontFamily: 'Caveat', size: 30, italic: true, textColor: 'Crimson' });
    expect(res.json.style.updatedAt >= style.updatedAt).toBe(true);
  });

  it('deletes a style', async () => {
    const style = (await alice.post('/api/styles', { name: 'Delete me', fontId: fontsByFamily['Lora'].id, size: 20 })).json.style;
    expect((await alice.del(`/api/styles/${style.id}`)).status).toBe(204);
    expect((await alice.get('/api/styles')).json.styles.some((s: any) => s.id === style.id)).toBe(false);
    expect((await alice.del(`/api/styles/${style.id}`)).status).toBe(404);
  });

  it('validates styles', async () => {
    const fontId = fontsByFamily['Inter'].id;
    for (const bad of [
      { fontId, size: 16 },
      { name: 'X', size: 16 },
      { name: 'X', fontId, size: 2 },
      { name: 'X', fontId, size: 16, textColor: '#ff0000' },
      { name: 'X', fontId: 'nosuchfont123', size: 16 },
    ]) {
      const res = await alice.post('/api/styles', bad);
      expect(res.status).toBe(400);
      expect(typeof res.json.error).toBe('string');
    }
  });

  it('keeps working when its font is archived', async () => {
    const font = (await alice.post('/api/fonts', { family: 'Roboto Slab' })).json.font;
    const style = (await alice.post('/api/styles', { name: 'Slab', fontId: font.id, size: 18 })).json.style;
    await alice.post(`/api/fonts/${font.id}/archive`);
    const listed = (await alice.get('/api/styles')).json.styles.find((s: any) => s.id === style.id);
    expect(listed).toMatchObject({ fontId: font.id, fontFamily: 'Roboto Slab', fontArchived: true });
    // Editing other parts of a style whose font is archived still works.
    const res = await alice.put(`/api/styles/${style.id}`, { name: 'Slab 2', fontId: font.id, size: 19 });
    expect(res.status).toBe(200);
  });
});
