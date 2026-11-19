// Type 2 (API integration): notes, tags, search and trash.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { doc, makeTestEnv, newUser, type Client, type TestEnv } from '../helpers/setup';

let env: TestEnv;
let alice: Client;
beforeAll(async () => {
  env = await makeTestEnv();
  alice = await newUser(env, 'alice');
});
afterAll(() => env.close());

async function newNote(title = '', content?: unknown) {
  const res = await alice.post('/api/notes', { title, ...(content ? { content } : {}) });
  expect(res.status).toBe(201);
  return res.json.note;
}

describe('notes', () => {
  it('creates an empty note with dates and its own id', async () => {
    const note = await newNote();
    expect(note.id).toMatch(/^[A-Za-z0-9_-]{10,}$/);
    expect(note.title).toBe('');
    expect(note.tags).toEqual([]);
    expect(note.content.type).toBe('doc');
    expect(new Date(note.createdAt).toString()).not.toBe('Invalid Date');
    expect(note.updatedAt).toBe(note.createdAt);
    expect(note.deletedAt).toBeNull();
  });

  it('reads a note by id', async () => {
    const note = await newNote('Hello World', doc('First line'));
    const res = await alice.get(`/api/notes/${note.id}`);
    expect(res.status).toBe(200);
    expect(res.json.note.title).toBe('Hello World');
    expect(res.json.note.content).toEqual(doc('First line'));
  });

  it('updates title and content, and moves updatedAt', async () => {
    const note = await newNote('Old');
    await new Promise((r) => setTimeout(r, 15));
    const res = await alice.patch(`/api/notes/${note.id}`, { title: 'New title', content: doc('Brand new body') });
    expect(res.status).toBe(200);
    expect(res.json.note.title).toBe('New title');
    expect(res.json.note.content).toEqual(doc('Brand new body'));
    expect(res.json.note.preview).toBe('Brand new body');
    expect(res.json.note.updatedAt > note.updatedAt).toBe(true);
    expect(res.json.note.createdAt).toBe(note.createdAt);
  });

  it('allows updating only the title or only the content', async () => {
    const note = await newNote('T', doc('body one'));
    expect((await alice.patch(`/api/notes/${note.id}`, { title: 'T2' })).json.note.content).toEqual(doc('body one'));
    expect((await alice.patch(`/api/notes/${note.id}`, { content: doc('body two') })).json.note.title).toBe('T2');
  });

  it('lists notes newest first with title, preview, tags and dates', async () => {
    const a = await newNote('List A', doc('alpha text'));
    await new Promise((r) => setTimeout(r, 15));
    const b = await newNote('List B', doc('beta text'));
    const res = await alice.get('/api/notes');
    expect(res.status).toBe(200);
    const ids = res.json.notes.map((n: any) => n.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
    const item = res.json.notes.find((n: any) => n.id === a.id);
    expect(item).toMatchObject({ title: 'List A', preview: 'alpha text', tags: [] });
    expect(item.updatedAt).toBeTruthy();
    expect(item.createdAt).toBeTruthy();
    expect(item.content).toBeUndefined();
  });

  it('builds a short preview from the body text', async () => {
    const long = 'word '.repeat(100).trim();
    const note = await newNote('P', doc('Line one', long));
    const got = (await alice.get(`/api/notes/${note.id}`)).json.note;
    expect(got.preview.startsWith('Line one word word')).toBe(true);
    expect(got.preview.length).toBeLessThanOrEqual(160);
  });

  it('answers 404 for a missing note', async () => {
    expect((await alice.get('/api/notes/doesnotexist123')).status).toBe(404);
    expect((await alice.patch('/api/notes/doesnotexist123', { title: 'x' })).status).toBe(404);
    expect((await alice.del('/api/notes/doesnotexist123')).status).toBe(404);
  });

  it('rejects invalid updates', async () => {
    const note = await newNote();
    expect((await alice.patch(`/api/notes/${note.id}`, { title: 42 })).status).toBe(400);
    expect((await alice.patch(`/api/notes/${note.id}`, { title: 'x'.repeat(501) })).status).toBe(400);
    expect((await alice.patch(`/api/notes/${note.id}`, { content: '<p>html</p>' })).status).toBe(400);
    expect((await alice.patch(`/api/notes/${note.id}`, { content: { type: 'paragraph' } })).status).toBe(400);
  });

  it('keeps tables, task lists and photos in the content', async () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: [120] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dish' }] }] }] },
            { type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Chowder' }] }] }] },
          ],
        },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Buy fish' }] }] }] },
        { type: 'image', attrs: { src: '/api/photos/abcdefghijklmnop', alt: null, title: null, width: 320, height: 200, borderWidth: 3, borderColor: 'Lime' } },
      ],
    };
    const note = await newNote('Rich', content);
    const got = (await alice.get(`/api/notes/${note.id}`)).json.note.content;
    expect(got.content[0].type).toBe('table');
    expect(got.content[0].content[0].content[0].attrs.colwidth).toEqual([120]);
    expect(got.content[1].content[0].attrs.checked).toBe(true);
    expect(got.content[2].attrs).toMatchObject({ src: '/api/photos/abcdefghijklmnop', width: 320, borderWidth: 3, borderColor: 'Lime' });
  });

  it('keeps Jot formatting marks (font, size, palette colours, highlight)', async () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Styled',
              marks: [
                { type: 'textStyle', attrs: { fontFamily: '"Playfair Display"', fontSize: '40px', color: '#8F2AF4' } },
                { type: 'highlight', attrs: { color: '#FFE58F' } },
                { type: 'bold' },
                { type: 'italic' },
                { type: 'underline' },
                { type: 'strike' },
                { type: 'link', attrs: { href: 'https://example.com', target: '_blank', rel: 'noopener noreferrer nofollow', class: null } },
              ],
            },
          ],
        },
      ],
    };
    const note = await newNote('Marks', content);
    const marks = (await alice.get(`/api/notes/${note.id}`)).json.note.content.content[0].content[0].marks;
    const byType = Object.fromEntries(marks.map((m: any) => [m.type, m]));
    expect(byType.textStyle.attrs).toMatchObject({ fontFamily: '"Playfair Display"', fontSize: '40px', color: '#8F2AF4' });
    expect(byType.highlight.attrs.color).toBe('#FFE58F');
    expect(byType.link.attrs.href).toBe('https://example.com');
    expect(Object.keys(byType).sort()).toEqual(['bold', 'highlight', 'italic', 'link', 'strike', 'textStyle', 'underline']);
  });
});

