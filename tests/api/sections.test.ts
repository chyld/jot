// Type 2 (API integration): sections (sections-spec.md). Create, rename, recolour; the ID
// rules; deleting a section (its notes and trash move to Default). The home list, tag chips, search, New, "Delete N empty" and the trash
// each work on the current section only. Moving a note; Keep and bot notes; backups.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { doc, makeTestEnv, newUser, type Client, type TestEnv } from '../helpers/setup';
import { call, connectBot, idFrom, listen } from '../helpers/mcp';
import { openBackup, packBackup, restore, takeBackup } from '../helpers/backup';

let env: TestEnv;
let base: string;
const db = () => (env.app as any).jot.db;
const noteRow = (id: string) => db().prepare('SELECT * FROM notes WHERE id = ?').get(id) as any;

beforeAll(async () => {
  env = await makeTestEnv();
  base = await listen(env);
});
afterAll(() => env.close());

const titles = (r: any) => r.json.notes.map((n: any) => n.title).sort();
async function note(c: Client, section: string, title: string, text = 'words') {
  const r = await c.post(`/api/notes?section=${section}`, { title, content: doc(text) });
  expect(r.status, r.body).toBe(201);
  return r.json.note;
}

describe('sections', () => {
  let c: Client;
  beforeAll(async () => {
    c = await newUser(env, 'sec_rules');
  });

  it('every account starts with a Default section (Olive) holding its notes', async () => {
    const r = await c.get('/api/sections');
    expect(r.json.sections).toEqual([{ id: 'default', name: 'Default', colour: 'olive', noteCount: 0, trashCount: 0 }]);
    const n = await c.post('/api/notes', {});
    expect(n.json.note.section).toBe('default');
  });

  it('creates sections, listed Default first and then in the order they were made', async () => {
    const a = await c.post('/api/sections', { id: 'work', name: "Bob's Work", colour: 'blue' });
    expect(a.status, a.body).toBe(201);
    expect(a.json.section).toEqual({ id: 'work', name: "Bob's Work", colour: 'blue', noteCount: 0, trashCount: 0 });
    expect((await c.post('/api/sections', { id: 'Recipe', name: '  Recipes  ', colour: 'amber' })).json.section).toMatchObject({ id: 'recipe', name: 'Recipes' });
    expect((await c.post('/api/sections', { id: 'aaa', name: 'First by name', colour: 'teal' })).status).toBe(201);
    expect((await c.get('/api/sections')).json.sections.map((s: any) => s.id)).toEqual(['default', 'work', 'recipe', 'aaa']);
  });

  it('applies the ID rules (tag rules), the name rules and the six colours', async () => {
    for (const id of ['', 'two words', 'demo1', 'with-dash', 'café', 'a'.repeat(31), 42, null]) {
      const r = await c.post('/api/sections', { id, name: 'X', colour: 'olive' });
      expect(r.status, String(id)).toBe(400);
      expect(r.json.error).toMatch(/ID/);
    }
    expect((await c.post('/api/sections', { id: 'a'.repeat(30), name: 'Long id', colour: 'olive' })).status).toBe(201);
    for (const name of ['', '   ', 'n'.repeat(61), 7]) expect((await c.post('/api/sections', { id: 'named', name, colour: 'olive' })).status).toBe(400);
    expect((await c.post('/api/sections', { id: 'named', name: 'n'.repeat(60), colour: 'olive' })).status).toBe(201);
    for (const colour of ['pink', 'rose', 'Olive', '#ff0000', undefined]) expect((await c.post('/api/sections', { id: 'coloured', name: 'C', colour })).status).toBe(400);
  });

  it('refuses an ID already used, whatever the name', async () => {
    const r = await c.post('/api/sections', { id: 'work', name: 'Other', colour: 'slate' });
    expect(r.status).toBe(409);
    expect(r.json.error).toMatch(/already/);
    expect((await c.post('/api/sections', { id: 'DEFAULT', name: 'Again', colour: 'slate' })).status).toBe(409);
  });

  it('renames and recolours; the ID never changes', async () => {
    const r = await c.patch('/api/sections/work', { name: 'Work things', colour: 'violet', id: 'job' });
    expect(r.status, r.body).toBe(200);
    expect(r.json.section).toMatchObject({ id: 'work', name: 'Work things', colour: 'violet' });
    expect((await c.patch('/api/sections/work', { colour: 'teal' })).json.section).toMatchObject({ name: 'Work things', colour: 'teal' });
    expect((await c.patch('/api/sections/default', { name: 'Home' })).json.section).toMatchObject({ id: 'default', name: 'Home', colour: 'olive' });
    expect((await c.patch('/api/sections/work', { name: '' })).status).toBe(400);
    expect((await c.patch('/api/sections/work', { colour: 'pink' })).status).toBe(400);
    expect((await c.patch('/api/sections/nosuch', { name: 'X' })).status).toBe(404);
    const ids = (await c.get('/api/sections')).json.sections.map((s: any) => s.id);
    expect(ids).toContain('work');
    expect(ids).not.toContain('job');
  });

  it('a section that does not exist is refused wherever one is named', async () => {
    for (const url of ['/api/notes?section=nosuch', '/api/search?q=x&section=nosuch', '/api/trash?section=nosuch', '/api/empty-notes?section=nosuch', '/api/tags?section=nosuch']) {
      expect((await c.get(url)).status, url).toBe(404);
    }
    expect((await c.post('/api/notes?section=nosuch', {})).status).toBe(404);
  });
});

