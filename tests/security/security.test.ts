// Type 4 (security): injection through search and note content, script injection in
// notes, login bypass, and path tricks in photo and font file names.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, doc, makeTestEnv, newUser, PASSWORD, PNG_1PX, type Client, type TestEnv } from '../helpers/setup';

let env: TestEnv;
let alice: Client;
let aliceId: string;
let fontId: string;
let noteId: string;
let photoUrl: string;

beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
  await newUser(env, 'bob');
  aliceId = (await alice.get('/api/me')).json.user.id;
  fontId = (await alice.get('/api/fonts')).json.fonts[0].id;
  noteId = (await alice.post('/api/notes', { title: 'Sec', content: doc('canary') })).json.note.id;
  photoUrl = (await alice.upload('/api/photos', 'p.png', PNG_1PX, 'image/png')).json.photo.url;
});
afterAll(() => env.close());

function allFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...allFiles(p));
    else out.push(p);
  }
  return out;
}

describe('search injection', () => {
  it.each([
    ['sql comment', "' OR 1=1 --"],
    ['sql union', "x' UNION SELECT password_hash FROM users --"],
    ['fts star', '*'],
    ['fts column filter', 'title:canary'],
    ['fts near', 'NEAR(canary sec, 5)'],
    ['unbalanced quote', '"canary'],
    ['fts operators', 'canary AND OR NOT'],
    ['brackets', '{title body}: canary'],
    ['caret', '^canary'],
    ['nul byte', 'canary\u0000'],
    ['very long', 'a'.repeat(10000)],
  ])('%s does not error or leak', async (_label, q) => {
    const res = await alice.get(`/api/search?q=${encodeURIComponent(q)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.notes)).toBe(true);
    expect(res.body).not.toMatch(/argon2|password|SQLITE|fts5: syntax/i);
  });

  it('a hostile query leaves the database intact', async () => {
    await alice.get(`/api/search?q=${encodeURIComponent('"; DROP TABLE notes; --')}`);
    expect((await alice.get(`/api/notes/${noteId}`)).status).toBe(200);
    expect((await alice.get('/api/search?q=canary')).json.notes.length).toBe(1);
  });

  it('the tag filter on the notes list is parameterised', async () => {
    const res = await alice.get(`/api/notes?tag=${encodeURIComponent("x' OR '1'='1")}`);
    expect(res.status).toBe(200);
    expect(res.json.notes).toEqual([]);
  });
});

describe('script and content injection in notes', () => {
  async function save(content: any) {
    const res = await alice.patch(`/api/notes/${noteId}`, { content });
    expect(res.status).toBe(200);
    return res.json.note.content;
  }

  it('stores the title as plain text', async () => {
    const title = '<img src=x onerror=alert(1)><script>alert(1)</script>';
    const res = await alice.patch(`/api/notes/${noteId}`, { title });
    expect(res.json.note.title).toBe(title);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('drops unknown node types such as script or iframe', async () => {
    const out = await save({
      type: 'doc',
      content: [
        { type: 'script', content: [{ type: 'text', text: 'alert(1)' }] },
        { type: 'iframe', attrs: { src: 'https://evil.example' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'kept' }] },
      ],
    });
    expect(out).toEqual(doc('kept'));
  });

  it('drops unknown attributes such as event handlers', async () => {
    const out = await save({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { onclick: 'alert(1)', style: 'x' }, content: [{ type: 'text', text: 'p' }] }],
    });
    expect(JSON.stringify(out)).not.toMatch(/onclick|alert/);
  });

  it.each([
    ['javascript url', 'javascript:alert(1)'],
    ['data url', 'data:text/html,<script>alert(1)</script>'],
    ['external url', 'https://evil.example/track.png'],
    ['path traversal', '/api/photos/../../jot.db'],
    ['other api route', '/api/me'],
  ])('drops images whose src is a %s', async (_l, src) => {
    const out = await save({ type: 'doc', content: [{ type: 'image', attrs: { src } }, { type: 'paragraph' }] });
    expect(JSON.stringify(out)).not.toContain(src);
  });

  it.each([
    ['javascript', 'javascript:alert(1)'],
    ['JaVaScRiPt with spaces', '  JaVaScRiPt:alert(1)'],
    ['vbscript', 'vbscript:msgbox(1)'],
    ['data', 'data:text/html;base64,PHNjcmlwdD4='],
  ])('drops links with a %s href', async (_l, href) => {
    const out = await save({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href } }] }] }],
    });
    expect(out.content[0].content[0].text).toBe('click');
    expect(JSON.stringify(out)).not.toContain(href.trim());
  });

  it('drops CSS injection through style attributes', async () => {
    const out = await save({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'styled',
              marks: [
                { type: 'textStyle', attrs: { color: 'red; background: url(https://evil.example)', fontFamily: 'x; } body { display:none', fontSize: '12px; position: fixed' } },
                { type: 'highlight', attrs: { color: 'url(https://evil.example)' } },
              ],
            },
          ],
        },
      ],
    });
    const s = JSON.stringify(out);
    expect(s).not.toMatch(/evil|display|position|;/);
  });

  it('drops photo border colours and sizes outside the allowed set', async () => {
    const out = await save({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: photoUrl, borderWidth: 99, borderColor: 'red;x', width: -5 } }],
    });
    expect(out.content[0].attrs.src).toBe(photoUrl);
    expect(out.content[0].attrs.borderWidth ?? 0).toBe(0);
    expect(out.content[0].attrs.borderColor ?? null).toBeNull();
    expect(out.content[0].attrs.width ?? null).toBeNull();
  });

  it('drops nodes that are not allowed where they appear', async () => {
    const out = await save({
      type: 'doc',
      content: [
        { type: 'text', text: 'loose text in doc' },
        { type: 'paragraph', content: [{ type: 'doc' }, { type: 'paragraph', content: [{ type: 'text', text: 'nested' }] }, { type: 'text', text: 'ok' }] },
        { type: 'bulletList', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'not an item' }] }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell' }] }] },
        { type: 'blockquote' },
      ],
    });
    expect(out).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'ok' }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] },
        { type: 'blockquote', content: [{ type: 'paragraph' }] },
      ],
    });
  });

  it('rejects deeply nested documents', async () => {
    let node: any = { type: 'paragraph', content: [{ type: 'text', text: 'deep' }] };
    for (let i = 0; i < 500; i++) node = { type: 'blockquote', content: [node] };
    const res = await alice.patch(`/api/notes/${noteId}`, { content: { type: 'doc', content: [node] } });
    expect(res.status).toBe(400);
  });

  it('does not let note content set its own owner or id', async () => {
    const res = await alice.patch(`/api/notes/${noteId}`, { title: 'x', userId: 'someone', id: 'other', deletedAt: '2020-01-01' });
    expect(res.status).toBe(200);
    expect(res.json.note.id).toBe(noteId);
    expect(res.json.note.deletedAt).toBeNull();
  });
});

describe('login bypass', () => {
  const protectedRoutes: Array<[string, string]> = [
    ['GET', '/api/me'],
    ['GET', '/api/notes'],
    ['POST', '/api/notes'],
    ['GET', '/api/notes/abc'],
    ['PATCH', '/api/notes/abc'],
    ['DELETE', '/api/notes/abc'],
    ['POST', '/api/notes/abc/tags'],
    ['DELETE', '/api/notes/abc/tags/x'],
    ['GET', '/api/tags'],
    ['GET', '/api/search?q=canary'],
    ['GET', '/api/trash'],
    ['POST', '/api/trash/abc/restore'],
    ['DELETE', '/api/trash/abc'],
    ['POST', '/api/photos'],
    ['GET', '/api/photos/abc'],
    ['GET', '/api/fonts'],
    ['POST', '/api/fonts'],
    ['GET', '/api/fonts/catalog'],
    ['GET', '/api/fonts.css'],
    ['GET', '/api/fonts/abc/files/0.woff2'],
    ['POST', '/api/fonts/abc/archive'],
    ['POST', '/api/fonts/abc/unarchive'],
    ['GET', '/api/styles'],
    ['POST', '/api/styles'],
    ['PUT', '/api/styles/abc'],
    ['DELETE', '/api/styles/abc'],
    ['GET', '/api/buttons'],
    ['PATCH', '/api/buttons/1'],
  ];

  async function call(method: string, url: string, cookie?: string) {
    return env.app.inject({
      method: method as any,
      url,
      headers: { ...(cookie ? { cookie } : {}), ...(method === 'GET' || method === 'DELETE' ? {} : { 'content-type': 'application/json' }) },
      payload: method === 'GET' || method === 'DELETE' ? undefined : '{}',
    });
  }

  it('every protected route needs a session', async () => {
    for (const [m, u] of protectedRoutes) expect((await call(m, u)).statusCode, `${m} ${u}`).toBe(401);
  });

  it('a forged or malformed cookie is refused', async () => {
    for (const cookie of ['jot_session=forged', 'jot_session=', `jot_session=${'A'.repeat(43)}`, "jot_session=' OR '1'='1", 'jot_session=../../jot.db']) {
      for (const [m, u] of protectedRoutes) expect((await call(m, u, cookie)).statusCode, `${cookie} ${m} ${u}`).toBe(401);
    }
  });

  it('SQL injection in the login form does not log in', async () => {
    for (const username of ["' OR '1'='1", "alice' --", "alice'/*", 'alice" OR ""="']) {
      const res = await client(env.app).post('/api/login', { username, password: "' OR '1'='1" });
      expect(res.status).toBe(401);
    }
    expect((await client(env.app).post('/api/login', { username: 'alice', password: "' OR '1'='1" })).status).toBe(401);
  });

  it('an expired session is refused', async () => {
    const c = client(env.app);
    const res = await c.post('/api/login', { username: 'alice', password: PASSWORD });
    const cookie = [res.headers['set-cookie']].flat().join(';').match(/jot_session=[^;]+/)![0];
    expect((await call('GET', '/api/me', cookie)).statusCode).toBe(200);
    (env.app as any).jot.db.prepare('UPDATE sessions SET expires_at = ?').run('2000-01-01T00:00:00.000Z');
    expect((await call('GET', '/api/me', cookie)).statusCode).toBe(401);
    // keep the other tests' session working
    const fresh = await client(env.app).post('/api/login', { username: 'alice', password: PASSWORD });
    alice.cookie = [fresh.headers['set-cookie']].flat().join(';').match(/jot_session=[^;]+/)![0];
  });

  it('the session token is not stored in plain text', async () => {
    const res = await client(env.app).post('/api/login', { username: 'alice', password: PASSWORD });
    const token = [res.headers['set-cookie']].flat().join(';').match(/jot_session=([^;]+)/)![1];
    const rows = (env.app as any).jot.db.prepare('SELECT * FROM sessions').all();
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('passwords are stored as Argon2id hashes', async () => {
    const row = (env.app as any).jot.db.prepare('SELECT password_hash FROM users WHERE username = ?').get('alice');
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.password_hash).not.toContain(PASSWORD);
  });

  it('refuses cross-site state-changing requests', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/notes',
      headers: { cookie: alice.cookie!, origin: 'https://evil.example', host: 'localhost:9003', 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(403);
    const same = await env.app.inject({
      method: 'POST',
      url: '/api/notes',
      headers: { cookie: alice.cookie!, origin: 'http://localhost:9003', host: 'localhost:9003', 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(same.statusCode).toBe(201);
  });

  it('refuses form-encoded posts (no CSRF via HTML forms)', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/notes',
      headers: { cookie: alice.cookie!, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'title=x',
    });
    expect(res.statusCode).toBe(415);
  });
});

describe('path tricks', () => {
  it.each([
    '/api/photos/..%2F..%2Fjot.db',
    '/api/photos/..%2Fphotos',
    '/api/photos/%2e%2e',
    '/api/photos/..',
    '/api/photos/.%2F.%2F',
    `/api/photos/${encodeURIComponent('../../../etc/passwd')}`,
    `/api/photos/${encodeURIComponent('/etc/passwd')}`,
  ])('photo route refuses %s', async (url) => {
    const res = await alice.get(url);
    expect([400, 404]).toContain(res.status);
    expect(res.body).not.toMatch(/SQLite format|root:/);
  });

  it.each([
    '0.woff2/..%2F..%2F..%2Fjot.db',
    '..%2F..%2F..%2Fjot.db',
    '%2e%2e%2F0.woff2',
    `${encodeURIComponent('/etc/passwd')}`,
    '0.woff2%00.txt',
    '0.ttf',
    'manifest.json',
  ])('font file route refuses %s', async (file) => {
    const res = await alice.get(`/api/fonts/${fontId}/files/${file}`);
    expect([400, 404]).toContain(res.status);
    expect(res.body).not.toMatch(/SQLite format|root:/);
  });

  it('font route refuses a traversing font id', async () => {
    for (const id of ['..', '..%2F..', `${fontId}%2F..%2F..`]) {
      const res = await alice.get(`/api/fonts/${id}/files/0.woff2`);
      expect([400, 404]).toContain(res.status);
    }
  });

  it('an uploaded file name never decides where the photo is stored', async () => {
    const res = await alice.upload('/api/photos', '../../../evil.png', PNG_1PX, 'image/png');
    expect(res.status).toBe(201);
    expect(res.json.photo.id).not.toMatch(/evil|\.\./);
    const names = allFiles(env.dataDir).map((p) => p.slice(env.dataDir.length));
    expect(names.some((n) => n.includes('evil'))).toBe(false);
    for (const n of names) expect(n === '/.lock' || n.startsWith('/jot.db') || n.startsWith('/users/') || n.startsWith('/tmp/'), n).toBe(true);
    const stored = join(env.dataDir, 'users', aliceId, 'photos', res.json.photo.id);
    expect(statSync(stored).isFile()).toBe(true);
  });

  it('a font family name cannot escape the fonts folder', async () => {
    for (const family of ['../../etc', 'Roboto Slab/../../x', 'a"b']) {
      const res = await alice.post('/api/fonts', { family });
      expect(res.status).toBe(400);
    }
  });

  it('photos are served so the browser will not run them', async () => {
    const res = await alice.get(photoUrl);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(String(res.headers['content-security-policy'])).toMatch(/sandbox/);
  });
});

describe('response headers', () => {
  it('sets a content security policy on the app', async () => {
    const res = await client(env.app).get('/');
    expect(String(res.headers['content-security-policy'])).toMatch(/script-src 'self'/);
    expect(String(res.headers['content-security-policy'])).toMatch(/object-src 'none'/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('does not leak internals on errors', async () => {
    const res = await env.app.inject({
      method: 'PATCH',
      url: `/api/notes/${noteId}`,
      headers: { cookie: alice.cookie!, 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toMatch(/node_modules|at .*\.ts:/);
  });
});
