// Type 2 (API integration): the Google Fonts catalogue and private font download.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestEnv, newUser, type Client, type TestEnv } from '../helpers/setup';
import { WOFF2_BYTES } from '../helpers/fakeGoogle';
import { downloadFamily, FontError } from '../../src/server/fonts';

let env: TestEnv;
let alice: Client;
let aliceId: string;
beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
  aliceId = (await alice.get('/api/me')).json.user.id;
});
afterAll(() => env.close());

describe('catalogue', () => {
  it('lists Google Fonts families with their category', async () => {
    const res = await alice.get('/api/fonts/catalog');
    expect(res.status).toBe(200);
    expect(res.json.fonts).toContainEqual({ family: 'Roboto Slab', category: 'Serif' });
    expect(res.json.fonts).toContainEqual({ family: 'Bebas Neue', category: 'Display' });
  });
});

describe('adding a font', () => {
  it('downloads the files into the user’s fonts folder', async () => {
    const res = await alice.post('/api/fonts', { family: 'Roboto Slab' });
    expect(res.status).toBe(201);
    const font = res.json.font;
    expect(font).toMatchObject({ family: 'Roboto Slab', category: 'Serif', archived: false });
    const dir = join(env.dataDir, 'users', aliceId, 'fonts', font.id);
    expect(existsSync(dir)).toBe(true);
    // 2 weights x 2 subsets in the fake catalogue
    expect(readdirSync(dir).filter((f) => f.endsWith('.woff2')).length).toBe(4);
    expect(env.google.css2Requests.some((q) => decodeURIComponent(q).includes('Roboto Slab:wght@400;700'))).toBe(true);
  });

  it('serves the font from Jot, not Google', async () => {
    const font = (await alice.post('/api/fonts', { family: 'Bebas Neue' })).json.font;
    const css = await alice.get('/api/fonts.css');
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toMatch(/text\/css/);
    expect(css.body).toContain('font-family: "Bebas Neue"');
    expect(css.body).toContain(`/api/fonts/${font.id}/files/0.woff2`);
    expect(css.body).not.toContain(env.google.origin);
    const file = await alice.get(`/api/fonts/${font.id}/files/0.woff2`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('font/woff2');
    expect(Buffer.compare(file.rawPayload, WOFF2_BYTES)).toBe(0);
  });

  it('lists the user’s fonts', async () => {
    const list = (await alice.get('/api/fonts')).json.fonts;
    expect(list.map((f: any) => f.family)).toEqual(expect.arrayContaining(['Roboto Slab', 'Bebas Neue']));
  });

  it('adding the same font twice keeps one copy', async () => {
    const first = (await alice.post('/api/fonts', { family: 'Space Grotesk' })).json.font;
    const again = await alice.post('/api/fonts', { family: 'Space Grotesk' });
    expect(again.status).toBe(200);
    expect(again.json.font.id).toBe(first.id);
    const list = (await alice.get('/api/fonts')).json.fonts.filter((f: any) => f.family === 'Space Grotesk');
    expect(list.length).toBe(1);
  });

  it('rejects families that are not in the catalogue', async () => {
    const res = await alice.post('/api/fonts', { family: 'Comic Neue Fake' });
    expect(res.status).toBe(400);
    expect((await alice.post('/api/fonts', {})).status).toBe(400);
  });

  it('reports a download failure and keeps nothing', async () => {
    const before = (await alice.get('/api/fonts')).json.fonts.length;
    const res = await alice.post('/api/fonts', { family: 'Broken Font' });
    expect(res.status).toBe(502);
    expect((await alice.get('/api/fonts')).json.fonts.length).toBe(before);
  });
});

describe('download failures', () => {
  it('retries a failed font file once before giving up', async () => {
    const res = await alice.post('/api/fonts', { family: 'Flaky Font' });
    expect(res.status).toBe(201);
    const file = await alice.get(`/api/fonts/${res.json.font.id}/files/0.woff2`);
    expect(Buffer.compare(file.rawPayload, WOFF2_BYTES)).toBe(0);
  });

  it('gives up after the retry, keeps nothing, and reports 502', async () => {
    const before = (await alice.get('/api/fonts')).json.fonts.length;
    const res = await alice.post('/api/fonts', { family: 'Dead Files' });
    expect(res.status).toBe(502);
    expect(res.json.error).toMatch(/Dead Files/);
    expect((await alice.get('/api/fonts')).json.fonts.length).toBe(before);
    expect(readdirSync(join(env.dataDir, 'users', aliceId, 'fonts')).length).toBe(before);
  });

  it('keeps the underlying cause of a failure (so the server can log it)', async () => {
    const dir = join(env.dataDir, 'scratch-font');
    const err = await downloadFamily(env.google.config, 'Dead Files', ['400'], dir).catch((e) => e);
    expect(err).toBeInstanceOf(FontError);
    expect(err.status).toBe(502);
    expect(String(err.cause?.message ?? err.cause)).toMatch(/503/);
    expect(existsSync(dir)).toBe(false);
  });
});

describe('archiving', () => {
  it('archives a font but keeps serving it', async () => {
    const font = (await alice.post('/api/fonts', { family: 'Merriweather' })).json.font;
    const res = await alice.post(`/api/fonts/${font.id}/archive`);
    expect(res.status).toBe(200);
    expect(res.json.font.archived).toBe(true);
    const listed = (await alice.get('/api/fonts')).json.fonts.find((f: any) => f.id === font.id);
    expect(listed.archived).toBe(true);
    expect((await alice.get('/api/fonts.css')).body).toContain(`/api/fonts/${font.id}/files/`);
    expect((await alice.get(`/api/fonts/${font.id}/files/0.woff2`)).status).toBe(200);
  });

  it('cannot delete a font', async () => {
    const font = (await alice.get('/api/fonts')).json.fonts[0];
    const res = await alice.del(`/api/fonts/${font.id}`);
    expect([404, 405]).toContain(res.status);
    expect((await alice.get('/api/fonts')).json.fonts.some((f: any) => f.id === font.id)).toBe(true);
  });

  it('unarchives, and adding an archived font again unarchives it', async () => {
    const font = (await alice.post('/api/fonts', { family: 'Merriweather' })).json.font;
    expect(font.archived).toBe(false);
    await alice.post(`/api/fonts/${font.id}/archive`);
    const res = await alice.post(`/api/fonts/${font.id}/unarchive`);
    expect(res.status).toBe(200);
    expect(res.json.font.archived).toBe(false);
  });
});
