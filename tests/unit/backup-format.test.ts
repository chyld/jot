// Type 3 (unit): the backup archive format, manifest sealing, entry names, backup
// file names, photo reference remapping, and the sanitiser being stable on its output.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readManifest, sealManifest } from '../../src/server/backup/manifest';
import { isPersonalEntry, isSystemEntry, personalBackupName, safetyBackupName, systemBackupName, SAFETY_NAME } from '../../src/server/backup/names';
import { remapPhotoRefs } from '../../src/server/backup/personal';
import { encodeHeader, readSize, readTar, TarWriter } from '../../src/server/backup/tar';
import { sanitizeDoc } from '../../src/server/content';
import { makeTar, sha256, tarHeader } from '../helpers/backup';

const dir = mkdtempSync(join(tmpdir(), 'jot-unit-tar-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function entriesOf(file: string) {
  const out: Array<{ name: string; data: Buffer }> = [];
  await readTar(file, async (e, chunks) => {
    const parts: Buffer[] = [];
    for await (const c of chunks) parts.push(c);
    out.push({ name: e.name, data: Buffer.concat(parts) });
  });
  return out;
}

async function refuses(bytes: Buffer, reason?: RegExp) {
  const f = join(dir, `bad-${Math.random()}.tar`);
  writeFileSync(f, bytes);
  await expect(entriesOf(f)).rejects.toThrow(reason ?? /./);
}

describe('tar', () => {
  it('writes and reads back entries of every size around a block boundary', async () => {
    const f = join(dir, 'rt.tar');
    const src = join(dir, 'src.bin');
    writeFileSync(src, Buffer.alloc(1025, 9));
    const w = await TarWriter.create(f, 1700000000);
    const sizes = [0, 1, 511, 512, 513];
    for (const n of sizes) expect(await w.addBuffer(`photos/${'A'.repeat(21)}${n}`, Buffer.alloc(n, n))).toEqual({ size: n, sha256: sha256(Buffer.alloc(n, n)) });
    expect(await w.addFile('data.json', src)).toEqual({ size: 1025, sha256: sha256(Buffer.alloc(1025, 9)) });
    await w.finish();
    const got = await entriesOf(f);
    expect(got.map((e) => e.data.length)).toEqual([...sizes, 1025]);
    expect(got.at(-1)!.data.equals(Buffer.alloc(1025, 9))).toBe(true);
    expect(readFileSync(f).length % 512).toBe(0);
  });

  it('uses the documented ustar header layout', () => {
    expect(encodeHeader('data.json', 1234, 1700000000).equals(tarHeader({ name: 'data.json', data: Buffer.alloc(1234), mtime: 1700000000 }))).toBe(true);
  });

  it('encodes sizes over 8 GiB in base-256', () => {
    const big = 9 * 1024 ** 3 + 17;
    const h = encodeHeader('jot.db', big, 1700000000);
    expect(h[124]).toBe(0x80);
    expect(readSize(h.subarray(124, 136))).toBe(big);
    expect(readSize(encodeHeader('jot.db', 8 ** 11 - 1, 0).subarray(124, 136))).toBe(8 ** 11 - 1);
  });

  it('refuses damaged archives', async () => {
    const good = makeTar([{ name: 'data.json', data: Buffer.from('{"a":1}'), mtime: 1700000000 }]);
    const flip = (at: number) => {
      const b = Buffer.from(good);
      b[at] ^= 1;
      return b;
    };
    await refuses(good.subarray(0, 600)); // data cut off
    await refuses(good.subarray(0, good.length - 512)); // end of archive cut off
    await refuses(flip(148)); // checksum
    await refuses(flip(300)); // a header field that must be empty
    await refuses(flip(512 + 7 + 3)); // padding after the data must be zeros
    await refuses(flip(good.length - 1)); // the end blocks must be zeros
    await refuses(Buffer.concat([good, Buffer.from('x')]), /after the end/i);
    await refuses(makeTar([{ name: 'x', data: Buffer.alloc(0), type: '2', linkname: '/etc/passwd' }]), /plain file/i);
    await refuses(makeTar([{ name: 'x', data: Buffer.alloc(0), type: '5' }]), /plain file/i);
  });
});

describe('manifest', () => {
  const m = { format: 'jot-personal-backup', version: 1, createdAt: '2026-11-18T10:00:00.000Z', counts: { notes: 1 }, entries: [], missing: [] };

  it('is sealed with the SHA-256 of its own contents and opens again', () => {
    const sealed = sealManifest(m);
    expect(readManifest(sealed)).toEqual(m);
    const parsed = JSON.parse(sealed.toString('utf8'));
    expect(parsed.check).toBe(sha256(JSON.stringify(m)));
  });

  it('refuses any change to a sealed manifest', () => {
    const sealed = sealManifest(m).toString('utf8');
    for (const changed of [sealed.replace('10:00', '11:00'), sealed.replace('"notes":1', '"notes":2'), sealed.replace(/"check":"(.)/, '"check":"0'), 'not json', '{}']) {
      expect(() => readManifest(Buffer.from(changed))).toThrow();
    }
  });
});

describe('entry names', () => {
  const id = 'Abc_def-0123456789ABCD';
  it('personal backups accept only the fixed patterns', () => {
    for (const ok of ['data.json', 'manifest.json', `photos/${id}`, `fonts/${id}/0.woff2`, `fonts/${id}/12.woff2`]) expect(isPersonalEntry(ok), ok).toBe(true);
    for (const bad of ['jot.db', '../data.json', `photos/${id}/x`, `photos/${id}.png`, `fonts/${id}/a.woff2`, `fonts/${id}/0.woff2/`, `fonts/../0.woff2`, 'photos/short', `users/${id}/photos/${id}`, '', '/data.json', 'Data.json']) {
      expect(isPersonalEntry(bad), bad).toBe(false);
    }
  });

  it('system backups accept only the fixed patterns', () => {
    for (const ok of ['jot.db', 'manifest.json', `users/${id}/photos/${id}`, `users/${id}/fonts/${id}/3.woff2`]) expect(isSystemEntry(ok), ok).toBe(true);
    for (const bad of ['data.json', `photos/${id}`, `users/${id}/photos/../../x`, `users/${id}/other/${id}`, `users/${id}/fonts/${id}/x.woff2`, 'jot.db-wal', `users/${id}/safety-backups/x.tar`]) {
      expect(isSystemEntry(bad), bad).toBe(false);
    }
  });
});

describe('file names', () => {
  const at = new Date('2026-11-18T09:05:03.123Z');
  it('names backups by date and time', () => {
    expect(personalBackupName('alice', at)).toBe('jot-backup-alice-20261118-090503.tar');
    expect(systemBackupName(at)).toBe('jot-backup-20261118-090503.tar');
    const s = safetyBackupName(at);
    expect(s).toMatch(SAFETY_NAME);
    expect(s.startsWith('jot-safety-20261118-090503-')).toBe(true);
    expect(safetyBackupName(at)).not.toBe(s); // never the same name twice
    for (const bad of ['../x.tar', 'jot-safety-20261118-090503-zzzzzzzz.tar', 'jot.db']) expect(SAFETY_NAME.test(bad)).toBe(false);
  });
});

describe('photo references', () => {
  it('points every photo in a note at its new id and leaves the rest alone', () => {
    const d = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: '/api/photos/old1', width: 10 } },
        { type: 'paragraph', content: [{ type: 'text', text: '/api/photos/old1 stays as text' }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'image', attrs: { src: '/api/photos/old2' } }] }] }] },
      ],
    };
    const out = remapPhotoRefs(d as any, new Map([['old1', 'new1'], ['old2', 'new2']]));
    expect(out.content![0].attrs!.src).toBe('/api/photos/new1');
    expect(out.content![1].content![0].text).toBe('/api/photos/old1 stays as text');
    expect(out.content![2].content![0].content![0].content![0].attrs!.src).toBe('/api/photos/new2');
    expect(d.content[0].attrs!.src).toBe('/api/photos/old1'); // input untouched
  });
});

describe('the sanitiser', () => {
  it('leaves its own output unchanged (so only notes it really cleans count as adjusted)', () => {
    const docs = [
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs: { fontFamily: 'Inter', fontSize: '18px', color: '#e11d48' } }, { type: 'bold' }] }] }] },
      { type: 'doc', content: [{ type: 'blockquote' }, { type: 'bulletList', content: [{ type: 'listItem' }] }, { type: 'image', attrs: { src: '/api/photos/abc', width: 50, borderColor: 'Crimson' } }] },
      { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colwidth: [100] } }] }] }, { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true } }] }] },
      { type: 'doc' },
    ];
    for (const d of docs) {
      const once = sanitizeDoc(d);
      expect(JSON.stringify(sanitizeDoc(once))).toBe(JSON.stringify(once));
    }
  });
});