describe('deleting a section', () => {
  let c: Client;
  beforeAll(async () => {
    c = await newUser(env, 'sec_delete');
    await c.post('/api/sections', { id: 'work', name: "Bob's Work", colour: 'blue' });
    await c.post('/api/sections', { id: 'other', name: 'Other', colour: 'teal' });
  });

  it('moves every note to Default, trashed ones to Default’s trash, changing only their section', async () => {
    const live = await note(c, 'work', 'Live one', 'zebraword');
    await c.post(`/api/notes/${live.id}/tags`, { tag: 'office' });
    const binned = await note(c, 'work', 'Binned one');
    await c.del(`/api/notes/${binned.id}`);
    const locked = await note(c, 'work', 'Locked one');
    await c.post(`/api/notes/${locked.id}/read-only`, {});
    const inbox = await note(c, 'work', 'Inbox one');
    db().prepare('UPDATE notes SET inbox = 1, bot_name = ? WHERE id = ?').run('Grok', inbox.id);
    const elsewhere = await note(c, 'other', 'Other one');
    await note(c, 'default', 'Already default');
    const ids = [live.id, binned.id, locked.id, inbox.id];
    const before = ids.map(noteRow);

    const r = await c.del('/api/sections/work');
    expect(r.status, r.body).toBe(200);
    expect(r.json).toEqual({ moved: 4 });

    ids.map(noteRow).forEach((row, i) => expect(row).toEqual({ ...before[i], section_id: 'default' }));
    expect(noteRow(elsewhere.id).section_id).toBe('other');
    expect((await c.get('/api/sections')).json.sections.map((s: any) => [s.id, s.noteCount, s.trashCount])).toEqual([
      ['default', 3, 1],
      ['other', 1, 0],
    ]);
    expect(titles(await c.get('/api/notes?section=default'))).toEqual(['Already default', 'Live one', 'Locked one']);
    expect((await c.get('/api/trash?section=default')).json.notes.map((n: any) => n.title)).toEqual(['Binned one']);
    expect((await c.get('/api/inbox')).json.notes.map((n: any) => n.id)).toEqual([inbox.id]);
    expect((await c.get('/api/notes?section=default&tag=office')).json.notes.map((n: any) => n.id)).toEqual([live.id]);
    expect(titles(await c.get('/api/search?q=zebraword&section=default'))).toEqual(['Live one']);
    // The section is gone everywhere.
    expect((await c.get('/api/notes?section=work')).status).toBe(404);
    expect(db().prepare("SELECT COUNT(*) AS n FROM sections WHERE user_id = (SELECT user_id FROM notes WHERE id = ?) AND id = 'work'").get(live.id).n).toBe(0);
    // Its ID can be used again for a new, empty section.
    expect((await c.post('/api/sections', { id: 'work', name: 'Work again', colour: 'olive' })).json.section).toMatchObject({ noteCount: 0, trashCount: 0 });
  });

  it('deletes an empty section', async () => {
    await c.post('/api/sections', { id: 'empty', name: 'Empty', colour: 'slate' });
    expect((await c.del('/api/sections/empty')).json).toEqual({ moved: 0 });
    expect((await c.get('/api/sections')).json.sections.map((s: any) => s.id)).not.toContain('empty');
  });

  it('refuses to delete Default, with a clear error', async () => {
    const r = await c.del('/api/sections/default');
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/Default section cannot be deleted/);
    expect((await c.get('/api/sections')).json.sections[0].id).toBe('default');
  });

  it('an unknown section is 404', async () => {
    expect((await c.del('/api/sections/nosuch')).status).toBe(404);
    expect((await c.del('/api/sections/Not-An-Id')).status).toBe(404);
  });
});

