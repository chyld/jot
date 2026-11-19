// Type 2 (API integration): photo upload and serving.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GIF_1PX, JPEG_HEAD, makeTestEnv, newUser, PNG_1PX, WEBP_HEAD, type Client, type TestEnv } from '../helpers/setup';

let env: TestEnv;
let alice: Client;
let aliceId: string;
beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
  aliceId = (await alice.get('/api/me')).json.user.id;
});
afterAll(() => env.close());

describe('photos', () => {
  it('uploads a PNG and serves it back to its owner', async () => {
    const res = await alice.upload('/api/photos', 'tiny.png', PNG_1PX, 'image/png');
    expect(res.status).toBe(201);
    const { id, url, mime } = res.json.photo;
    expect(id).toMatch(/^[A-Za-z0-9_-]{10,}$/);
    expect(url).toBe(`/api/photos/${id}`);
    expect(mime).toBe('image/png');
    const got = await alice.get(url);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(got.rawPayload, PNG_1PX)).toBe(0);
  });

  it('stores photos in the user’s own photos folder', async () => {
    const res = await alice.upload('/api/photos', 'x.png', PNG_1PX, 'image/png');
    const file = join(env.dataDir, 'users', aliceId, 'photos', res.json.photo.id);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBe(PNG_1PX.length);
  });

  it.each([
    ['jpeg', 'a.jpg', JPEG_HEAD, 'image/jpeg'],
    ['gif', 'a.gif', GIF_1PX, 'image/gif'],
    ['webp', 'a.webp', WEBP_HEAD, 'image/webp'],
  ])('accepts %s', async (_t, name, bytes, mime) => {
    const res = await alice.upload('/api/photos', name, bytes, mime);
    expect(res.status).toBe(201);
    expect(res.json.photo.mime).toBe(mime);
    expect((await alice.get(res.json.photo.url)).headers['content-type']).toBe(mime);
  });

  it('decides the type from the bytes, not the declared type or name', async () => {
    const res = await alice.upload('/api/photos', 'looks.gif', PNG_1PX, 'image/gif');
    expect(res.status).toBe(201);
    expect(res.json.photo.mime).toBe('image/png');
  });

  it('rejects other file types and leaves nothing on disk', async () => {
    const dir = join(env.dataDir, 'users', aliceId, 'photos');
    const before = readdirSync(dir).length;
    for (const [name, body, mime] of [
      ['a.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml'],
      ['a.html', '<script>alert(1)</script>', 'image/png'],
      ['a.txt', 'hello', 'text/plain'],
    ] as const) {
      const res = await alice.upload('/api/photos', name, Buffer.from(body), mime);
      expect(res.status).toBe(400);
      expect(res.json.error).toMatch(/JPEG|PNG|GIF|WebP/);
    }
    expect(readdirSync(dir).length).toBe(before);
  });

  it('rejects a request without a file', async () => {
    const res = await alice.post('/api/photos', {});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('has no size limit (a 12 MB photo)', async () => {
    const big = Buffer.concat([PNG_1PX, Buffer.alloc(12 * 1024 * 1024, 1)]);
    const res = await alice.upload('/api/photos', 'big.png', big, 'image/png');
    expect(res.status).toBe(201);
    const file = join(env.dataDir, 'users', aliceId, 'photos', res.json.photo.id);
    expect(statSync(file).size).toBe(big.length);
  });

  it('answers 404 for unknown photo ids', async () => {
    expect((await alice.get('/api/photos/nosuchphoto1234')).status).toBe(404);
  });
});
