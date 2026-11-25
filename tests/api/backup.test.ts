// Type 2 (API integration): personal backup and restore (backup-spec.md §3, §7).
import { existsSync, readdirSync, unlinkSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app';
import { tryLock } from '../../src/server/backup/lock';
import { newId } from '../../src/server/ids';
import { client, doc, GIF_1PX, makeTestEnv, newUser, PNG_1PX, type Client, type TestEnv } from '../helpers/setup';
import { accountSnapshot, openBackup, packBackup, restore, stage, strayFiles, takeBackup } from '../helpers/backup';

let env: TestEnv;
const db = () => (env.app as any).jot.db;
const idOf = async (c: Client) => (await c.get('/api/me')).json.user.id as string;
const snap = (userId: string) => accountSnapshot(db(), env.dataDir, userId);
const titles = (r: any) => r.json.notes.map((n: any) => n.title).sort();

/** Notes (one trashed, tags, a photo inside), an unused photo, an added and an archived font, styles. */
async function seed(c: Client, word: string) {
  const photo = (await c.upload('/api/photos', 'beach.png', PNG_1PX, 'image/png')).json.photo;
  await c.upload('/api/photos', 'unused.gif', GIF_1PX, 'image/gif');
  const withPhoto = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: `${word} with a photo`, marks: [{ type: 'bold' }] }] },
      { type: 'image', attrs: { src: photo.url, width: 120, borderWidth: 2, borderColor: 'Crimson' } },
    ],
  };
  const a = (await c.post('/api/notes', { title: `${word} one`, content: withPhoto })).json.note;
  await c.post(`/api/notes/${a.id}/tags`, { tag: 'alpha' });
  await c.post(`/api/notes/${a.id}/tags`, { tag: 'beta' });
  const b = (await c.post('/api/notes', { title: `${word} two`, content: doc(`${word} quartz`, 'second line') })).json.note;
  await c.post(`/api/notes/${b.id}/tags`, { tag: 'beta' });
  const t = (await c.post('/api/notes', { title: `${word} trashed`, content: doc('in the bin') })).json.note;
  await c.post(`/api/notes/${t.id}/tags`, { tag: 'gamma' });
  await c.del(`/api/notes/${t.id}`);
  const slab = (await c.post('/api/fonts', { family: 'Roboto Slab' })).json.font;
  const fonts = (await c.get('/api/fonts')).json.fonts;
  await c.post(`/api/fonts/${fonts.find((f: any) => f.family === 'Roboto Slab').id}/archive`);
  await c.post('/api/styles', { name: `${word} style`, fontId: slab.id, size: 21, bold: true, textColor: 'Crimson', highlight: 'Sunflower' });
  const code = (await c.get('/api/styles')).json.styles.find((s: any) => s.name === 'Code');
  await c.del(`/api/styles/${code.id}`);
  return { photo, notes: [a, b, t] };
}

/** Changes everything seed() made, so a restore has something to undo. */
async function scramble(c: Client) {
  const notes = (await c.get('/api/notes')).json.notes;
  await c.patch(`/api/notes/${notes[0].id}`, { title: 'changed', content: doc('changed text') });
  await c.del(`/api/notes/${notes[1].id}`);
  for (const n of (await c.get('/api/trash')).json.notes) await c.del(`/api/trash/${n.id}`);
  await c.post('/api/notes', { title: 'brand new', content: doc('new quartz') });
  await c.upload('/api/photos', 'new.png', PNG_1PX, 'image/png');
  for (const s of (await c.get('/api/styles')).json.styles) await c.del(`/api/styles/${s.id}`);
  await c.post('/api/fonts', { family: 'Bebas Neue' });
}

beforeAll(async () => {
  env = await makeTestEnv();
});
afterAll(() => env.close());
afterEach(() => {
  delete process.env.JOT_FAILPOINT;
});