describe('scoping', () => {
  let c: Client;
  let work: any;
  let recipe: any;
  beforeAll(async () => {
    c = await newUser(env, 'sec_scope');
    await c.post('/api/sections', { id: 'work', name: 'Work', colour: 'blue' });
    await c.post('/api/sections', { id: 'recipe', name: 'Recipes', colour: 'amber' });
    work = await note(c, 'work', 'Quarterly plan', 'budget meeting');
    await c.post(`/api/notes/${work.id}/tags`, { tag: 'office' });
    recipe = await note(c, 'recipe', 'Soup', 'budget soup');
    await c.post(`/api/notes/${recipe.id}/tags`, { tag: 'dinner' });
    await note(c, 'default', 'Default note', 'budget');
  });

  it('New creates the note in the current section', async () => {
    expect(work.section).toBe('work');
    expect(noteRow(work.id).section_id).toBe('work');
    expect(recipe.section).toBe('recipe');
  });

  it('the home list, its tag chips and search show only the current section', async () => {
    expect(titles(await c.get('/api/notes?section=work'))).toEqual(['Quarterly plan']);
    expect(titles(await c.get('/api/notes?section=recipe'))).toEqual(['Soup']);
    expect(titles(await c.get('/api/notes'))).toEqual(['Default note']); // no section: Default
    expect(titles(await c.get('/api/notes?section=recipe&tag=office'))).toEqual([]);
    expect((await c.get('/api/tags?section=work')).json.tags).toEqual([{ name: 'office', count: 1 }]);
    expect((await c.get('/api/tags?section=recipe')).json.tags).toEqual([{ name: 'dinner', count: 1 }]);
    expect(titles(await c.get('/api/search?q=budget&section=work'))).toEqual(['Quarterly plan']);
    expect(titles(await c.get('/api/search?q=budget&section=recipe'))).toEqual(['Soup']);
    expect(titles(await c.get('/api/search?q=%23office&section=recipe'))).toEqual([]);
  });

  it('the Tags page still lists every section’s tags', async () => {
    expect((await c.get('/api/tags')).json.tags.map((t: any) => t.name)).toEqual(['dinner', 'office']);
  });

  it('"Delete N empty" counts and trashes the current section’s empty notes only', async () => {
    await c.post('/api/notes?section=work', {});
    await c.post('/api/notes?section=work', {});
    const otherEmpty = (await c.post('/api/notes?section=recipe', {})).json.note;
    expect((await c.get('/api/empty-notes?section=work')).json.count).toBe(2);
    expect((await c.get('/api/empty-notes?section=recipe')).json.count).toBe(1);
    expect((await c.del('/api/empty-notes?section=work')).json.trashed).toBe(2);
    expect((await c.get('/api/empty-notes?section=recipe')).json.count).toBe(1);
    expect(noteRow(otherEmpty.id).deleted_at).toBeNull();
    await c.del(`/api/notes/${otherEmpty.id}`);
  });

  it('each section has its own trash, and Empty trash empties only that one', async () => {
    const w = await note(c, 'work', 'Old work');
    const r = await note(c, 'recipe', 'Old recipe');
    await c.del(`/api/notes/${w.id}`);
    await c.del(`/api/notes/${r.id}`);
    const workTrash = titles(await c.get('/api/trash?section=work'));
    expect(workTrash).toContain('Old work');
    expect(workTrash).not.toContain('Old recipe');
    expect(titles(await c.get('/api/trash?section=recipe'))).toContain('Old recipe');
    expect(titles(await c.get('/api/trash'))).toEqual([]); // Default's trash is empty
    // The section list gives each section's trash count beside its note count.
    const trashCount = async () => Object.fromEntries(((await c.get('/api/sections')).json.sections as any[]).map((s) => [s.id, s.trashCount]));
    const recipeTrash = titles(await c.get('/api/trash?section=recipe')).length;
    expect(await trashCount()).toMatchObject({ default: 0, work: 3, recipe: recipeTrash });
    // Restore puts a note back in its own section.
    expect((await c.post(`/api/trash/${r.id}/restore`, {})).json.note.section).toBe('recipe');
    await c.del(`/api/notes/${r.id}`);
    expect((await c.del('/api/trash?section=work')).json.deleted).toBe(3); // Old work and the two empty notes
    expect(titles(await c.get('/api/trash?section=work'))).toEqual([]);
    expect(titles(await c.get('/api/trash?section=recipe'))).toContain('Old recipe');
    expect(await trashCount()).toMatchObject({ default: 0, work: 0, recipe: recipeTrash });
    expect(noteRow(r.id)).toBeTruthy();
  });
});

