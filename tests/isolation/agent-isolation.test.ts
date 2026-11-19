// Type 1 (per-user isolation) for agent notes: a token reaches only its own user's notes;
// a revoked or unknown token is refused; a token does nothing at the web app's routes;
// a login cookie does nothing at /mcp; tokens are private to their user.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { doc, makeTestEnv, newUser, type Client, type TestEnv } from '../helpers/setup';
import { call, connectBot, idFrom, listen } from '../helpers/mcp';

let env: TestEnv;
let base: string;
let alice: Client;
let bob: Client;
let aliceBot: McpClient;
let aliceToken: any;
let bobNote: any;

const mcpPost = (headers: Record<string, string>) =>
  fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });

beforeAll(async () => {
  env = await makeTestEnv();
  base = await listen(env);
  alice = await newUser(env, 'alice');
  bob = await newUser(env, 'bob');
  aliceToken = (await alice.post('/api/bots', { name: 'Helper' })).json.bot;
  aliceBot = await connectBot(base, aliceToken.token);
  await alice.post('/api/notes', { title: 'alice note', content: doc('alicesecret') });
  bobNote = (await bob.post('/api/notes', { title: 'bob note', content: doc('bobsecret') })).json.note;
  await bob.post(`/api/notes/${bobNote.id}/tags`, { tag: 'bobtag' });
});
afterAll(async () => {
  await aliceBot?.close();
  await env.close();
});

describe('a token reaches only its own user', () => {
  it('lists and searches only that user’s notes', async () => {
    const all = (await call(aliceBot, 'list_notes', {})).text;
    expect(all).toContain('alice note');
    expect(all).not.toContain('bob');
    expect((await call(aliceBot, 'list_notes', { query: 'bobsecret' })).text).not.toContain(bobNote.id);
    expect((await call(aliceBot, 'list_notes', { tag: 'bobtag' })).text).not.toContain(bobNote.id);
  });

  it('cannot read another user’s note', async () => {
    const r = await call(aliceBot, 'read_note', { id: bobNote.id });
    expect(r.isError).toBe(true);
    expect(r.text).not.toContain('bobsecret');
  });

  it('creates notes only in its own user’s Inbox', async () => {
    const id = idFrom((await call(aliceBot, 'create_note', { markdown: 'from the helper' })).text);
    expect((await alice.get('/api/inbox')).json.notes.map((n: any) => n.id)).toContain(id);
    expect((await bob.get('/api/inbox')).json.notes).toEqual([]);
    expect((await bob.get(`/api/notes/${id}`)).status).toBe(404);
  });
});

describe('only bearer tokens at /mcp, never at the web app', () => {
  it('an unknown or missing token is refused', async () => {
    expect((await mcpPost({})).status).toBe(401);
    expect((await mcpPost({ authorization: 'Bearer jot_' + 'x'.repeat(43) })).status).toBe(401);
    expect((await mcpPost({ authorization: `Basic ${Buffer.from('alice:pw').toString('base64')}` })).status).toBe(401);
    expect((await mcpPost({ authorization: `Bearer ${aliceToken.token}` })).status).toBe(200);
  });

  it('a login cookie does nothing at /mcp', async () => {
    const r = await mcpPost({ cookie: alice.cookie! });
    expect(r.status).toBe(401);
  });

  it('a token does nothing at the web app’s routes', async () => {
    for (const path of ['/api/me', '/api/notes', '/api/inbox', '/api/bots', '/api/backup']) {
      const r = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${aliceToken.token}` } });
      expect(r.status, path).toBe(401);
    }
    const create = await fetch(`${base}/api/notes`, { method: 'POST', headers: { authorization: `Bearer ${aliceToken.token}`, 'content-type': 'application/json' }, body: '{}' });
    expect(create.status).toBe(401);
  });

  it('a revoked token is refused', async () => {
    const t = (await bob.post('/api/bots', { name: 'Short lived' })).json.bot;
    expect((await mcpPost({ authorization: `Bearer ${t.token}` })).status).toBe(200);
    await bob.del(`/api/bots/${t.id}`);
    expect((await mcpPost({ authorization: `Bearer ${t.token}` })).status).toBe(401);
  });
});

describe('tokens belong to their user', () => {
  it('B cannot see or revoke A’s tokens', async () => {
    expect((await bob.get('/api/bots')).json.bots.map((b: any) => b.name)).not.toContain('Helper');
    expect((await bob.del(`/api/bots/${aliceToken.id}`)).status).toBe(404);
    expect((await alice.get('/api/bots')).json.bots.map((b: any) => b.id)).toContain(aliceToken.id);
  });

  it('B cannot keep A’s Inbox note', async () => {
    const id = idFrom((await call(aliceBot, 'create_note', { markdown: 'for alice only' })).text);
    expect((await bob.post(`/api/notes/${id}/keep`, {})).status).toBe(404);
    expect((await alice.get('/api/inbox')).json.notes.map((n: any) => n.id)).toContain(id);
  });
});