describe('round trip', () => {
  it('back up, change and delete data, restore: everything matches the original', async () => {
    const alice = await newUser(env, 'rt_alice');
    const id = await idOf(alice);
    await seed(alice, 'zebra');
    const before = snap(id);
    const searchBefore = titles(await alice.get('/api/search?q=quartz'));
    const tagBefore = titles(await alice.get('/api/notes?tag=beta'));
    const { info, file } = await takeBackup(alice);
    // Styles: only the user's own (the five default styles are not user data).
    expect(info.counts).toEqual({ notes: 3, photos: 2, fonts: 6, styles: 1 });
    expect(info.missing).toEqual([]);
    expect(info.name).toMatch(/^jot-backup-rt_alice-\d{8}-\d{6}\.tar$/);

    await scramble(alice);
    expect(snap(id)).not.toEqual(before);

    const { staged, done } = await restore(alice, file);
    expect(staged.status, staged.body).toBe(201);
    expect(staged.json.restore.summary).toMatchObject({ counts: { notes: 3, photos: 2, fonts: 6, styles: 1 }, adjustedNotes: 0, missing: [] });
    expect(done.status, done.body).toBe(200);

    expect(snap(id)).toEqual(before);
    expect(titles(await alice.get('/api/search?q=quartz'))).toEqual(searchBefore);
    expect(titles(await alice.get('/api/notes?tag=beta'))).toEqual(tagBefore);
    expect(strayFiles(db(), env.dataDir, id)).toEqual([]);
    // Photos and fonts are served from their new files.
    const note = (await alice.get('/api/notes')).json.notes.find((n: any) => n.title === 'zebra one');
    const src = (await alice.get(`/api/notes/${note.id}`)).json.note.content.content[1].attrs.src;
    expect((await alice.get(src)).rawPayload.equals(PNG_1PX)).toBe(true);
    const slab = (await alice.get('/api/fonts')).json.fonts.find((f: any) => f.family === 'Roboto Slab');
    expect((await alice.get(`/api/fonts/${slab.id}/files/0.woff2`)).status).toBe(200);
  });

  it('everything restored gets a new id, so a backup restores into another account too', async () => {
    const a = await newUser(env, 'rt_from');
    const b = await newUser(env, 'rt_into');
    await seed(a, 'moved');
    const { file } = await takeBackup(a);
    const aIds = new Set([
      ...(await a.get('/api/notes')).json.notes.map((n: any) => n.id),
      ...(await a.get('/api/fonts')).json.fonts.map((f: any) => f.id),
      ...(await a.get('/api/styles')).json.styles.map((s: any) => s.id),
    ]);
    // Default styles are system styles: each account keeps its own (with its own dates).
    const own = (x: ReturnType<typeof snap>) => ({ ...x, styles: x.styles.filter((s) => !JSON.parse(s).is_default) });
    const before = snap(await idOf(a));
    expect((await restore(b, file)).done.status).toBe(200);
    expect(own(snap(await idOf(b)))).toEqual(own(before));
    const bIds = [
      ...(await b.get('/api/notes')).json.notes.map((n: any) => n.id),
      ...(await b.get('/api/fonts')).json.fonts.map((f: any) => f.id),
      ...(await b.get('/api/styles')).json.styles.map((s: any) => s.id),
    ];
    expect(bIds.filter((x) => aIds.has(x))).toEqual([]);
    // a is untouched
    expect(snap(await idOf(a))).toEqual(before);
  });

  it('data saved a moment before a backup is in it', async () => {
    const c = await newUser(env, 'recent');
    const n = (await c.post('/api/notes', { title: 'r', content: doc('first') })).json.note;
    await c.patch(`/api/notes/${n.id}`, { content: doc('saved just now') });
    const { file } = await takeBackup(c);
    const data = openBackup(file).data;
    expect(JSON.stringify(data.notes)).toContain('saved just now');
  });

  it('a backup has the manifest last and lists every other entry with size and SHA-256', async () => {
    const c = await newUser(env, 'layout');
    await seed(c, 'lay');
    const { file } = await takeBackup(c);
    const b = openBackup(file);
    const names = b.entries.map((e) => e.name);
    expect(names[0]).toBe('data.json');
    expect(names.filter((n) => n.startsWith('photos/')).length).toBe(2);
    expect(names.filter((n) => n.startsWith('fonts/')).length).toBeGreaterThan(6);
    expect(b.manifest).toMatchObject({ format: 'jot-personal-backup', version: 6 });
    expect(b.manifest.entries.map((e: any) => e.name).sort()).toEqual([...names].sort());
    expect(JSON.stringify(b.data)).not.toMatch(/password|argon2|layout/); // no username, no password
  });
});

