// Type 4 (security): bad and crafted personal backups are refused and change nothing
// (backup-spec.md §3.5 step 2, §6, §7 "Bad backups are refused and change nothing").
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/server/ids';
import { doc, makeTestEnv, newUser, PNG_1PX, type Client, type TestEnv } from '../helpers/setup';
import { accountSnapshot, makeTar, openBackup, packBackup, parseTar, sha256, stage, takeBackup, TAR, walk } from '../helpers/backup';

let env: TestEnv;
let alice: Client;
let aliceId: string;
let good: Buffer;
let photoId: string;

const snap = () => accountSnapshot((env.app as any).jot.db, env.dataDir, aliceId);
const files = () => walk(env.dataDir).filter((f) => !/^jot\.db(-wal|-shm)?$/.test(f) && f !== '.lock');

beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
  aliceId = (await alice.get('/api/me')).json.user.id;
  const photo = (await alice.upload('/api/photos', 'p.png', PNG_1PX, 'image/png')).json.photo;
  photoId = photo.id;
  const n = (await alice.post('/api/notes', { title: 'with photo', content: { type: 'doc', content: [{ type: 'image', attrs: { src: photo.url } }] } })).json.note;
  await alice.post(`/api/notes/${n.id}/tags`, { tag: 'kept' });
  await alice.post('/api/notes', { title: 'plain', content: doc('plain text') });
  const lora = (await alice.get('/api/fonts')).json.fonts.find((f: any) => f.family === 'Lora');
  await alice.post('/api/styles', { name: 'Mine', fontId: lora.id, size: 18 }); // the backup holds only own styles
  good = (await takeBackup(alice)).file;
  await alice.post('/api/notes', { title: 'current only', content: doc('now') });
});
afterAll(() => env.close());

/** The upload is refused with a reason, and nothing about the account or the data folder changed. */
async function refused(file: Buffer, reason?: RegExp) {
  const before = snap();
  const filesBefore = files();
  const r = await stage(alice, file);
  expect(r.status, r.body).toBe(400);
  expect(typeof r.json?.error).toBe('string');
  if (reason) expect(r.json.error).toMatch(reason);
  expect(snap()).toEqual(before);
  expect(files()).toEqual(filesBefore);
  return r.json.error as string;
}

const edit = (fn: (b: ReturnType<typeof openBackup>) => void, opts?: { rehash?: boolean; reseal?: boolean }) => {
  const b = openBackup(good);
  fn(b);
  return packBackup(b, opts);
};

describe('a well-formed backup', () => {
  it('is accepted (control for the crafted ones below)', async () => {
    const r = await stage(alice, packBackup(openBackup(good)));
    expect(r.status, r.body).toBe(201);
    expect((await alice.del(`/api/restore/${r.json.restore.id}`)).status).toBe(204);
  });
});

describe('damaged files', () => {
  it('a flipped byte anywhere is refused', async () => {
    const entries = parseTar(good);
    // Offsets in every kind of region: headers, data, padding, the manifest, the end blocks.
    const offsets = new Set<number>([0, 5, 99, 100, 110, 124, 130, 136, 148, 150, 154, 155, 156, 157, 257, 263, 300, 511]);
    let off = 0;
    for (const e of entries) {
      off += 512;
      offsets.add(off).add(off + Math.floor(e.data.length / 2)).add(off + e.data.length - 1);
      if (e.data.length % 512) offsets.add(off + e.data.length); // first padding byte
      off += Math.ceil(e.data.length / 512) * 512;
    }
    offsets.add(good.length - 1024).add(good.length - 1);
    for (let i = 0; i < 12; i++) offsets.add(Math.floor((good.length * i) / 12));
    for (const at of [...offsets].filter((o) => o < good.length)) {
      const bad = Buffer.from(good);
      bad[at] ^= 0x01;
      const r = await stage(alice, bad);
      expect(r.status, `flipped byte at ${at}: ${r.body}`).toBe(400);
    }
    expect(snap().notes.length).toBe(3);
  });

  it('a truncated file is refused (a cut-off download has no manifest)', async () => {
    for (const len of [0, 1, 100, 512, 1024, Math.floor(good.length / 2), good.length - 1024 - 512, good.length - 1024, good.length - 1]) {
      await refused(good.subarray(0, len));
    }
    await refused(good.subarray(0, good.length - 1100), /manifest|incomplete|cut off|truncated/i);
  });

  it('garbage after the end of the archive is refused', async () => {
    await refused(Buffer.concat([good, Buffer.from('extra')]));
    await refused(Buffer.concat([good, Buffer.alloc(512, 1)]));
  });

  it('a file that is not a backup is refused', async () => {
    await refused(Buffer.from('hello'), /not a Jot backup|damaged|incomplete/i);
    await refused(Buffer.alloc(4096));
  });
});

