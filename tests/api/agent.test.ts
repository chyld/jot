// Type 2 (API integration): agent notes over MCP with a real MCP client (agent-spec.md).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { doc, GIF_1PX, makeTestEnv, newUser, PNG_1PX, type Client, type TestEnv } from '../helpers/setup';
import { b64, call, connectBot, idFrom, listen } from '../helpers/mcp';
import { openBackup, restore, takeBackup } from '../helpers/backup';

let env: TestEnv;
let base: string;
let alice: Client;
let aliceId: string;
let grok: McpClient;
let token: string;
const db = () => (env.app as any).jot.db;
const noteRow = (id: string) => db().prepare('SELECT * FROM notes WHERE id = ?').get(id) as any;

beforeAll(async () => {
  env = await makeTestEnv();
  base = await listen(env);
  alice = await newUser(env, 'alice');
  aliceId = (await alice.get('/api/me')).json.user.id;
  const made = await alice.post('/api/bots', { name: 'Grok' });
  token = made.json.bot.token;
  grok = await connectBot(base, token);
});
afterAll(async () => {
  await grok?.close();
  await env.close();
});

describe('tokens', () => {
  it('are created per bot with a unique name of 1 to 40 characters, and stay visible', async () => {
    const r = await alice.post('/api/bots', { name: '  Claude  ' });
    expect(r.status).toBe(201);
    expect(r.json.bot).toMatchObject({ name: 'Claude', lastUsedAt: null });
    expect(r.json.bot.token).toMatch(/^jot_[A-Za-z0-9_-]{43}$/);
    expect((await alice.post('/api/bots', { name: 'claude' })).status).toBe(201); // names are case-sensitive
    expect((await alice.post('/api/bots', { name: 'Claude' })).status).toBe(409);
    for (const name of ['', '   ', 'x'.repeat(41), 'bad\nname', 42]) expect((await alice.post('/api/bots', { name })).status, String(name)).toBe(400);
    const list = await alice.get('/api/bots');
    expect(list.json.bots.map((b: any) => b.name)).toEqual(['Claude', 'claude', 'Grok']);
    expect(list.json.bots.find((b: any) => b.name === 'Claude').token).toBe(r.json.bot.token);
    expect(list.json.publicUrl).toBe('http://localhost:9003');
    expect(list.json.mcpUrl).toBe('http://localhost:9003/mcp');
  });

  it('record when they were last used', async () => {
    const before = (await alice.get('/api/bots')).json.bots.find((b: any) => b.name === 'Grok').lastUsedAt;
    await new Promise((r) => setTimeout(r, 5));
    await call(grok, 'list_notes', {});
    const after = (await alice.get('/api/bots')).json.bots.find((b: any) => b.name === 'Grok').lastUsedAt;
    expect(after).toBeTruthy();
    expect(after > (before ?? '')).toBe(true);
  });

  it('revoking deletes the token at once', async () => {
    const t = (await alice.post('/api/bots', { name: 'Temp' })).json.bot;
    const bot = await connectBot(base, t.token);
    expect((await call(bot, 'list_notes', {})).isError).toBe(false);
    expect((await alice.del(`/api/bots/${t.id}`)).status).toBe(204);
    await expect(call(bot, 'list_notes', {})).rejects.toThrow();
    expect((await alice.get('/api/bots')).json.bots.map((b: any) => b.name)).not.toContain('Temp');
    expect((await alice.del(`/api/bots/${t.id}`)).status).toBe(404);
  });
});

describe('the tools', () => {
  it('are exactly create_note, list_notes and read_note, each warning about untrusted note content', async () => {
    const { tools } = await grok.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['create_note', 'list_notes', 'read_note']);
    for (const t of tools) expect(t.description, t.name).toMatch(/untrusted/i);
    expect(tools.find((t) => t.name === 'read_note')!.description).toMatch(/\[photo\]/);
    expect(Object.keys((tools.find((t) => t.name === 'create_note')!.inputSchema as any).properties).sort()).toEqual(['images', 'markdown', 'request_id', 'tags', 'title']);
  });
});