describe('read-only notes', () => {
  it('a backup records which notes are read-only, and a restore brings them back exactly', async () => {
    const c = await newUser(env, 'ro_user', undefined, { keepManual: true });
    const id = await idOf(c);
    const locked = (await c.post('/api/notes', { title: 'locked one', content: doc('fixed text') })).json.note;
    await c.post(`/api/notes/${locked.id}/tags`, { tag: 'frozen' });
    await c.post(`/api/notes/${locked.id}/read-only`, {});
    await c.post('/api/notes', { title: 'loose one', content: doc('free text') });
    const before = snap(id);
    const { file } = await takeBackup(c);
    const data = openBackup(file).data;
    expect(Object.fromEntries(data.notes.map((n: any) => [n.title, n.readOnly]))).toEqual({ 'User manual': true, 'locked one': true, 'loose one': false });
    expect(openBackup(file).manifest.version).toBe(6);

    // The restore replaces every note, read-only ones included (the safety backup has them).
    await c.post('/api/notes', { title: 'after the backup', content: doc('x') });
    expect((await restore(c, file)).done.status).toBe(200);
    expect(snap(id)).toEqual(before);
    const list = (await c.get('/api/notes')).json.notes;
    expect(list.find((n: any) => n.title === 'locked one').readOnly).toBe(true);
    expect(list.find((n: any) => n.title === 'User manual').readOnly).toBe(true);
    expect(list.find((n: any) => n.title === 'loose one').readOnly).toBe(false);
    const restoredLocked = list.find((n: any) => n.title === 'locked one');
    expect((await c.patch(`/api/notes/${restoredLocked.id}`, { title: 'x' })).status).toBe(403);
    expect(strayFiles(db(), env.dataDir, id)).toEqual([]);
    // The safety backup holds the read-only notes as they were.
    const safety = (await c.get('/api/safety-backups')).json.backups[0];
    const safe = openBackup((await c.get(`/api/safety-backups/${safety.name}`)).rawPayload).data;
    expect(safe.notes.find((n: any) => n.title === 'locked one').readOnly).toBe(true);
  });

  it('a backup made before read-only notes existed restores with every note writable', async () => {
    const c = await newUser(env, 'ro_old');
    const id = await idOf(c);
    await c.post('/api/notes', { title: 'old one', content: doc('x') });
    await c.post('/api/notes', { title: 'old two', content: doc('y') });
    const b = openBackup((await takeBackup(c)).file);
    // As the previous version wrote it: format 1, no readOnly field.
    b.manifest.version = 1;
    for (const n of b.data.notes) delete n.readOnly;
    const old = packBackup(b);
    const lockedNow = (await c.get('/api/notes')).json.notes[0];
    await c.post(`/api/notes/${lockedNow.id}/read-only`, {});
    const r = await restore(c, old);
    expect(r.done.status, r.done.body).toBe(200);
    const list = (await c.get('/api/notes')).json.notes;
    expect(list.map((n: any) => n.title).sort()).toEqual(['old one', 'old two']);
    expect(list.every((n: any) => n.readOnly === false)).toBe(true);
    expect(strayFiles(db(), env.dataDir, id)).toEqual([]);
  });
});