describe('wrong entries', () => {
  it('a missing entry is refused', async () => {
    await refused(edit((b) => (b.entries = b.entries.filter((e) => e.name !== `photos/${photoId}`)), { rehash: false }));
    // Even with a manifest that agrees, data.json still needs the photo.
    await refused(edit((b) => (b.entries = b.entries.filter((e) => e.name !== `photos/${photoId}`))), /photo/i);
    await refused(edit((b) => (b.entries = b.entries.filter((e) => e.name !== 'data.json'))));
  });

  it('an extra entry is refused, listed in the manifest or not', async () => {
    const extra = { name: `photos/${newId()}`, data: PNG_1PX };
    await refused(edit((b) => b.entries.push(extra)));
    await refused(edit((b) => b.entries.push(extra), { rehash: false }));
    await refused(edit((b) => b.entries.push({ name: 'notes.txt', data: Buffer.from('x') })));
  });

  it('a duplicated entry is refused', async () => {
    await refused(edit((b) => b.entries.push({ ...b.entries.find((e) => e.name === 'data.json')! })), /twice|duplicate/i);
    await refused(edit((b) => b.entries.push({ ...b.entries.find((e) => e.name === `photos/${photoId}`)! })), /twice|duplicate/i);
  });

  it('a wrong checksum or size in the manifest is refused', async () => {
    const b = openBackup(good);
    b.manifest.entries = b.manifest.entries.map((e: any) => (e.name === `photos/${photoId}` ? { ...e, sha256: sha256('other') } : e));
    await refused(packBackup(b, { rehash: false }), /checksum|damaged/i);
    const c = openBackup(good);
    c.manifest.entries = c.manifest.entries.map((e: any) => (e.name === 'data.json' ? { ...e, size: e.size + 1 } : e));
    await refused(packBackup(c, { rehash: false }));
  });

  it('a manifest that was changed without resealing is refused', async () => {
    await refused(edit((b) => (b.manifest.createdAt = '2020-01-01T00:00:00.000Z'), { reseal: false }));
  });

  it('a manifest that is missing or not last is refused', async () => {
    const b = openBackup(good);
    await refused(makeTar(b.entries), /manifest/i);
    const m = parseTar(good).find((e) => e.name === 'manifest.json')!;
    await refused(makeTar([m, ...b.entries]));
  });

  it('a file listed as missing that is also present is refused', async () => {
    await refused(edit((b) => (b.manifest.missing = [{ name: `photos/${photoId}`, what: 'Photo "p.png"' }])));
  });

  it('a newer format version is refused', async () => {
    await refused(edit((b) => (b.manifest.version = 3)), /newer/i);
  });

  it('another kind of file is refused', async () => {
    await refused(edit((b) => (b.manifest.format = 'jot-system-backup')), /not a personal backup|not a Jot backup|system/i);
    await refused(edit((b) => (b.manifest.format = 'zip')));
  });
});

describe('entry names and types', () => {
  it.each([
    '../evil',
    '../../evil',
    '/tmp/evil',
    'photos/../../evil',
    `photos/${'A'.repeat(22)}/../../../evil`,
    `fonts/${'A'.repeat(22)}/../../../../evil.woff2`,
    'photos/evil',
    `photos/${'A'.repeat(22)}.png`,
    `fonts/${'A'.repeat(22)}/evil.woff2`,
    `fonts/${'A'.repeat(22)}/0.woff2/x`,
    './data.json',
    'data.json/',
    'DATA.JSON',
    'jot.db',
  ])('an entry named %j is refused and nothing is written outside staging', async (name) => {
    const err = await refused(edit((b) => b.entries.push({ name, data: PNG_1PX })));
    expect(err).toMatch(/name|unexpected|not allowed/i);
    expect(existsSync('/tmp/evil')).toBe(false);
    expect(existsSync(join(env.dataDir, '..', 'evil'))).toBe(false);
    expect(existsSync(join(env.dataDir, 'evil'))).toBe(false);
  });

  it.each([
    ['symbolic link', '2', '/etc/passwd'],
    ['hard link', '1', 'data.json'],
    ['directory', '5', ''],
    ['fifo', '6', ''],
  ])('a %s entry is refused', async (_what, type, linkname) => {
    const err = await refused(
      edit((b) => {
        const i = b.entries.findIndex((e) => e.name === `photos/${photoId}`);
        b.entries[i] = { name: `photos/${photoId}`, data: Buffer.alloc(0), type, linkname };
      }),
    );
    expect(err).toMatch(/plain file/i);
  });
});

