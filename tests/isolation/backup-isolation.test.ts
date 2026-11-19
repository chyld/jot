// Type 1 (per-user isolation) for backup and restore: a user can never see, download
// or restore another user's backups, and one user's restore never touches another's data.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { doc, makeTestEnv, newUser, PNG_1PX, GIF_1PX, type Client, type TestEnv } from '../helpers/setup';
import { accountSnapshot, openBackup, restore, stage, takeBackup } from '../helpers/backup';

let env: TestEnv;
let alice: Client;
let bob: Client;
let aliceId: string;
let bobId: string;
let bobPhotoUrl: string;
const snap = (id: string) => accountSnapshot((env.app as any).jot.db, env.dataDir, id);

beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
  bob = await newUser(env, 'bob');
  aliceId = (await alice.get('/api/me')).json.user.id;
  bobId = (await bob.get('/api/me')).json.user.id;
  await alice.post('/api/notes', { title: 'my note', content: doc('xylosecret') });
  await alice.upload('/api/photos', 'a.gif', GIF_1PX, 'image/gif');
  const n = (await bob.post('/api/notes', { title: 'bob note', content: doc('bobsecret') })).json.note;
  await bob.post(`/api/notes/${n.id}/tags`, { tag: 'bobtag' });
  bobPhotoUrl = (await bob.upload('/api/photos', 'bob.png', PNG_1PX, 'image/png')).json.photo.url;
  await bob.post('/api/fonts', { family: 'Bebas Neue' });
  await bob.post('/api/styles', { name: 'Bob style', fontId: (await bob.get('/api/fonts')).json.fonts[0].id, size: 30 });
});
afterAll(() => env.close());
afterEach(() => {
  delete process.env.JOT_FAILPOINT;
});

describe('backup contents', () => {
  it('a personal backup holds only that user’s data', async () => {
    const { file } = await takeBackup(alice);
    const text = file.toString('latin1');
    for (const s of ['bobsecret', 'bob note', 'bobtag', 'Bob style', 'Bebas Neue', bobId, bobPhotoUrl.split('/').pop()!, 'argon2']) {
      expect(text, s).not.toContain(s);
    }
    const b = openBackup(file);
    // No username either (it is not part of a personal backup).
    expect(JSON.stringify(b.data) + JSON.stringify(b.manifest)).not.toMatch(/"(alice|bob)"/);
    expect(b.data.notes.map((n: any) => n.title)).toEqual(['my note']);
    expect(b.data.photos.map((p: any) => p.originalName)).toEqual(['a.gif']);
  });
});

describe('another user’s backups', () => {
  it('B cannot download a backup A made', async () => {
    const made = (await alice.post('/api/backup', {})).json.backup;
    expect((await bob.get(`/api/backup/${made.id}`)).status).toBe(404);
    expect((await alice.get(`/api/backup/${made.id}`)).status).toBe(200);
  });

  it('B cannot confirm or cancel A’s uploaded restore', async () => {
    const { file } = await takeBackup(alice);
    const s = await stage(alice, file);
    expect(s.status).toBe(201);
    const id = s.json.restore.id;
    const bobBefore = snap(bobId);
    expect((await bob.post(`/api/restore/${id}/confirm`, { confirm: 'RESTORE' })).status).toBe(404);
    expect((await bob.del(`/api/restore/${id}`)).status).toBe(404);
    expect(snap(bobId)).toEqual(bobBefore);
    // A's upload is still there and still hers.
    expect((await alice.post(`/api/restore/${id}/confirm`, { confirm: 'RESTORE' })).status).toBe(200);
  });

  it('B cannot see, download or delete A’s safety backups', async () => {
    const list = (await alice.get('/api/safety-backups')).json.backups;
    expect(list.length).toBeGreaterThan(0);
    const name = list[0].name;
    expect((await bob.get('/api/safety-backups')).json.backups).toEqual([]);
    expect((await bob.get(`/api/safety-backups/${name}`)).status).toBe(404);
    expect((await bob.del(`/api/safety-backups/${name}`)).status).toBe(404);
    expect((await alice.get(`/api/safety-backups/${name}`)).status).toBe(200);
  });
});

describe('restores are per user', () => {
  it('A’s restore leaves B’s data exactly as it was', async () => {
    const { file } = await takeBackup(alice);
    await alice.post('/api/notes', { title: 'later', content: doc('x') });
    const bobBefore = snap(bobId);
    expect((await restore(alice, file)).done.status).toBe(200);
    expect(snap(bobId)).toEqual(bobBefore);
    expect((await bob.get(bobPhotoUrl)).status).toBe(200);
  });

  it('during A’s restore, B can still save and upload', async () => {
    const { file } = await takeBackup(alice);
    const s = await stage(alice, file);
    process.env.JOT_FAILPOINT = 'restore:after-safety-backup:sleep=1500';
    const running = alice.post(`/api/restore/${s.json.restore.id}/confirm`, { confirm: 'RESTORE' });
    await new Promise((r) => setTimeout(r, 500));
    expect((await alice.post('/api/notes', { title: 'blocked' })).status).toBe(409);
    expect((await bob.post('/api/notes', { title: 'bob during', content: doc('fine') })).status).toBe(201);
    expect((await bob.upload('/api/photos', 'during.png', PNG_1PX, 'image/png')).status).toBe(201);
    expect((await running).status).toBe(200);
    expect((await bob.get('/api/notes')).json.notes.map((n: any) => n.title)).toContain('bob during');
    expect(snap(aliceId).notes.join()).not.toContain('blocked');
  });
});