describe('default styles', () => {
  const stylesOf = async (c: Client) => (await c.get('/api/styles')).json.styles as any[];
  const defaultsOf = async (c: Client) => (await stylesOf(c)).filter((s) => s.isDefault).map((s) => `${s.name} ${s.fontFamily} ${s.size}`).sort();
  const STANDARD = ['Aside Caveat 24', 'Body Inter 16', 'Code Fira Code 14', 'Quote Lora 20', 'Title Playfair Display 40'];

  it('a backup holds only the user’s own styles; a restore keeps the account’s one set of defaults', async () => {
    const c = await newUser(env, 'ds_new');
    const inter = (await c.get('/api/fonts')).json.fonts.find((f: any) => f.family === 'Inter');
    await c.post('/api/styles', { name: 'Body', fontId: inter.id, size: 22 }); // the user's own "Body"
    await c.post('/api/styles', { name: 'Fancy', fontId: inter.id, size: 30, bold: true });
    const defaultIds = (await stylesOf(c)).filter((s) => s.isDefault).map((s) => s.id).sort();
    const { file } = await takeBackup(c);
    const data = openBackup(file).data;
    expect(data.styles.map((s: any) => s.name).sort()).toEqual(['Body', 'Fancy']);
    expect(data.styles.every((s: any) => s.isDefault === undefined)).toBe(true);

    await c.post('/api/styles', { name: 'Later', fontId: inter.id, size: 12 });
    expect((await restore(c, file)).done.status).toBe(200);
    const after = await stylesOf(c);
    expect(await defaultsOf(c)).toEqual(STANDARD);
    expect(after.filter((s) => s.isDefault).map((s) => s.id).sort()).toEqual(defaultIds); // the same five
    expect(after.filter((s) => !s.isDefault).map((s) => `${s.name} ${s.size}`).sort()).toEqual(['Body 22', 'Fancy 30']);
    // The defaults use the restored fonts.
    const fonts = (await c.get('/api/fonts')).json.fonts;
    for (const s of after) expect(fonts.find((f: any) => f.id === s.fontId)?.family).toBe(s.fontFamily);
    // Restoring the same backup again never duplicates them.
    expect((await restore(c, file)).done.status).toBe(200);
    expect(await defaultsOf(c)).toEqual(STANDARD);
    expect((await stylesOf(c)).length).toBe(7);
  });

  it('a backup made before default styles (starter styles as ordinary ones) restores with exactly one set', async () => {
    const c = await newUser(env, 'ds_old');
    const b = openBackup((await takeBackup(c)).file);
    // As the previous version wrote it: format 2, the five starter styles included,
    // created together with the account (= the starter fonts' creation time).
    b.manifest.version = 2;
    const fontOf = (family: string) => b.data.fonts.find((f: any) => f.family === family);
    const created = fontOf('Inter').createdAt;
    const st = (name: string, family: string, size: number, extra: object = {}, at = created) => ({
      id: newId(), name, fontId: fontOf(family).id, size, bold: false, italic: false, underline: false, strike: false, textColor: null, highlight: null, createdAt: at, updatedAt: at, ...extra,
    });
    b.data.styles = [
      st('Body', 'Inter', 30, { bold: true }), // an edited starter Body
      st('My Title', 'Playfair Display', 40, { bold: true }), // a renamed starter
      st('Quote', 'Lora', 20, { italic: true, textColor: 'Violet' }),
      st('Aside', 'Caveat', 24, { textColor: 'Electric' }),
      st('Code', 'Fira Code', 14, { textColor: 'Jade' }),
      st('Body', 'Lora', 18, {}, '2026-12-01T00:00:00.000Z'), // a style the user made, called Body
    ];
    b.manifest.counts = { ...b.manifest.counts, styles: b.data.styles.length };
    const r = await restore(c, packBackup(b));
    expect(r.done.status, r.done.body).toBe(200);
    expect(await defaultsOf(c)).toEqual(STANDARD);
    const own = (await stylesOf(c)).filter((s) => !s.isDefault).map((s) => `${s.name} ${s.fontFamily} ${s.size}`).sort();
    expect(own).toEqual(['Body Lora 18', 'My Title Playfair Display 40']);
    // The restored ordinary ones stay editable.
    const mine = (await stylesOf(c)).find((s) => s.name === 'My Title');
    expect((await c.put(`/api/styles/${mine.id}`, { ...mine, size: 41 })).status).toBe(200);
  });

  it('a backup restored into another account leaves that account its own one set', async () => {
    const a = await newUser(env, 'ds_from');
    const b = await newUser(env, 'ds_into');
    const bDefaults = (await stylesOf(b)).filter((s) => s.isDefault).map((s) => s.id).sort();
    expect((await restore(b, (await takeBackup(a)).file)).done.status).toBe(200);
    expect((await stylesOf(b)).filter((s) => s.isDefault).map((s) => s.id).sort()).toEqual(bDefaults);
    expect((await stylesOf(b)).length).toBe(5);
  });
});