describe('moving a note', () => {
  let c: Client;
  beforeAll(async () => {
    c = await newUser(env, 'sec_move');
    await c.post('/api/sections', { id: 'work', name: 'Work', colour: 'blue' });
  });

  it('changes only the note’s section', async () => {
    const n = await note(c, 'default', 'Mover', 'move me');
    await c.post(`/api/notes/${n.id}/tags`, { tag: 'travel' });
    const before = noteRow(n.id);
    const r = await c.post(`/api/notes/${n.id}/section`, { section: 'work' });
    expect(r.status, r.body).toBe(200);
    expect(r.json.note).toMatchObject({ section: 'work', tags: ['travel'], title: 'Mover' });
    expect(noteRow(n.id)).toEqual({ ...before, section_id: 'work' });
    expect(titles(await c.get('/api/notes?section=work'))).toEqual(['Mover']);
    expect(titles(await c.get('/api/notes'))).toEqual([]);
    expect(titles(await c.get('/api/search?q=move&section=work'))).toEqual(['Mover']);
  });

  it('a read-only note cannot be moved', async () => {
    const n = await note(c, 'default', 'Locked');
    await c.post(`/api/notes/${n.id}/read-only`, {});
    const r = await c.post(`/api/notes/${n.id}/section`, { section: 'work' });
    expect(r.status).toBe(403);
    expect(r.json.error).toMatch(/read-only/);
    expect(noteRow(n.id).section_id).toBe('default');
  });

  it('a trashed note cannot be moved', async () => {
    const n = await note(c, 'default', 'Binned');
    await c.del(`/api/notes/${n.id}`);
    const r = await c.post(`/api/notes/${n.id}/section`, { section: 'work' });
    expect(r.status).toBe(409);
    expect(r.json.error).toMatch(/Restore/);
    expect(noteRow(n.id).section_id).toBe('default');
  });

  it('only to a section of the user’s own', async () => {
    const n = await note(c, 'default', 'Stays');
    for (const section of ['nosuch', '', 5, undefined]) expect((await c.post(`/api/notes/${n.id}/section`, { section })).status).toBe(404);
    expect(noteRow(n.id).section_id).toBe('default');
  });
});

describe('Inbox and bots', () => {
  let c: Client;
  let bot: McpClient;
  beforeAll(async () => {
    c = await newUser(env, 'sec_inbox');
    await c.post('/api/sections', { id: 'work', name: 'Work', colour: 'blue' });
    const token = (await c.post('/api/bots', { name: 'Grok' })).json.bot.token;
    bot = await connectBot(base, token);
  });
  afterAll(() => bot?.close());

  it('a bot’s note lands in Default, in the Inbox; Keep puts it in the current section', async () => {
    const id = idFrom((await call(bot, 'create_note', { markdown: '# Bot report\n\nfindings' })).text);
    expect(noteRow(id)).toMatchObject({ section_id: 'default', inbox: 1 });
    expect((await c.get('/api/inbox')).json.notes.map((n: any) => n.id)).toEqual([id]);
    const kept = await c.post(`/api/notes/${id}/keep?section=work`, {});
    expect(kept.status, kept.body).toBe(200);
    expect(kept.json.note).toMatchObject({ inbox: false, section: 'work', botName: 'Grok' });
    expect(titles(await c.get('/api/notes?section=work'))).toEqual(['Bot report']);
    // Bots still see notes from every section.
    expect((await call(bot, 'list_notes', {})).text).toMatch(/Bot report/);
  });

  it('Keep without a section keeps into Default, as before', async () => {
    const id = idFrom((await call(bot, 'create_note', { markdown: 'plain' })).text);
    expect((await c.post(`/api/notes/${id}/keep`, {})).json.note.section).toBe('default');
  });
});

