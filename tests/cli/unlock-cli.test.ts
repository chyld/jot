// Type 5 (CLI): jot unlock-note <note id> makes one read-only note writable again. It
// prints the note's title and owner, works with the app running, and says clearly when
// the id does not exist or the note is not read-only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { doc, makeTestEnv, newUser, type Client, type TestEnv } from '../helpers/setup';
import { runCli } from '../helpers/backup';

let env: TestEnv;
let alice: Client;
beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice', undefined, { keepManual: true });
});
afterAll(() => env.close());

describe('jot unlock-note', () => {
  it('is in the usage text', async () => {
    const r = await runCli(env.dataDir, []);
    expect(r.err + r.out).toMatch(/jot unlock-note <note id>/);
  });

  it('makes a read-only note writable again while the app runs, printing its title and owner', async () => {
    const n = (await alice.post('/api/notes', { title: 'Frozen plan', content: doc('x') })).json.note;
    await alice.post(`/api/notes/${n.id}/read-only`, {});
    expect((await alice.patch(`/api/notes/${n.id}`, { title: 'try' })).status).toBe(403);
    const r = await runCli(env.dataDir, ['unlock-note', n.id]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('Frozen plan');
    expect(r.out).toContain('alice');
    expect(r.out).toMatch(/writable/i);
    expect((await alice.get(`/api/notes/${n.id}`)).json.note.readOnly).toBe(false);
    expect((await alice.patch(`/api/notes/${n.id}`, { title: 'thawed' })).status).toBe(200);
  });

  it('unlocks the user manual too (the only way to)', async () => {
    const manual = (await alice.get('/api/notes?tag=manual')).json.notes[0];
    expect(manual.readOnly).toBe(true);
    const r = await runCli(env.dataDir, ['unlock-note', manual.id]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('User manual');
    expect((await alice.del(`/api/notes/${manual.id}`)).status).toBe(200);
  });

  it('says so when the note is not read-only, and changes nothing', async () => {
    const n = (await alice.post('/api/notes', { title: 'Loose note', content: doc('x') })).json.note;
    const r = await runCli(env.dataDir, ['unlock-note', n.id]);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/not read-only/i);
    expect(r.err).toContain('Loose note');
  });

  it('says so when there is no such note', async () => {
    for (const id of ['AAAAAAAAAAAAAAAAAAAAAA', 'not-an-id', '../../etc']) {
      const r = await runCli(env.dataDir, ['unlock-note', id]);
      expect(r.code, id).not.toBe(0);
      expect(r.err).toMatch(/no note/i);
    }
  });

  it('needs exactly one id', async () => {
    expect((await runCli(env.dataDir, ['unlock-note'])).code).not.toBe(0);
    expect((await runCli(env.dataDir, ['unlock-note', 'a', 'b'])).code).not.toBe(0);
  });
});