describe('backup while writing', () => {
  it('saves and uploads run during many backups; every backup checks out and has every file', async () => {
    const c = await newUser(env, 'busy');
    const n = (await c.post('/api/notes', { title: 'busy', content: doc('x') })).json.note;
    let stop = false;
    let writes = 0;
    const writer = (async () => {
      let i = 0;
      while (!stop) {
        i++;
        await c.patch(`/api/notes/${n.id}`, { content: doc(`edit ${i}`) });
        await c.upload('/api/photos', `p${i}.png`, PNG_1PX, 'image/png');
        await c.post('/api/notes', { title: `w${i}`, content: doc('w') });
        writes++;
      }
    })();
    try {
      for (let k = 0; k < 8; k++) {
        const { info, file } = await takeBackup(c);
        expect(info.missing).toEqual([]);
        // Every backup is accepted by the restore check, with nothing missing.
        const s = await stage(c, file);
        expect(s.status, s.body).toBe(201);
        expect(s.json.restore.summary.missing).toEqual([]);
        expect(s.json.restore.summary.counts.photos).toBe(info.counts.photos);
        await c.del(`/api/restore/${s.json.restore.id}`);
      }
    } finally {
      stop = true;
      await writer;
    }
    expect(writes).toBeGreaterThan(0);
  });
});

