// Type 2 (API integration): creating, saving, searching, locking, and backing up spreadsheets.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptySheet } from '../../src/server/sheet';
import { restore, takeBackup } from '../helpers/backup';
import { doc, makeTestEnv, newUser, type Client, type TestEnv } from '../helpers/setup';

let env: TestEnv;
let alice: Client;
beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
});
afterAll(() => env.close());

describe('spreadsheets API', () => {
  it('creates, updates, searches, and protects spreadsheets alongside regular notes', async () => {
    const created = await alice.post('/api/notes', { kind: 'sheet', title: 'Budget' });
    expect(created.status).toBe(201);
    const sheet = created.json.note;
    expect(sheet.kind).toBe('sheet');
    expect(sheet.content.type).toBe('sheet');

    // Reject mismatched content kinds.
    expect((await alice.patch(`/api/notes/${sheet.id}`, { content: doc('wrong kind') })).status).toBe(400);
    const textNote = (await alice.post('/api/notes', { title: 'Doc' })).json.note;
    expect((await alice.patch(`/api/notes/${textNote.id}`, { content: emptySheet() })).status).toBe(400);

    // Save cell data + formula and verify preview & full-text search.
    const next = emptySheet();
    (next.workbook.sheets as any)['sheet-1'].cellData = {
      '0': { '0': { v: 'Groceries' }, '1': { v: 125 } },
      '1': { '0': { v: 'Rent' }, '1': { v: 1500 } },
    };
    const patched = await alice.patch(`/api/notes/${sheet.id}`, { content: next });
    expect(patched.status).toBe(200);
    expect(patched.json.note.preview).toContain('Groceries 125');

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

    // Read-only lock refuses further edits.
    expect((await alice.post(`/api/notes/${sheet.id}/read-only`, {})).status).toBe(200);
    expect((await alice.patch(`/api/notes/${sheet.id}`, { title: 'Changed' })).status).toBe(403);
  });

  it('round-trips spreadsheets through personal backup and restore', async () => {
    const bob = await newUser(env, 'bob');
    const wb = emptySheet();
    (wb.workbook.sheets as any)['sheet-1'].cellData = { '0': { '0': { v: 'BackupCell' }, '1': { v: 99, f: '=90+9' } } };
    const created = await bob.post('/api/notes', { kind: 'sheet', title: 'My Sheet', content: wb });
    expect(created.status).toBe(201);

    const { file } = await takeBackup(bob);

    // Trash the sheet, then restore from backup.
    expect((await bob.del(`/api/notes/${created.json.note.id}`)).status).toBe(200);
    const { staged, done } = await restore(bob, file);
    expect(staged.status, staged.body).toBe(201);
    expect(done.status, done.body).toBe(200);

    const listed = await bob.get('/api/notes');
    const restoredSheet = listed.json.notes.find((n: any) => n.title === 'My Sheet');
    expect(restoredSheet).toBeTruthy();
    expect(restoredSheet.kind).toBe('sheet');
    expect(restoredSheet.preview).toContain('BackupCell 99');
    const full = await bob.get(`/api/notes/${restoredSheet.id}`);
    expect(full.json.note.content.type).toBe('sheet');
    expect(full.json.note.content.workbook.sheets['sheet-1'].cellData['0']['1'].f).toBe('=90+9');
  });
});