describe('create_note', () => {
  it('creates an Inbox note with the bot’s name, in the Typewriter look; not on the home page', async () => {
    const r = await call(grok, 'create_note', { markdown: '# Report\n\nAll **good**.', tags: ['Daily', 'work'] });
    expect(r.isError, r.text).toBe(false);
    const id = idFrom(r.text);
    expect(r.text).toContain('title: Report');
    const n = (await alice.get(`/api/notes/${id}`)).json.note;
    expect(n).toMatchObject({ title: 'Report', tags: ['daily', 'work'], inbox: true, botName: 'Grok', readOnly: false });
    expect(JSON.stringify(n.content)).toContain('"fontFamily":"\\"Fira Code\\""');
    expect((await alice.get('/api/notes')).json.notes.map((x: any) => x.id)).not.toContain(id);
    expect((await alice.get('/api/search?q=good')).json.notes.map((x: any) => x.id)).not.toContain(id);
    expect((await alice.get('/api/notes?tag=daily')).json.notes).toEqual([]);
    expect((await alice.get('/api/tags')).json.tags.map((t: any) => t.name)).not.toContain('daily');
    const inbox = (await alice.get('/api/inbox')).json.notes;
    expect(inbox.map((x: any) => x.id)).toContain(id);
    expect(inbox.find((x: any) => x.id === id).botName).toBe('Grok');
  });

  it('places images by name, adds unmentioned ones at the end, drops unknown references', async () => {
    const r = await call(grok, 'create_note', {
      markdown: 'Look: ![the chart](chart.png)\n\nand ![gone](nowhere.png) here',
      images: [
        { name: 'chart.png', mime_type: 'image/png', data: b64(PNG_1PX) },
        { name: 'extra.gif', mime_type: 'image/jpeg', data: b64(GIF_1PX) }, // the stated type is ignored
      ],
    });
    expect(r.isError, r.text).toBe(false);
    const content = (await alice.get(`/api/notes/${idFrom(r.text)}`)).json.note.content;
    const types = content.content.map((b: any) => b.type);
    expect(types).toEqual(['paragraph', 'image', 'paragraph', 'image']);
    expect(JSON.stringify(content)).toContain('gone');
    expect(JSON.stringify(content)).not.toContain('nowhere');
    const [chart, extra] = content.content.filter((b: any) => b.type === 'image').map((b: any) => b.attrs.src);
    expect((await alice.get(chart)).rawPayload.equals(PNG_1PX)).toBe(true);
    const g = await alice.get(extra);
    expect(g.headers['content-type']).toBe('image/gif');
  });

  it.each([
    ['not an image at all', { name: 'x.png', mime_type: 'image/png', data: b64(Buffer.from('<html><script>alert(1)</script>')) }],
    ['an SVG', { name: 'x.svg', mime_type: 'image/svg+xml', data: b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')) }],
    ['broken base64', { name: 'x.png', mime_type: 'image/png', data: '%%%not base64%%%' }],
    ['a missing name', { mime_type: 'image/png', data: b64(PNG_1PX) }],
  ])('refuses the whole request for %s, creating nothing', async (_what, image) => {
    const notesBefore = (db().prepare('SELECT COUNT(*) AS n FROM notes').get() as any).n;
    const photosBefore = readdirSync(join(env.dataDir, 'users', aliceId, 'photos')).length;
    const r = await call(grok, 'create_note', { markdown: 'with image', images: [{ name: 'ok.png', mime_type: 'image/png', data: b64(PNG_1PX) }, image] });
    expect(r.isError).toBe(true);
    expect((db().prepare('SELECT COUNT(*) AS n FROM notes').get() as any).n).toBe(notesBefore);
    expect(readdirSync(join(env.dataDir, 'users', aliceId, 'photos')).length).toBe(photosBefore);
  });

  it('uses the title given, else the first heading, else the first line', async () => {
    const t = async (args: Record<string, unknown>) => noteRow(idFrom((await call(grok, 'create_note', args)).text)).title;
    expect(await t({ markdown: '# Heading\n\nbody', title: 'Given' })).toBe('Given');
    expect(await t({ markdown: 'intro\n\n## Second heading' })).toBe('Second heading');
    expect(await t({ markdown: 'just a line of text\n\nmore' })).toBe('just a line of text');
  });

  it('refuses the whole request if any tag is invalid, naming it', async () => {
    const before = (db().prepare('SELECT COUNT(*) AS n FROM notes').get() as any).n;
    const r = await call(grok, 'create_note', { markdown: 'x', tags: ['fine', 'not-ok'] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('not-ok');
    expect((db().prepare('SELECT COUNT(*) AS n FROM notes').get() as any).n).toBe(before);
  });

  it('the same request_id twice gives one note', async () => {
    const a = await call(grok, 'create_note', { markdown: 'once', request_id: 'req-123' });
    const b = await call(grok, 'create_note', { markdown: 'once', request_id: 'req-123' });
    expect(idFrom(a.text)).toBe(idFrom(b.text));
    expect((db().prepare("SELECT COUNT(*) AS n FROM notes WHERE body_text = 'once'").get() as any).n).toBe(1);
    // Another bot with the same request_id makes its own note.
    const other = await connectBot(base, (await alice.post('/api/bots', { name: 'Other' })).json.bot.token);
    expect(idFrom((await call(other, 'create_note', { markdown: 'once', request_id: 'req-123' })).text)).not.toBe(idFrom(a.text));
  });
});

describe('list_notes and read_note', () => {
  let ids: string[];
  beforeAll(async () => {
    ids = [];
    for (let i = 0; i < 23; i++) ids.push((await alice.post('/api/notes', { title: `paged ${i}`, content: doc(`pagedword ${i}`) })).json.note.id);
    await alice.post(`/api/notes/${ids[0]}/tags`, { tag: 'chosen' });
    await alice.del(`/api/notes/${ids[1]}`); // trashed: never visible
  });

  it('pages 20 at a time with a cursor, and never shows the trash', async () => {
    const all: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = await call(grok, 'list_notes', { query: 'pagedword', ...(cursor ? { cursor } : {}) });
      const found = [...r.text.matchAll(/\bid: ([A-Za-z0-9_-]{22})/g)].map((m) => m[1]);
      expect(found.length).toBeLessThanOrEqual(20);
      all.push(...found);
      cursor = /next cursor: (\S+)/.exec(r.text)?.[1];
      if (!cursor || cursor === 'none') break;
    }
    expect(all.length).toBe(22);
    expect(all).not.toContain(ids[1]);
    expect(new Set(all).size).toBe(22);
  });

  it('filters by tag, includes the Inbox, and wraps every title and preview as untrusted with its author', async () => {
    const r = await call(grok, 'list_notes', { tag: 'chosen' });
    expect([...r.text.matchAll(/\bid: ([A-Za-z0-9_-]{22})/g)].map((m) => m[1])).toEqual([ids[0]]);
    const all = (await call(grok, 'list_notes', { query: 'good' })).text;
    expect(all).toMatch(/in inbox: yes/);
    expect(all).toMatch(/author: Grok/);
    const block = /<<<UNTRUSTED NOTE DATA ([0-9a-f]+) .*author "Grok".*>>>\n([\s\S]*?)\n<<<END UNTRUSTED NOTE DATA \1>>>/.exec(all);
    expect(block?.[2]).toContain('title: Report');
    const mine = (await call(grok, 'list_notes', { tag: 'chosen' })).text;
    expect(mine).toMatch(/author: user/);
    expect(mine).toMatch(/<<<UNTRUSTED NOTE DATA [0-9a-f]+ .*author "user"/);
  });

  it('reads a note as Markdown inside an untrusted block, with title, tags and author; the trash is not readable', async () => {
    const r = await call(grok, 'read_note', { id: ids[0] });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/tags: chosen/);
    expect(r.text).toMatch(/author: user/);
    const m = /<<<UNTRUSTED NOTE DATA ([0-9a-f]+) [^\n]*>>>\n([\s\S]*)\n<<<END UNTRUSTED NOTE DATA \1>>>/.exec(r.text);
    expect(m?.[2]).toContain('title: paged 0');
    expect(m?.[2]).toContain('pagedword 0');
    const t = await call(grok, 'read_note', { id: ids[1] });
    expect(t.isError).toBe(true);
    expect(t.text).toMatch(/not found/i);
    expect((await call(grok, 'read_note', { id: 'nope' })).isError).toBe(true);
  });

  it('reads read-only notes like any other', async () => {
    await alice.post(`/api/notes/${ids[2]}/read-only`, {});
    expect((await call(grok, 'read_note', { id: ids[2] })).isError).toBe(false);
  });
});

describe('the Inbox', () => {
  it('Keep moves a note to the home page and keeps the bot’s name; trashing works', async () => {
    const id = idFrom((await call(grok, 'create_note', { markdown: 'keep me please' })).text);
    const count = (await alice.get('/api/inbox')).json.notes.length;
    const kept = await alice.post(`/api/notes/${id}/keep`, {});
    expect(kept.status).toBe(200);
    expect(kept.json.note).toMatchObject({ inbox: false, botName: 'Grok' });
    expect((await alice.get('/api/inbox')).json.notes.length).toBe(count - 1);
    expect((await alice.get('/api/notes')).json.notes.map((n: any) => n.id)).toContain(id);
    expect((await alice.get('/api/search?q=keep')).json.notes.map((n: any) => n.id)).toContain(id);
    const other = idFrom((await call(grok, 'create_note', { markdown: 'trash me' })).text);
    expect((await alice.del(`/api/notes/${other}`)).status).toBe(200);
    expect((await alice.get('/api/inbox')).json.notes.map((n: any) => n.id)).not.toContain(other);
    expect((await alice.get('/api/trash')).json.notes.map((n: any) => n.id)).toContain(other);
  });
});

describe('request size', () => {
  it('accepts 40 MB at /mcp and refuses 60 MB with a clear message; other routes keep their limits', async () => {
    const big = Buffer.concat([PNG_1PX.subarray(0, 16), Buffer.alloc(29 * 1024 * 1024, 7)]); // about 39 MB as base64
    const r = await call(grok, 'create_note', { markdown: '![big](big.png)', images: [{ name: 'big.png', mime_type: 'image/png', data: b64(big) }] });
    expect(r.isError, r.text).toBe(false);
    const huge = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_note', arguments: { markdown: 'x'.repeat(60 * 1024 * 1024) } } });
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: huge,
    });
    expect(res.status).toBe(413);
    expect(await res.text()).toMatch(/50 MB/);
    // The note routes still refuse bodies over their 32 MB limit.
    const note = await fetch(`${base}/api/notes`, { method: 'POST', headers: { cookie: alice.cookie!, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x', content: doc('y'.repeat(40 * 1024 * 1024)) }) });
    expect(note.status).toBe(413);
  });
});

describe('backups', () => {
  it('a personal backup records Inbox state and bot names; tokens are not in it and a restore leaves them alone', async () => {
    const inInbox = idFrom((await call(grok, 'create_note', { markdown: 'boxed note' })).text);
    const kept = idFrom((await call(grok, 'create_note', { markdown: 'kept note' })).text);
    await alice.post(`/api/notes/${kept}/keep`, {});
    const tokensBefore = (await alice.get('/api/bots')).json.bots;
    const { file } = await takeBackup(alice);
    const text = file.toString('latin1');
    for (const b of tokensBefore) expect(text).not.toContain(b.token);
    const data = openBackup(file).data;
    expect(data.notes.find((n: any) => n.title === 'boxed note')).toMatchObject({ inbox: true, botName: 'Grok' });
    expect(data.notes.find((n: any) => n.title === 'kept note')).toMatchObject({ inbox: false, botName: 'Grok' });
    void inInbox;
    expect((await restore(alice, file)).done.status).toBe(200);
    const inbox = (await alice.get('/api/inbox')).json.notes;
    expect(inbox.find((n: any) => n.title === 'boxed note')).toMatchObject({ inbox: true, botName: 'Grok' });
    expect((await alice.get('/api/notes')).json.notes.find((n: any) => n.title === 'kept note')).toMatchObject({ inbox: false, botName: 'Grok' });
    expect((await alice.get('/api/bots')).json.bots).toEqual(tokensBefore);
    expect((await call(grok, 'list_notes', {})).isError).toBe(false);
  });

  it('an older backup restores with every note outside the Inbox', async () => {
    const c = await newUser(env, 'olduser');
    await c.post('/api/notes', { title: 'old note', content: doc('x') });
    const b = openBackup((await takeBackup(c)).file);
    b.manifest.version = 2;
    for (const n of b.data.notes) {
      delete n.inbox;
      delete n.botName;
    }
    const { packBackup } = await import('../helpers/backup');
    expect((await restore(c, packBackup(b))).done.status).toBe(200);
    expect((await c.get('/api/inbox')).json.notes).toEqual([]);
    expect((await c.get('/api/notes')).json.notes.map((n: any) => [n.title, n.inbox, n.botName])).toEqual([['old note', false, null]]);
  });
});

void existsSync;