describe('content and missing files', () => {
  it('script in a note is removed on restore, and the number of adjusted notes is reported', async () => {
    const c = await newUser(env, 'unclean');
    const id = await idOf(c);
    await c.post('/api/notes', { title: 'clean', content: doc('fine') });
    await c.post('/api/notes', { title: 'dirty', content: doc('to be replaced') });
    const b = openBackup((await takeBackup(c)).file);
    const dirty = b.data.notes.find((n: any) => n.title === 'dirty');
    dirty.content = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
        { type: 'script', content: [{ type: 'text', text: 'alert(2)' }] },
        { type: 'image', attrs: { src: 'javascript:alert(3)', onerror: 'alert(4)' } },
        { type: 'paragraph', attrs: { style: 'background:url(x)' }, content: [{ type: 'text', text: 'kept' }] },
      ],
    };
    const crafted = packBackup(b);
    const s = await stage(c, crafted);
    expect(s.status, s.body).toBe(201);
    expect(s.json.restore.summary.adjustedNotes).toBe(1);
    expect((await c.post(`/api/restore/${s.json.restore.id}/confirm`, { confirm: 'RESTORE' })).status).toBe(200);
    const note = (await c.get('/api/notes')).json.notes.find((n: any) => n.title === 'dirty');
    const content = JSON.stringify((await c.get(`/api/notes/${note.id}`)).json.note.content);
    expect(content).toContain('kept');
    expect(content).not.toMatch(/javascript|script|alert|onerror|style/);
    expect(strayFiles(db(), env.dataDir, id)).toEqual([]);
  });

  it('a record whose file is gone does not block a backup; it is listed, and the backup restores', async () => {
    const c = await newUser(env, 'lost');
    const id = await idOf(c);
    const photo = (await c.upload('/api/photos', 'gone.png', PNG_1PX, 'image/png')).json.photo;
    await c.post('/api/notes', { title: 'has lost photo', content: { type: 'doc', content: [{ type: 'image', attrs: { src: photo.url } }] } });
    const slab = (await c.post('/api/fonts', { family: 'Roboto Slab' })).json.font;
    unlinkSync(join(env.dataDir, 'users', id, 'photos', photo.id));
    unlinkSync(join(env.dataDir, 'users', id, 'fonts', slab.id, '1.woff2'));

    const { info, file } = await takeBackup(c);
    expect(info.missing.map((m: any) => m.name).sort()).toEqual([`fonts/${slab.id}/1.woff2`, `photos/${photo.id}`]);
    expect(info.missing.map((m: any) => m.what).join(' ')).toMatch(/gone\.png/);
    expect(info.missing.map((m: any) => m.what).join(' ')).toMatch(/Roboto Slab/);

    await c.post('/api/notes', { title: 'after', content: doc('x') });
    const s = await stage(c, file);
    expect(s.status, s.body).toBe(201);
    expect(s.json.restore.summary.missing.length).toBe(2);
    expect((await c.post(`/api/restore/${s.json.restore.id}/confirm`, { confirm: 'RESTORE' })).status).toBe(200);
    // The record comes back without its file.
    const rows = db().prepare('SELECT * FROM photos WHERE user_id = ?').all(id) as any[];
    expect(rows.map((r) => r.original_name)).toEqual(['gone.png']);
    expect((await c.get(`/api/photos/${rows[0].id}`)).status).toBe(404);
    const note = (await c.get('/api/notes')).json.notes.find((n: any) => n.title === 'has lost photo');
    expect((await c.get(`/api/notes/${note.id}`)).json.note.content.content[0].attrs.src).toBe(`/api/photos/${rows[0].id}`);
    const font = (await c.get('/api/fonts')).json.fonts.find((f: any) => f.family === 'Roboto Slab');
    expect((await c.get(`/api/fonts/${font.id}/files/0.woff2`)).status).toBe(200);
    expect((await c.get(`/api/fonts/${font.id}/files/1.woff2`)).status).toBe(404);
    expect(strayFiles(db(), env.dataDir, id)).toEqual([]);
  });
});