describe('tags', () => {
  it('adds a tag, lowercasing it', async () => {
    const note = await newNote('Tagged');
    const res = await alice.post(`/api/notes/${note.id}/tags`, { tag: 'Demo' });
    expect(res.status).toBe(200);
    expect(res.json.note.tags).toEqual(['demo']);
  });

  it('ignores a duplicate tag on the same note', async () => {
    const note = await newNote('Dup');
    await alice.post(`/api/notes/${note.id}/tags`, { tag: 'fonts' });
    const res = await alice.post(`/api/notes/${note.id}/tags`, { tag: 'FONTS' });
    expect(res.status).toBe(200);
    expect(res.json.note.tags).toEqual(['fonts']);
  });

  it('keeps tags sorted', async () => {
    const note = await newNote('Sorted');
    for (const t of ['styles', 'demo', 'fonts']) await alice.post(`/api/notes/${note.id}/tags`, { tag: t });
    expect((await alice.get(`/api/notes/${note.id}`)).json.note.tags).toEqual(['demo', 'fonts', 'styles']);
  });

  it.each([['demo1'], ['to-do'], ['to do'], ['café'], ['a'.repeat(31)], [''], ['#demo']])(
    'rejects %j with a message',
    async (tag) => {
      const note = await newNote('Bad tag');
      const res = await alice.post(`/api/notes/${note.id}/tags`, { tag });
      expect(res.status).toBe(400);
      expect(typeof res.json.error).toBe('string');
      expect((await alice.get(`/api/notes/${note.id}`)).json.note.tags).toEqual([]);
    },
  );

  it('accepts a 30-letter tag', async () => {
    const note = await newNote('Long tag');
    const res = await alice.post(`/api/notes/${note.id}/tags`, { tag: 'a'.repeat(30) });
    expect(res.status).toBe(200);
  });

  it('removes a tag', async () => {
    const note = await newNote('Remove tag');
    await alice.post(`/api/notes/${note.id}/tags`, { tag: 'temp' });
    const res = await alice.del(`/api/notes/${note.id}/tags/temp`);
    expect(res.status).toBe(200);
    expect(res.json.note.tags).toEqual([]);
  });

  it('lists tags with note counts, and filters notes by tag', async () => {
    const a = await newNote('Tag A');
    const b = await newNote('Tag B');
    await alice.post(`/api/notes/${a.id}/tags`, { tag: 'kitchen' });
    await alice.post(`/api/notes/${b.id}/tags`, { tag: 'kitchen' });
    await alice.post(`/api/notes/${b.id}/tags`, { tag: 'harbour' });
    const tags = (await alice.get('/api/tags')).json.tags;
    expect(tags.find((t: any) => t.name === 'kitchen').count).toBe(2);
    expect(tags.find((t: any) => t.name === 'harbour').count).toBe(1);
    const names = tags.map((t: any) => t.name);
    expect([...names].sort()).toEqual(names);

    const list = (await alice.get('/api/notes?tag=kitchen')).json.notes.map((n: any) => n.id).sort();
    expect(list).toEqual([a.id, b.id].sort());
    expect((await alice.get('/api/notes?tag=harbour')).json.notes.map((n: any) => n.id)).toEqual([b.id]);
  });

  it('drops a tag from the tag list once no live note uses it', async () => {
    const note = await newNote('Lonely');
    await alice.post(`/api/notes/${note.id}/tags`, { tag: 'lonely' });
    expect((await alice.get('/api/tags')).json.tags.some((t: any) => t.name === 'lonely')).toBe(true);
    await alice.del(`/api/notes/${note.id}`);
    expect((await alice.get('/api/tags')).json.tags.some((t: any) => t.name === 'lonely')).toBe(false);
    await alice.post(`/api/trash/${note.id}/restore`);
    expect((await alice.get('/api/tags')).json.tags.some((t: any) => t.name === 'lonely')).toBe(true);
  });
});

