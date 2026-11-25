// Type 2 (API integration): creating, saving, searching, isolating, locking, MCP reading, and backing up spreadsheets.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('spreadsheets API', () => {
  it('creates, updates, searches, isolates, and protects spreadsheets alongside regular notes', async () => {
    // Invalid kind on POST is refused.
    expect((await alice.post('/api/notes', { kind: 'evil', title: 'Bad' })).status).toBe(400);

    const created = await alice.post('/api/notes', { kind: 'sheet', title: 'Budget' });
    expect(created.status).toBe(201);
    const sheet = created.json.note;
    expect(sheet.kind).toBe('sheet');
    expect(sheet.content.type).toBe('sheet');

    // Cross-user isolation: Bob cannot read or patch Alice's spreadsheet (even with wrong content kind).
    expect((await bob.get(`/api/notes/${sheet.id}`)).status).toBe(404);
    expect((await bob.patch(`/api/notes/${sheet.id}`, { title: 'Stolen' })).status).toBe(404);
    expect((await bob.patch(`/api/notes/${sheet.id}`, { content: doc('wrong') })).status).toBe(404);
    expect((await bob.patch(`/api/notes/${sheet.id}`, { content: emptySheet() })).status).toBe(404);

    // Reject mismatched content kinds.
    expect((await alice.patch(`/api/notes/${sheet.id}`, { content: doc('wrong kind') })).status).toBe(400);
    const textNote = (await alice.post('/api/notes', { title: 'Doc' })).json.note;
    expect((await alice.patch(`/api/notes/${textNote.id}`, { content: emptySheet() })).status).toBe(400);

    // Save cell data + formula (with ?summary=1 omitting content) and verify preview & full-text search.
    const next = emptySheet();
    (next.workbook.sheets as any)['sheet-1'].cellData = {
      '0': { '0': { v: 'Groceries' }, '1': { v: 125 } },
      '1': { '0': { v: 'Rent' }, '1': { v: 1500 } },
    };
    const patched = await alice.patch(`/api/notes/${sheet.id}?summary=1`, { content: next });
    expect(patched.status).toBe(200);
    expect(patched.json.note.preview).toContain('Groceries 125');
    expect(patched.json.note.content).toBeUndefined();

    const found = await alice.get('/api/search?q=Groceries');
    expect(found.status).toBe(200);
    expect(found.json.notes.map((n: any) => n.id)).toContain(sheet.id);
    expect(found.json.notes.find((n: any) => n.id === sheet.id).kind).toBe('sheet');

    // A populated untitled spreadsheet is NOT counted as empty; a blank untitled one is.
    const blank = (await alice.post('/api/notes', { kind: 'sheet' })).json.note;
    const populatedUntitled = (await alice.post('/api/notes', { kind: 'sheet', content: next })).json.note;
    const trashedEmpty = await alice.del('/api/empty-notes');
    expect(trashedEmpty.status).toBe(200);
    expect((await alice.get(`/api/notes/${blank.id}`)).json.note.deletedAt).not.toBeNull();
    expect((await alice.get(`/api/notes/${populatedUntitled.id}`)).json.note.deletedAt).toBeNull();

    // Trashed sheet refuses content edits with 409.
    expect((await alice.patch(`/api/notes/${blank.id}`, { content: next })).status).toBe(409);

    // Read-only lock refuses both title and content edits with 403.
    expect((await alice.post(`/api/notes/${sheet.id}/read-only`, {})).status).toBe(200);
    expect((await alice.patch(`/api/notes/${sheet.id}`, { title: 'Changed' })).status).toBe(403);
    expect((await alice.patch(`/api/notes/${sheet.id}`, { content: next })).status).toBe(403);
  });

  it('exposes spreadsheets through MCP list_notes and read_note with kind and preserved columns', async () => {
    const carol = await newUser(env, 'mcp_sheet_user');
    const wb = emptySheet();
    (wb.workbook.sheets as any)['sheet-1'].cellData = {
      '0': { '0': { v: 'Item' }, '2': { v: 'Price' } },
      '1': { '0': { v: 'Coffee' }, '2': { v: 5 } },
    };
    const sheet = (await carol.post('/api/notes', { kind: 'sheet', title: 'Expenses', content: wb })).json.note;
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
    expect(listText).toContain(`id: ${sheet.id}`);
    expect(listText).toContain('kind: sheet');

    const read = await mcp('tools/call', { name: 'read_note', arguments: { id: sheet.id } });
    const readText = read.result.content[0].text as string;
    expect(readText).toContain('kind: sheet');
    expect(readText).toContain('## Sheet1');
    expect(readText).toContain('1\tItem\t\tPrice');
    expect(readText).toContain('2\tCoffee\t\t5');
  });

  it('round-trips spreadsheets through personal backup and handles format-5 and invalid backups', async () => {
    const u = await newUser(env, 'sheet_bak_user');
    const wb = emptySheet();
    (wb.workbook.sheets as any)['sheet-1'].cellData = { '0': { '0': { v: 'BackupCell' }, '1': { v: 99, f: '=90+9' } } };
    const created = await u.post('/api/notes', { kind: 'sheet', title: 'My Sheet', content: wb });
    expect(created.status).toBe(201);
    const regularDoc = (await u.post('/api/notes', { title: 'Regular Doc', content: doc('hello') })).json.note;

    const { file } = await takeBackup(u);

    // Trash the sheet, then restore from v6 backup.
    expect((await u.del(`/api/notes/${created.json.note.id}`)).status).toBe(200);
    const { staged, done } = await restore(u, file);
    expect(staged.status, staged.body).toBe(201);
    expect(done.status, done.body).toBe(200);

    const listed = await u.get('/api/notes');
    const restoredSheet = listed.json.notes.find((n: any) => n.title === 'My Sheet');
    expect(restoredSheet).toBeTruthy();
    expect(restoredSheet.kind).toBe('sheet');
    expect(restoredSheet.preview).toContain('BackupCell 99');
    const full = await u.get(`/api/notes/${restoredSheet.id}`);
    expect(full.json.note.content.type).toBe('sheet');
    expect(full.json.note.content.workbook.sheets['sheet-1'].cellData['0']['1'].f).toBe('=90+9');

    // Format-5 backup (without kind on notes) restores cleanly with kind: 'doc'.
    const v5 = openBackup(file);
    v5.manifest.version = 5;
    v5.data.notes = v5.data.notes.filter((n: any) => n.title === 'Regular Doc').map(({ kind: _k, ...rest }: any) => rest);
    v5.manifest.counts.notes = v5.data.notes.length;
    const v5Res = await restore(u, packBackup(v5));
    expect(v5Res.staged.status, v5Res.staged.body).toBe(201);
    expect(v5Res.done.status, v5Res.done.body).toBe(200);
    const afterV5 = (await u.get('/api/notes')).json.notes;
    expect(afterV5.find((n: any) => n.title === 'Regular Doc').kind).toBe('doc');
    expect(regularDoc.kind).toBe('doc');

    // Crafted backup with invalid kind is refused at stage time.
    const badKind = openBackup(file);
    badKind.data.notes[0].kind = 'evil';
    expect((await stage(u, packBackup(badKind))).status).toBe(400);

    // Crafted backup with kind/content mismatch is refused at stage time.
    const mismatch = openBackup(file);
    mismatch.data.notes[0].kind = 'sheet';
    mismatch.data.notes[0].content = doc('not a sheet');
    expect((await stage(u, packBackup(mismatch))).status).toBe(400);
  });
});