describe('confirming, cancelling and staging', () => {
  it('a restore needs RESTORE typed, and nothing changes until then', async () => {
    const c = await newUser(env, 'confirmer');
    const id = await idOf(c);
    await c.post('/api/notes', { title: 'keep', content: doc('k') });
    const { file } = await takeBackup(c);
    await c.post('/api/notes', { title: 'second', content: doc('s') });
    const before = snap(id);
    const s = await stage(c, file);
    expect(s.status).toBe(201);
    for (const confirm of [undefined, '', 'restore', 'RESTORE ', 'yes']) {
      expect((await c.post(`/api/restore/${s.json.restore.id}/confirm`, { confirm })).status).toBe(400);
    }
    expect(snap(id)).toEqual(before);
  });

  it('cancelling deletes the upload; a confirmed or cancelled restore cannot be used again', async () => {
    const c = await newUser(env, 'canceller');
    const id = await idOf(c);
    const { file } = await takeBackup(c);
    const s = await stage(c, file);
    const dir = join(env.dataDir, 'staging', id, s.json.restore.id);
    expect(existsSync(dir)).toBe(true);
    expect((await c.del(`/api/restore/${s.json.restore.id}`)).status).toBe(204);
    expect(existsSync(dir)).toBe(false);
    expect((await c.post(`/api/restore/${s.json.restore.id}/confirm`, { confirm: 'RESTORE' })).status).toBe(404);
    const s2 = await stage(c, file);
    expect((await c.post(`/api/restore/${s2.json.restore.id}/confirm`, { confirm: 'RESTORE' })).status).toBe(200);
    expect((await c.post(`/api/restore/${s2.json.restore.id}/confirm`, { confirm: 'RESTORE' })).status).toBe(404);
  });

  it('an upload left unconfirmed for 24 hours is deleted', async () => {
    const c = await newUser(env, 'forgetful');
    const id = await idOf(c);
    const { file } = await takeBackup(c);
    const old = (await stage(c, file)).json.restore.id;
    const dir = join(env.dataDir, 'staging', id, old);
    const dayAgo = new Date(Date.now() - 25 * 3600 * 1000);
    utimesSync(dir, dayAgo, dayAgo);
    await stage(c, file); // any later upload tidies old ones
    expect(existsSync(dir)).toBe(false);
    expect((await c.post(`/api/restore/${old}/confirm`, { confirm: 'RESTORE' })).status).toBe(404);
  });

  it('unconfirmed uploads and unfinished downloads are deleted at the next server start', async () => {
    const c = await newUser(env, 'restarter');
    const id = await idOf(c);
    const { file } = await takeBackup(c);
    await stage(c, file);
    await c.post('/api/backup', {}); // built, never downloaded
    expect(readdirSync(join(env.dataDir, 'staging', id)).length).toBe(2);
    // A second app on the same folder stands in for the next start.
    const again = await buildApp({ dataDir: env.dataDir, logger: false });
    await again.close();
    expect(existsSync(join(env.dataDir, 'staging')) ? readdirSync(join(env.dataDir, 'staging')).flatMap((u) => readdirSync(join(env.dataDir, 'staging', u))) : []).toEqual([]);
  });

  it('a downloaded backup is removed from the server after the download', async () => {
    const c = await newUser(env, 'downloader');
    const made = (await c.post('/api/backup', {})).json.backup;
    expect((await c.get(`/api/backup/${made.id}`)).status).toBe(200);
    expect((await c.get(`/api/backup/${made.id}`)).status).toBe(404);
  });
});