describe('search', () => {
  it('finds notes by title, body text and word prefix', async () => {
    const note = await newNote('Lighthouse Kitchen', doc('Catch of the day chowder'));
    for (const q of ['lighthouse', 'chowder', 'chow', 'CHOWDER', 'kitchen chowder']) {
      const res = await alice.get(`/api/search?q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      expect(res.json.notes.map((n: any) => n.id)).toContain(note.id);
    }
    expect((await alice.get('/api/search?q=lighthouse%20pizza')).json.notes.map((n: any) => n.id)).not.toContain(note.id);
  });

  it('finds notes by tag, with or without #', async () => {
    const note = await newNote('Tag search');
    await alice.post(`/api/notes/${note.id}/tags`, { tag: 'zebra' });
    expect((await alice.get('/api/search?q=zebra')).json.notes.map((n: any) => n.id)).toEqual([note.id]);
    expect((await alice.get('/api/search?q=%23zebra')).json.notes.map((n: any) => n.id)).toEqual([note.id]);
  });

  it('returns summaries, not full content', async () => {
    const note = await newNote('Summary shape', doc('uniqueshape words'));
    const hit = (await alice.get('/api/search?q=uniqueshape')).json.notes[0];
    expect(hit).toMatchObject({ id: note.id, title: 'Summary shape', preview: 'uniqueshape words', tags: [] });
    expect(hit.content).toBeUndefined();
  });

  it('returns nothing for an empty query', async () => {
    const res = await alice.get('/api/search?q=');
    expect(res.status).toBe(200);
    expect(res.json.notes).toEqual([]);
    expect((await alice.get('/api/search')).json.notes).toEqual([]);
  });

  it('never returns trashed notes', async () => {
    const note = await newNote('Trashable', doc('pelican'));
    expect((await alice.get('/api/search?q=pelican')).json.notes.length).toBe(1);
    await alice.del(`/api/notes/${note.id}`);
    expect((await alice.get('/api/search?q=pelican')).json.notes).toEqual([]);
    await alice.post(`/api/trash/${note.id}/restore`);
    expect((await alice.get('/api/search?q=pelican')).json.notes.length).toBe(1);
  });

  it('follows edits', async () => {
    const note = await newNote('Edit search', doc('walrus'));
    await alice.patch(`/api/notes/${note.id}`, { content: doc('narwhal') });
    expect((await alice.get('/api/search?q=walrus')).json.notes).toEqual([]);
    expect((await alice.get('/api/search?q=narwhal')).json.notes.length).toBe(1);
  });
});

describe('trash', () => {
  it('moves a deleted note to the trash', async () => {
    const note = await newNote('To trash');
    const res = await alice.del(`/api/notes/${note.id}`);
    expect(res.status).toBe(200);
    expect(res.json.note.deletedAt).toBeTruthy();
    expect((await alice.get('/api/notes')).json.notes.map((n: any) => n.id)).not.toContain(note.id);
    const trash = (await alice.get('/api/trash')).json.notes;
    expect(trash.map((n: any) => n.id)).toContain(note.id);
    expect(trash.find((n: any) => n.id === note.id).deletedAt).toBeTruthy();
  });

  it('can still open a trashed note but not edit or tag it', async () => {
    const note = await newNote('Read only');
    await alice.del(`/api/notes/${note.id}`);
    const res = await alice.get(`/api/notes/${note.id}`);
    expect(res.status).toBe(200);
    expect(res.json.note.deletedAt).toBeTruthy();
    expect((await alice.patch(`/api/notes/${note.id}`, { title: 'x' })).status).toBe(409);
    expect((await alice.post(`/api/notes/${note.id}/tags`, { tag: 'x' })).status).toBe(409);
  });

  it('restores a note', async () => {
    const note = await newNote('Restore me');
    await alice.del(`/api/notes/${note.id}`);
    const res = await alice.post(`/api/trash/${note.id}/restore`);
    expect(res.status).toBe(200);
    expect(res.json.note.deletedAt).toBeNull();
    expect((await alice.get('/api/notes')).json.notes.map((n: any) => n.id)).toContain(note.id);
    expect((await alice.get('/api/trash')).json.notes.map((n: any) => n.id)).not.toContain(note.id);
  });

  it('deletes permanently only from the trash', async () => {
    const note = await newNote('Gone soon');
    expect((await alice.del(`/api/trash/${note.id}`)).status).toBe(404);
    await alice.del(`/api/notes/${note.id}`);
    expect((await alice.del(`/api/trash/${note.id}`)).status).toBe(204);
    expect((await alice.get(`/api/notes/${note.id}`)).status).toBe(404);
    expect((await alice.get('/api/trash')).json.notes.map((n: any) => n.id)).not.toContain(note.id);
    expect((await alice.post(`/api/trash/${note.id}/restore`)).status).toBe(404);
  });

  it('cannot restore a note that is not in the trash', async () => {
    const note = await newNote('Live');
    expect((await alice.post(`/api/trash/${note.id}/restore`)).status).toBe(404);
  });
});
