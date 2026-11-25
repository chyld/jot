// Type 2 (API integration): creating, saving, searching, isolating, locking, MCP reading, and backing up whiteboards.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyBoard } from '../../src/server/board';
import { emptySheet } from '../../src/server/sheet';
import { openBackup, packBackup, restore, stage, takeBackup } from '../helpers/backup';
import { doc, makeTestEnv, newUser, type Client, type TestEnv } from '../helpers/setup';

let env: TestEnv;
let alice: Client;
let bob: Client;
beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
  bob = await newUser(env, 'bob');
});
afterAll(() => env.close());

describe('whiteboards API', () => {
  it('creates, updates, searches, isolates, and protects whiteboards alongside docs and sheets', async () => {
    expect((await alice.post('/api/notes', { kind: 'evil', title: 'Bad' })).status).toBe(400);

    const created = await alice.post('/api/notes', { kind: 'board', title: 'System Diagram' });
    expect(created.status).toBe(201);
    const board = created.json.note;
    expect(board.kind).toBe('board');
    expect(board.content.type).toBe('board');

    // Cross-user isolation: Bob cannot read or patch Alice's whiteboard.
    expect((await bob.get(`/api/notes/${board.id}`)).status).toBe(404);
    expect((await bob.patch(`/api/notes/${board.id}`, { title: 'Stolen' })).status).toBe(404);
    expect((await bob.patch(`/api/notes/${board.id}`, { content: emptyBoard() })).status).toBe(404);

    // Reject mismatched content kinds.
    expect((await alice.patch(`/api/notes/${board.id}`, { content: doc('wrong kind') })).status).toBe(400);
    expect((await alice.patch(`/api/notes/${board.id}`, { content: emptySheet() })).status).toBe(400);
    const textNote = (await alice.post('/api/notes', { title: 'Doc' })).json.note;
    expect((await alice.patch(`/api/notes/${textNote.id}`, { content: emptyBoard() })).status).toBe(400);

    // Save elements (with ?summary=1 omitting content) and verify preview & full-text search.
    const next = emptyBoard();
    next.elements = [
      { id: 'r1', type: 'rectangle', x: 10, y: 10, width: 120, height: 60 },
      { id: 't1', type: 'text', x: 20, y: 20, text: 'Gateway Service', originalText: 'Gateway Service', containerId: 'r1' },
      { id: 'f1', type: 'frame', x: 0, y: 0, width: 400, height: 300, name: 'Backend Cluster' },
    ];
    const patched = await alice.patch(`/api/notes/${board.id}?summary=1`, { content: next });
    expect(patched.status).toBe(200);
    expect(patched.json.note.preview).toContain('Backend Cluster');
    expect(patched.json.note.preview).toContain('Gateway Service');
    expect(patched.json.note.content).toBeUndefined();

    const found = await alice.get('/api/search?q=Gateway');
    expect(found.status).toBe(200);
    expect(found.json.notes.map((n: any) => n.id)).toContain(board.id);
    expect(found.json.notes.find((n: any) => n.id === board.id).kind).toBe('board');

    // A populated untitled board is NOT counted as empty; a blank untitled one is.
    const blank = (await alice.post('/api/notes', { kind: 'board' })).json.note;
    const populatedUntitled = (await alice.post('/api/notes', { kind: 'board', content: next })).json.note;
    const trashedEmpty = await alice.del('/api/empty-notes');
    expect(trashedEmpty.status).toBe(200);
    expect((await alice.get(`/api/notes/${blank.id}`)).json.note.deletedAt).not.toBeNull();
    expect((await alice.get(`/api/notes/${populatedUntitled.id}`)).json.note.deletedAt).toBeNull();

    // Trashed board refuses content edits with 409.
    expect((await alice.patch(`/api/notes/${blank.id}`, { content: next })).status).toBe(409);

    // Read-only lock refuses both title and content edits with 403.
    expect((await alice.post(`/api/notes/${board.id}/read-only`, {})).status).toBe(200);
    expect((await alice.patch(`/api/notes/${board.id}`, { title: 'Changed' })).status).toBe(403);
    expect((await alice.patch(`/api/notes/${board.id}`, { content: next })).status).toBe(403);
  });

  it('exposes whiteboards through MCP list_notes and read_note with text outline', async () => {
    const carol = await newUser(env, 'mcp_board_user');
    const scene = emptyBoard();
    scene.elements = [
      { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 },
      { id: 't1', type: 'text', x: 10, y: 10, text: 'Browser', originalText: 'Browser', containerId: 'r1' },
      { id: 'r2', type: 'rectangle', x: 200, y: 0, width: 100, height: 50 },
      { id: 't2', type: 'text', x: 210, y: 10, text: 'Fastify', originalText: 'Fastify', containerId: 'r2' },
      { id: 'a1', type: 'arrow', x: 100, y: 25, startBinding: { elementId: 'r1' }, endBinding: { elementId: 'r2' } },
    ];
    const board = (await carol.post('/api/notes', { kind: 'board', title: 'Flow', content: scene })).json.note;
    const bot = (await carol.post('/api/bots', { name: 'Helper' })).json.bot;

    const mcp = async (method: string, params: Record<string, unknown>) => {
      const res = await env.app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          authorization: `Bearer ${bot.token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        payload: { jsonrpc: '2.0', id: 1, method, params },
      });
      return JSON.parse(res.body);
    };

    const listed = await mcp('tools/call', { name: 'list_notes', arguments: {} });
    const listText = listed.result.content[0].text as string;
    expect(listText).toContain(`id: ${board.id}`);
    expect(listText).toContain('kind: board');

    const read = await mcp('tools/call', { name: 'read_note', arguments: { id: board.id } });
    const readText = read.result.content[0].text as string;
    expect(readText).toContain('kind: board');
    expect(readText).toContain('- [rectangle] Browser');
    expect(readText).toContain('- [rectangle] Fastify');
    expect(readText).toContain('- Browser --> Fastify');
  });

  it('round-trips whiteboards through personal backup v7 and handles v6/invalid backups', async () => {
    const u = await newUser(env, 'board_bak_user');
    const scene = emptyBoard();
    scene.elements = [
      { id: 'r1', type: 'rectangle', x: 10, y: 20, width: 120, height: 60 },
      { id: 't1', type: 'text', x: 15, y: 30, text: 'BackupBox', originalText: 'BackupBox', containerId: 'r1' },
    ];
    scene.appState = { viewBackgroundColor: '#fef9c3' };
    const created = await u.post('/api/notes', { kind: 'board', title: 'My Board', content: scene });
    expect(created.status).toBe(201);
    const regularDoc = (await u.post('/api/notes', { title: 'Regular Doc', content: doc('hello') })).json.note;

    const { file } = await takeBackup(u);

    // Trash the board, then restore from v7 backup.
    expect((await u.del(`/api/notes/${created.json.note.id}`)).status).toBe(200);
    const { staged, done } = await restore(u, file);
    expect(staged.status, staged.body).toBe(201);
    expect(done.status, done.body).toBe(200);

    const listed = await u.get('/api/notes');
    const restoredBoard = listed.json.notes.find((n: any) => n.title === 'My Board');
    expect(restoredBoard).toBeTruthy();
    expect(restoredBoard.kind).toBe('board');
    expect(restoredBoard.preview).toContain('BackupBox');
    const full = await u.get(`/api/notes/${restoredBoard.id}`);
    expect(full.json.note.content.type).toBe('board');
    expect(full.json.note.content.appState.viewBackgroundColor).toBe('#fef9c3');
    expect(full.json.note.content.elements).toHaveLength(2);

    // Format-6 backup (docs + sheets, no boards) still restores cleanly.
    const v6 = openBackup(file);
    v6.manifest.version = 6;
    v6.data.notes = v6.data.notes.filter((n: any) => n.title === 'Regular Doc');
    v6.manifest.counts.notes = v6.data.notes.length;
    const v6Res = await restore(u, packBackup(v6));
    expect(v6Res.staged.status, v6Res.staged.body).toBe(201);
    expect(v6Res.done.status, v6Res.done.body).toBe(200);
    expect(regularDoc.kind).toBe('doc');

    // Crafted backup with kind/content mismatch is refused at stage time.
    const mismatch = openBackup(file);
    mismatch.data.notes[0].kind = 'board';
    mismatch.data.notes[0].content = doc('not a board');
    expect((await stage(u, packBackup(mismatch))).status).toBe(400);
  });
});