describe('contents that break Jot’s rules', () => {
  it('a note using a photo that is not in the backup is refused', async () => {
    await refused(
      edit((b) => b.data.notes[0].content.content.push({ type: 'image', attrs: { src: `/api/photos/${newId()}` } })),
      /photo/i,
    );
  });

  it('a photo that is not a real image is refused', async () => {
    await refused(
      edit((b) => (b.entries.find((e) => e.name === `photos/${photoId}`)!.data = Buffer.from('<html><script>alert(1)</script>'))),
      /image|photo/i,
    );
  });

  it('a font file that is not a real woff2 is refused', async () => {
    await refused(
      edit((b) => (b.entries.find((e) => e.name.startsWith('fonts/'))!.data = Buffer.from('not a font at all'))),
      /font/i,
    );
  });

  it('tags and styles that break the rules are refused', async () => {
    await refused(edit((b) => (b.data.notes[0].tags = ['Bad Tag!'])), /tag/i);
    await refused(edit((b) => (b.data.notes[0].tags = ['dup', 'dup'])), /tag/i);
    await refused(edit((b) => (b.data.styles[0].size = 9999)), /style/i);
    await refused(edit((b) => (b.data.styles[0].fontId = newId())), /font/i);
    await refused(edit((b) => (b.data.fonts[1].family = b.data.fonts[0].family)), /font/i);
    await refused(edit((b) => (b.data.notes[0].id = '../../x')));
    await refused(edit((b) => (b.data.notes[0].title = 'x'.repeat(501))), /title/i);
    await refused(edit((b) => (b.data.notes[0].createdAt = 'yesterday')));
    await refused(edit((b) => (b.data.fonts[0].faces[0].file = '../../evil.woff2')));
  });

  it('read-only must be true or false, and a read-only note cannot be in the trash', async () => {
    await refused(edit((b) => (b.data.notes[0].readOnly = 'yes')), /read-only/i);
    await refused(
      edit((b) => {
        b.data.notes[0].readOnly = true;
        b.data.notes[0].deletedAt = '2026-11-01T00:00:00.000Z';
      }),
      /read-only/i,
    );
  });

  it('a backup without one of the five default fonts is refused (the default styles need them)', async () => {
    await refused(
      edit((b) => {
        const inter = b.data.fonts.find((f: any) => f.family === 'Inter');
        b.data.fonts = b.data.fonts.filter((f: any) => f !== inter);
        b.entries = b.entries.filter((e) => !e.name.startsWith(`fonts/${inter.id}/`));
        b.data.styles = b.data.styles.filter((s: any) => s.fontId !== inter.id);
        b.manifest.counts = { ...b.manifest.counts, fonts: b.data.fonts.length, styles: b.data.styles.length };
      }),
      /Inter/,
    );
  });

  it('counts in the manifest must match the data', async () => {
    await refused(edit((b) => (b.manifest.counts = { ...b.manifest.counts, notes: 99 })));
  });
});

describe('how the upload arrives', () => {
  it('only a raw file stream is accepted, not an HTML form', async () => {
    expect((await alice.upload('/api/restore', 'b.tar', good, 'application/x-tar')).status).toBe(415);
    expect((await alice.raw('/api/restore', good, 'text/plain')).status).toBe(415);
    expect((await alice.raw('/api/restore', good, 'application/x-www-form-urlencoded')).status).toBe(415);
    expect((await alice.raw('/api/restore', good, 'application/octet-stream')).status).toBe(201);
  });

  it('requests from other sites are refused', async () => {
    expect((await alice.raw('/api/restore', good, TAR, { origin: 'https://evil.example' })).status).toBe(403);
    const s = await stage(alice, good);
    const confirm = await alice.raw(`/api/restore/${s.json.restore.id}/confirm`, Buffer.from('{"confirm":"RESTORE"}'), 'application/json', {
      origin: 'https://evil.example',
    });
    expect(confirm.status).toBe(403);
    expect((await alice.raw('/api/backup', Buffer.from('{}'), 'application/json', { origin: 'https://evil.example' })).status).toBe(403);
    await alice.del(`/api/restore/${s.json.restore.id}`);
  });

  it('safety backup names cannot reach other files', async () => {
    for (const name of ['..%2F..%2Fjot.db', '..%2Fjot.db', '%2Fetc%2Fpasswd', 'jot.db', '.', '..', 'x.tar']) {
      expect((await alice.get(`/api/safety-backups/${name}`)).status, name).toBe(404);
      expect((await alice.del(`/api/safety-backups/${name}`)).status, name).toBe(404);
    }
    expect(existsSync(join(env.dataDir, 'jot.db'))).toBe(true);
  });
});

