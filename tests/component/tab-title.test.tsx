// @vitest-environment jsdom
// Type 7 (component): the browser tab is named after the open note. It reads
// "<note title> · Jot" ("Untitled · Jot" when the title is empty), follows the title as it
// is typed, and goes back to "Jot" when the note is left. Rendered from the real
// NoteEditor with the API answered by a stubbed fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DataProvider } from '../../src/client/data';
import { NoteEditor } from '../../src/client/screens/NoteEditor';
import { FONTS } from './setup';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const makeNote = (extra: object = {}) => ({
  id: 'a', title: 'Trip plan', preview: '', tags: [], createdAt: '2026-11-19T10:00:00Z', updatedAt: '2026-11-19T10:00:00Z',
  deletedAt: null, readOnly: false, inbox: false, botName: null, section: 'work',
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] },
  ...extra,
});

let note: ReturnType<typeof makeNote>;
beforeEach(() => {
  note = makeNote();
  localStorage.clear(); // no kept unsaved edits from the test before
  document.title = 'Jot';
  history.replaceState(null, '', '/n/a');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      if (url === '/api/fonts') return json({ fonts: FONTS });
      if (url === '/api/styles') return json({ styles: [] });
      if (url === '/api/inbox') return json({ notes: [] });
      if (url === '/api/notes?section=work') return json({ notes: [note] });
      if (url === '/api/notes/a' && method === 'GET') return json({ note });
      if (url === '/api/notes/a' && method === 'PATCH') return json({ note: { ...note, ...JSON.parse(init.body as string) } });
      return json({ error: 'unexpected' }, 500);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openNote() {
  const view = render(
    <DataProvider user={{ id: 'u1', username: 'alice' }} onLogout={() => {}}>
      <NoteEditor noteId="a" onTrashed={() => {}} />
    </DataProvider>,
  );
  await screen.findByLabelText('Note status');
  return view;
}

describe('Note title in the browser tab', () => {
  it('names the tab after the open note', async () => {
    await openNote();
    expect(document.title).toBe('Trip plan · Jot');
  });

  it('follows the title as it is typed', async () => {
    await openNote();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Packing list' } });
    expect(document.title).toBe('Packing list · Jot');
  });

  it('says Untitled when the title is empty or only spaces', async () => {
    note = makeNote({ title: '' });
    await openNote();
    expect(document.title).toBe('Untitled · Jot');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '   ' } });
    expect(document.title).toBe('Untitled · Jot');
  });

  it('names the tab on a read-only note too', async () => {
    note = makeNote({ readOnly: true });
    await openNote();
    expect(document.title).toBe('Trip plan · Jot');
  });

  it('goes back to Jot when the note is left', async () => {
    const view = await openNote();
    view.unmount();
    expect(document.title).toBe('Jot');
  });
});