describe('safety backups', () => {
  it('a restore first takes a safety backup; restoring it brings back the pre-restore data', async () => {
    const c = await newUser(env, 'safe');
    const id = await idOf(c);
    await seed(c, 'early');
    const { file } = await takeBackup(c);
    await scramble(c);
    const preRestore = snap(id);
    expect((await c.get('/api/safety-backups')).json.backups).toEqual([]);
    expect((await restore(c, file)).done.status).toBe(200);

    const list = (await c.get('/api/safety-backups')).json.backups;
    expect(list.length).toBe(1);
    expect(list[0].name).toMatch(/^jot-safety-\d{8}-\d{6}-[0-9a-f]{8}\.tar$/);
    expect(list[0].size).toBeGreaterThan(0);
    const dl = await c.get(`/api/safety-backups/${list[0].name}`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain(list[0].name);

    expect((await restore(c, dl.rawPayload)).done.status).toBe(200);
    expect(snap(id)).toEqual(preRestore);
    expect((await c.get('/api/safety-backups')).json.backups.length).toBe(2); // Jot never deletes them itself

    expect((await c.del(`/api/safety-backups/${list[0].name}`)).status).toBe(204);
    expect((await c.get('/api/safety-backups')).json.backups.length).toBe(1);
    expect((await c.get(`/api/safety-backups/${list[0].name}`)).status).toBe(404);
    expect((await c.del(`/api/safety-backups/${list[0].name}`)).status).toBe(404);
  });
});

describe('an open tab from before the restore', () => {
  it('cannot change restored notes: its note ids no longer exist', async () => {
    const c = await newUser(env, 'oldtab');
    const id = await idOf(c);
    const n = (await c.post('/api/notes', { title: 'original', content: doc('original text') })).json.note;
    const { file } = await takeBackup(c);
    expect((await restore(c, file)).done.status).toBe(200);
    const after = snap(id);
    const save = await c.patch(`/api/notes/${n.id}`, { title: 'from old tab', content: doc('old tab text') });
    expect(save.status).toBe(404);
    expect((await c.post(`/api/notes/${n.id}/tags`, { tag: 'old' })).status).toBe(404);
    expect((await c.del(`/api/notes/${n.id}`)).status).toBe(404);
    expect(snap(id)).toEqual(after);
  });
});

describe('one at a time', () => {
  it('a backup or restore is refused while another one holds the lock', async () => {
    const c = await newUser(env, 'waiter');
    const { file } = await takeBackup(c);
    const s = await stage(c, file);
    const lock = tryLock(env.dataDir)!;
    expect(lock).not.toBeNull();
    try {
      const b = await c.post('/api/backup', {});
      expect(b.status).toBe(409);
      expect(b.json.error).toMatch(/another backup or restore/i);
      expect((await c.post(`/api/restore/${s.json.restore.id}/confirm`, { confirm: 'RESTORE' })).status).toBe(409);
    } finally {
      lock.release();
    }
    expect((await c.post(`/api/restore/${s.json.restore.id}/confirm`, { confirm: 'RESTORE' })).status).toBe(200);
  });

  it('during a restore, a second backup is refused and that user’s saves and uploads are refused', async () => {
    const c = await newUser(env, 'during');
    const n = (await c.post('/api/notes', { title: 'n', content: doc('n') })).json.note;
    const { file } = await takeBackup(c);
    const s = await stage(c, file);
    process.env.JOT_FAILPOINT = 'restore:after-safety-backup:sleep=1500';
    const running = c.post(`/api/restore/${s.json.restore.id}/confirm`, { confirm: 'RESTORE' });
    await new Promise((r) => setTimeout(r, 500));
    const patch = await c.patch(`/api/notes/${n.id}`, { title: 'during' });
    expect(patch.status).toBe(409);
    expect(patch.json.error).toMatch(/restore .*in progress/i);
    expect((await c.upload('/api/photos', 'x.png', PNG_1PX, 'image/png')).status).toBe(409);
    expect((await c.post('/api/notes', { title: 'new' })).status).toBe(409);
    expect((await c.post('/api/backup', {})).status).toBe(409);
    expect((await running).status).toBe(200);
    // Afterwards saves work again.
    expect((await c.post('/api/notes', { title: 'after' })).status).toBe(201);
  });
});

describe('a restore that fails part-way', () => {
  it.each(['restore:during-safety-backup', 'restore:during-new-files', 'restore:before-commit'])(
    'leaves the old data, no stray files, and releases the lock (%s)',
    async (fp) => {
      const c = await newUser(env, `fail_${fp.split(':')[1].replace(/-/g, '_')}`);
      const id = await idOf(c);
      await seed(c, 'fail');
      const { file } = await takeBackup(c);
      await scramble(c);
      const before = snap(id);
      const s = await stage(c, file);
      process.env.JOT_FAILPOINT = `${fp}:throw`;
      const r = await c.post(`/api/restore/${s.json.restore.id}/confirm`, { confirm: 'RESTORE' });
      expect(r.status).toBe(500);
      delete process.env.JOT_FAILPOINT;
      expect(snap(id)).toEqual(before);
      expect(strayFiles(db(), env.dataDir, id)).toEqual([]);
      expect((await c.post('/api/notes', { title: 'saves work' })).status).toBe(201);
      // The lock was released: a new restore works.
      expect((await restore(c, file)).done.status).toBe(200);
    },
  );
});

describe('login', () => {
  it('backup and restore routes need a login', async () => {
    const nobody = client(env.app);
    expect((await nobody.post('/api/backup', {})).status).toBe(401);
    expect((await nobody.get('/api/backup/AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(401);
    expect((await nobody.raw('/api/restore', Buffer.alloc(1024), 'application/x-tar')).status).toBe(401);
    expect((await nobody.post('/api/restore/AAAAAAAAAAAAAAAAAAAAAA/confirm', { confirm: 'RESTORE' })).status).toBe(401);
    expect((await nobody.get('/api/safety-backups')).status).toBe(401);
  });
});