describe('backups', () => {
  it('sections and each note’s section survive a personal backup and restore', async () => {
    const c = await newUser(env, 'sec_backup');
    await c.post('/api/sections', { id: 'work', name: 'Work', colour: 'blue' });
    await c.post('/api/sections', { id: 'recipe', name: 'Recipes', colour: 'amber' });
    await c.patch('/api/sections/default', { name: 'Home', colour: 'slate' });
    const w = await note(c, 'work', 'Work note');
    await c.post(`/api/notes/${w.id}/tags`, { tag: 'job' });
    await note(c, 'recipe', 'Recipe note');
    const t = await note(c, 'recipe', 'Trashed recipe');
    await c.del(`/api/notes/${t.id}`);
    const sectionsBefore = (await c.get('/api/sections')).json.sections;
    const { file } = await takeBackup(c);
    const b = openBackup(file);
    expect(b.manifest.version).toBe(4);
    expect(b.data.sections.map((s: any) => [s.id, s.name, s.colour])).toEqual([
      ['default', 'Home', 'slate'],
      ['work', 'Work', 'blue'],
      ['recipe', 'Recipes', 'amber'],
    ]);
    expect(Object.fromEntries(b.data.notes.map((n: any) => [n.title, n.section]))).toEqual({ 'Work note': 'work', 'Recipe note': 'recipe', 'Trashed recipe': 'recipe' });

    // Changes after the backup are replaced by the restore.
    await c.post('/api/sections', { id: 'later', name: 'Later', colour: 'teal' });
    await c.patch('/api/sections/work', { name: 'Renamed' });
    await note(c, 'later', 'Later note');
    const r = await restore(c, file);
    expect(r.done.status, r.done.body).toBe(200);
    expect((await c.get('/api/sections')).json.sections).toEqual(sectionsBefore);
    expect(titles(await c.get('/api/notes?section=work'))).toEqual(['Work note']);
    expect((await c.get('/api/notes?section=work')).json.notes[0].tags).toEqual(['job']);
    expect(titles(await c.get('/api/notes?section=recipe'))).toEqual(['Recipe note']);
    expect(titles(await c.get('/api/trash?section=recipe'))).toEqual(['Trashed recipe']);
  });

  it('an older backup restores with every note in one Default section', async () => {
    const c = await newUser(env, 'sec_old');
    const b = openBackup((await takeBackup(c)).file);
    // As format 3 wrote it: no sections, no section on notes.
    b.manifest.version = 3;
    delete b.data.sections;
    b.data.notes = [
      { id: 'n'.repeat(22), title: 'Old one', content: doc('x'), tags: ['kept'], createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', deletedAt: null, readOnly: false, inbox: false, botName: null },
    ];
    b.manifest.counts = { ...b.manifest.counts, notes: 1 };
    await c.post('/api/sections', { id: 'work', name: 'Work', colour: 'blue' });
    const r = await restore(c, packBackup(b));
    expect(r.done.status, r.done.body).toBe(200);
    expect((await c.get('/api/sections')).json.sections).toEqual([{ id: 'default', name: 'Default', colour: 'olive', noteCount: 1, trashCount: 0 }]);
    const list = (await c.get('/api/notes')).json.notes;
    expect(list.map((n: any) => [n.title, n.section, n.tags])).toEqual([['Old one', 'default', ['kept']]]);
  });

  it('a format 4 backup must have a Default section, and every note must name one of its sections', async () => {
    const c = await newUser(env, 'sec_bad');
    await c.post('/api/sections', { id: 'work', name: 'Work', colour: 'blue' });
    await note(c, 'work', 'In work');
    const good = openBackup((await takeBackup(c)).file);
    const refused = async (change: (b: any) => void, why: RegExp) => {
      const b = openBackup(packBackup(good));
      change(b);
      const r = await c.raw('/api/restore', packBackup(b), 'application/x-tar');
      expect(r.status, r.body).toBe(400);
      expect(r.json.error).toMatch(why);
    };
    await refused((b) => (b.data.sections = b.data.sections.filter((s: any) => s.id !== 'default')), /Default section/);
    await refused((b) => (b.data.notes[0].section = 'nosuch'), /section that is not in the backup/);
    await refused((b) => delete b.data.notes[0].section, /section that is not in the backup/);
    await refused((b) => delete b.data.sections, /sections/);
    await refused((b) => b.data.sections.push({ ...b.data.sections[1] }), /repeated/);
    await refused((b) => (b.data.sections[1].id = 'Work'), /ID/);
    await refused((b) => (b.data.sections[1].colour = 'pink'), /colour/);
    await refused((b) => (b.data.sections[1].name = ''), /name/);
  });
});
