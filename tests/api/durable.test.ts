// Type 2 (API integration): uploaded photos and downloaded fonts are forced to disk,
// with their folders, before their record is saved (backup-spec.md §5, second fix).
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestEnv, newUser, PNG_1PX, type Client, type TestEnv } from '../helpers/setup';

// Every sync is recorded with whether the record already existed at that moment.
const seen = vi.hoisted(() => ({ syncs: [] as Array<{ kind: 'file' | 'dir'; path: string; recordExisted: boolean }>, check: (_p: string): boolean => false }));
vi.mock('../../src/server/durable', async (importOriginal) => {
  const real: any = await importOriginal();
  return {
    ...real,
    syncFile: async (p: string) => {
      seen.syncs.push({ kind: 'file', path: p, recordExisted: seen.check(p) });
      return real.syncFile(p);
    },
    syncDir: async (p: string) => {
      seen.syncs.push({ kind: 'dir', path: p, recordExisted: seen.check(p) });
      return real.syncDir(p);
    },
  };
});

let env: TestEnv;
let alice: Client;
let userId: string;
const db = () => (env.app as any).jot.db;

beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
  userId = (await alice.get('/api/me')).json.user.id;
});
afterAll(() => env.close());
beforeEach(() => {
  seen.syncs.length = 0;
});

describe('forced to disk before the record', () => {
  it('an uploaded photo and its folder', async () => {
    seen.check = () => (db().prepare('SELECT COUNT(*) AS n FROM photos WHERE user_id = ?').get(userId) as any).n > 0;
    const photo = (await alice.upload('/api/photos', 'p.png', PNG_1PX, 'image/png')).json.photo;
    const dir = join(env.dataDir, 'users', userId, 'photos');
    expect(seen.syncs).toContainEqual({ kind: 'file', path: join(dir, photo.id), recordExisted: false });
    expect(seen.syncs).toContainEqual({ kind: 'dir', path: dir, recordExisted: false });
  });

  it('every file of a downloaded font, its folder and the fonts folder', async () => {
    seen.check = () => !!db().prepare("SELECT 1 FROM fonts WHERE user_id = ? AND family = 'Roboto Slab'").get(userId);
    const font = (await alice.post('/api/fonts', { family: 'Roboto Slab' })).json.font;
    const dir = join(env.dataDir, 'users', userId, 'fonts', font.id);
    const faces = JSON.parse((db().prepare('SELECT faces FROM fonts WHERE id = ?').get(font.id) as any).faces);
    for (const f of faces) expect(seen.syncs).toContainEqual({ kind: 'file', path: join(dir, f.file), recordExisted: false });
    expect(seen.syncs).toContainEqual({ kind: 'dir', path: dir, recordExisted: false });
    expect(seen.syncs).toContainEqual({ kind: 'dir', path: dirname(dir), recordExisted: false });
  });

  it('the starter fonts copied for a new user', async () => {
    seen.check = () => !!db().prepare("SELECT 1 FROM users WHERE username = 'carol'").get();
    await newUser(env, 'carol');
    const carol = (db().prepare("SELECT id FROM users WHERE username = 'carol'").get() as any).id;
    const fonts = db().prepare('SELECT id, faces FROM fonts WHERE user_id = ?').all(carol) as any[];
    expect(fonts.length).toBe(5);
    for (const f of fonts) {
      const dir = join(env.dataDir, 'users', carol, 'fonts', f.id);
      for (const face of JSON.parse(f.faces)) expect(seen.syncs).toContainEqual({ kind: 'file', path: join(dir, face.file), recordExisted: false });
      expect(seen.syncs).toContainEqual({ kind: 'dir', path: dir, recordExisted: false });
    }
  });
});
