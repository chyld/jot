// Type 2 (API integration): a multi-gigabyte photo round-trips through a personal
// backup and restore over real HTTP, with bounded server memory (backup-spec.md §7).
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, createWriteStream, ftruncateSync, mkdirSync, openSync, rmSync, statSync, writeSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { newId } from '../../src/server/ids';
import { makeTestEnv, newUser, PNG_1PX, type TestEnv } from '../helpers/setup';

const SIZE = 2.5 * 1024 ** 3; // over 2^31, to catch 32-bit offsets
let env: TestEnv;
let base: string;

beforeAll(async () => {
  env = await makeTestEnv();
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(env.app.server.address() as any).port}`;
});
afterAll(() => env.close());

async function hashFile(p: string) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(p, { highWaterMark: 4 << 20 })) h.update(chunk);
  return h.digest('hex');
}

it('a 2.5 GiB photo backs up and restores with bounded memory', { timeout: 900_000 }, async () => {
  const c = await newUser(env, 'big');
  const userId = (await c.get('/api/me')).json.user.id;
  const cookie = c.cookie!;
  const db = (env.app as any).jot.db;

  // The photo is written straight into the user's folder (a sparse file), as an upload would leave it.
  const photoId = newId();
  const dir = join(env.dataDir, 'users', userId, 'photos');
  mkdirSync(dir, { recursive: true });
  const fd = openSync(join(dir, photoId), 'w');
  writeSync(fd, PNG_1PX);
  ftruncateSync(fd, SIZE);
  closeSync(fd);
  db.prepare("INSERT INTO photos (id, user_id, mime, size, original_name, created_at) VALUES (?, ?, 'image/png', ?, 'huge.png', ?)").run(
    photoId,
    userId,
    SIZE,
    new Date().toISOString(),
  );
  await c.post('/api/notes', { title: 'huge', content: { type: 'doc', content: [{ type: 'image', attrs: { src: `/api/photos/${photoId}` } }] } });
  const originalHash = await hashFile(join(dir, photoId));

  const baseline = process.memoryUsage().rss;
  let peak = baseline;
  const phases: Record<string, number> = {};
  let phase = 'backup';
  const sampler = setInterval(() => {
    const rss = process.memoryUsage().rss;
    peak = Math.max(peak, rss);
    phases[phase] = Math.max(phases[phase] ?? 0, Math.round((rss - baseline) / 2 ** 20));
  }, 50);
  const download = join(env.dataDir, 'download.tar');
  try {
    const made = await fetch(`${base}/api/backup`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    expect(made.status).toBe(201);
    const { backup } = (await made.json()) as any;
    phase = 'download';
    const dl = await fetch(`${base}/api/backup/${backup.id}`, { headers: { cookie } });
    expect(dl.status).toBe(200);
    await pipeline(Readable.fromWeb(dl.body as any), createWriteStream(download));
    expect(statSync(download).size).toBeGreaterThan(SIZE);

    phase = 'upload and check';
    // Streamed with node:http (Readable.toWeb, used for fetch bodies, does not apply backpressure).
    const up = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(`${base}/api/restore`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-tar' } }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (text += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
      });
      req.on('error', reject);
      pipeline(createReadStream(download, { highWaterMark: 4 << 20 }), req).catch(reject);
    });
    const staged = JSON.parse(up.body);
    expect(up.status, up.body).toBe(201);
    rmSync(download);
    phase = 'confirm';
    const done = await fetch(`${base}/api/restore/${staged.restore.id}/confirm`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: 'RESTORE' }),
    });
    expect(done.status).toBe(200);
  } finally {
    clearInterval(sampler);
    rmSync(download, { force: true });
  }
  expect(peak - baseline, `memory grew by MiB, per phase: ${JSON.stringify(phases)}`).toBeLessThan(300 * 2 ** 20);

  const row = db.prepare('SELECT * FROM photos WHERE user_id = ?').get(userId);
  expect(row.id).not.toBe(photoId);
  expect(row.size).toBe(SIZE);
  expect(await hashFile(join(dir, row.id))).toBe(originalHash);
  // Free the disk space early: the safety backup holds another copy.
  rmSync(join(env.dataDir, 'users', userId), { recursive: true, force: true });
});
