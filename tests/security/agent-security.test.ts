// Type 4 (security) for agent notes: bearer tokens only at /mcp; tokens never logged;
// no tool or request can modify an existing note; raw HTML and script stay literal text;
// links only http, https and mailto; images verified by their bytes; nothing is ever
// fetched from a URL.
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { buildApp } from '../../src/server/app';
import { startFakeGoogle, type FakeGoogle } from '../helpers/fakeGoogle';
import { client, doc, login, PNG_1PX, type Client } from '../helpers/setup';
import { b64, call, connectBot, idFrom } from '../helpers/mcp';
import { createUser } from '../../src/server/users';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// An app with a captured log, so the test can read every line it writes.
let log = '';
const sink = new Writable({
  write(chunk, _enc, cb) {
    log += chunk.toString();
    cb();
  },
});
let app: Awaited<ReturnType<typeof buildApp>>;
let google: FakeGoogle;
let dataDir: string;
let base: string;
let alice: Client;
let bot: McpClient;
let token: string;
const db = () => (app as any).jot.db;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'jot-agentsec-'));
  google = await startFakeGoogle();
  app = await buildApp({ dataDir, logger: true, logStream: sink, fonts: google.config });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  await createUser((app as any).jot, 'alice', 'correct horse battery');
  alice = await login(app, 'alice', 'correct horse battery');
  token = (await alice.post('/api/bots', { name: 'Probe' })).json.bot.token;
  bot = await connectBot(base, token);
});
afterAll(async () => {
  await bot?.close();
  await app.close();
  await google.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const rawMcp = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${token}` }) =>
  fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });

describe('authentication at /mcp', () => {
  it('needs a bearer token; GET and DELETE are not allowed', async () => {
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    expect((await rawMcp(list, {})).status).toBe(401);
    expect((await rawMcp(list, { authorization: `bearer ${token}` })).status).toBe(200); // the scheme is case-insensitive
    expect((await rawMcp(list, { authorization: token })).status).toBe(401);
    expect((await rawMcp(list, { authorization: `Bearer ${token} extra` })).status).toBe(401);
    expect((await rawMcp(list, { cookie: alice.cookie! })).status).toBe(401);
    expect((await fetch(`${base}/mcp`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(405);
    expect((await fetch(`${base}/mcp`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })).status).toBe(405);
  });
});

describe('tokens are never logged', () => {
  it('not by requests with good or bad tokens, and the logger redacts the Authorization header', async () => {
    await call(bot, 'list_notes', {});
    await rawMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { authorization: 'Bearer jot_wrongwrongwrongwrongwrongwrongwrongwrongwro' });
    await fetch(`${base}/api/notes`, { headers: { authorization: `Bearer ${token}` } });
    // Anything that logs a request's headers gets the Authorization header redacted.
    app.log.info({ headers: { authorization: `Bearer ${token}`, cookie: alice.cookie } }, 'header check');
    await new Promise((r) => setTimeout(r, 50));
    expect(log).toContain('header check');
    expect(log).toContain('[Redacted]');
    expect(log).not.toContain(token);
    expect(log).not.toContain('jot_wrongwrong');
    expect(log).not.toContain(alice.cookie!.split('=')[1]);
  });
});

describe('a bot cannot change anything that exists', () => {
  it('no tool and no request alters an existing note', async () => {
    const n = (await alice.post('/api/notes', { title: 'precious', content: doc('do not touch') })).json.note;
    await alice.post(`/api/notes/${n.id}/tags`, { tag: 'mine' });
    const inboxNote = idFrom((await call(bot, 'create_note', { markdown: 'in the inbox' })).text);
    const snapshot = () => db().prepare('SELECT * FROM notes ORDER BY id').all().map((r: any) => JSON.stringify(r));
    const before = snapshot();
    // Every tool, with arguments that name existing notes.
    await call(bot, 'read_note', { id: n.id });
    await call(bot, 'list_notes', { query: 'precious', tag: 'mine' });
    await call(bot, 'create_note', { markdown: 'new', title: 'precious', tags: ['mine'], request_id: n.id });
    await call(bot, 'create_note', { markdown: 'again', id: n.id, note_id: inboxNote, inbox: false } as any).catch(() => {});
    // Tools that do not exist.
    for (const name of ['update_note', 'edit_note', 'delete_note', 'trash_note', 'keep_note', 'tag_note', 'add_tag']) {
      const r = await rawMcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: { id: n.id, title: 'pwned' } } });
      expect(JSON.stringify(await r.json())).toMatch(/not found|unknown|error/i);
    }
    // Web routes with the token are refused.
    for (const [method, path] of [['PATCH', `/api/notes/${n.id}`], ['DELETE', `/api/notes/${n.id}`], ['POST', `/api/notes/${inboxNote}/keep`]]) {
      const r = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: method === 'DELETE' ? undefined : '{"title":"pwned"}' });
      expect(r.status).toBe(401);
    }
    const after = snapshot();
    // Existing notes are exactly as they were; only new notes were added.
    for (const row of before) expect(after).toContain(row);
  });
});

describe('content a bot sends', () => {
  it('raw HTML and script arrive as literal text; links only http, https and mailto', async () => {
    const id = idFrom(
      (
        await call(bot, 'create_note', {
          markdown: '<script>alert(1)</script>\n\n<img src=x onerror=alert(2)> [a](javascript:alert(3)) [b](data:text/html,<script>x</script>) [c](vbscript:x) [d](https://ok.example) [e](mailto:a@b.c)',
        })
      ).text,
    );
    const note = (await alice.get(`/api/notes/${id}`)).json.note;
    const s = JSON.stringify(note.content);
    expect(note.content.content[0].content[0].text).toBe('<script>alert(1)</script>');
    expect(s).not.toMatch(/"type":"(script|html|iframe)"/);
    const hrefs = [...s.matchAll(/"href":"([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(['https://ok.example', 'mailto:a@b.c']);
  });

  it('an image is judged by its bytes, not its name or stated type', async () => {
    const r = await call(bot, 'create_note', { markdown: '![x](x.png)', images: [{ name: 'x.png', mime_type: 'image/png', data: b64(Buffer.from('GIF89a<script>')) }] });
    // "GIF89a" really is a GIF signature: it is stored as a GIF, whatever it claimed.
    if (!r.isError) {
      const src = JSON.stringify((await alice.get(`/api/notes/${idFrom(r.text)}`)).json.note.content).match(/\/api\/photos\/[A-Za-z0-9_-]+/)![0];
      expect((await alice.get(src)).headers['content-type']).toBe('image/gif');
      expect((await alice.get(src)).headers['content-security-policy']).toMatch(/sandbox/);
    }
    const html = await call(bot, 'create_note', { markdown: 'x', images: [{ name: 'x.png', mime_type: 'image/png', data: b64(Buffer.from('<!doctype html><script>alert(1)</script>')) }] });
    expect(html.isError).toBe(true);
    expect(html.text).toMatch(/JPEG, PNG, GIF or WebP/);
  });

  it('nothing is ever fetched from a web address', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const before = spy.mock.calls.length;
    await call(bot, 'create_note', {
      markdown: '![remote](https://evil.example/pic.png) ![remote2](http://169.254.169.254/latest) [link](https://evil.example/page)',
      images: [{ name: 'ok.png', mime_type: 'image/png', data: b64(PNG_1PX) }],
    });
    const urls = spy.mock.calls.slice(before).map((c) => String(c[0] instanceof Request ? c[0].url : c[0]));
    spy.mockRestore();
    // The only requests are the MCP client's own to Jot.
    expect(urls.filter((u) => !u.startsWith(base))).toEqual([]);
  });
});

void client;
