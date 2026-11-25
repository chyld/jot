// @vitest-environment jsdom
// Type 7 (component): Back to notes button in the editor header. It sits third in
// .note-header-actions (after Collapse/Expand sidebar and New note, before Title), is a
// real link to "/", navigates in-app on plain click without blocking modified clicks, and
// is shown whenever the editor header is shown (regular, read-only, Inbox, trashed, and
// with the sidebar expanded or collapsed).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RailProvider } from '../../src/client/components/Sidebar';
import { DataProvider } from '../../src/client/data';
import { NoteEditor } from '../../src/client/screens/NoteEditor';
import { FONTS } from './setup';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const makeNote = (extra: object = {}) => ({
  id: 'note-1',
  title: 'Test note',
  preview: '',
  tags: [],
  createdAt: '2026-11-21T10:00:00Z',
  updatedAt: '2026-11-21T10:00:00Z',
  deletedAt: null,
  readOnly: false,
  inbox: false,
  botName: null,
  section: 'default',
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  ...extra,
});

let currentNote: ReturnType<typeof makeNote>;

beforeEach(() => {
  localStorage.clear();
  currentNote = makeNote();
  history.replaceState(null, '', '/n/note-1');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      if (url === '/api/fonts') return json({ fonts: FONTS });
      if (url === '/api/styles') return json({ styles: [] });
      if (url === '/api/inbox') return json({ notes: [] });
      if (url === '/api/sections') return json({ sections: [{ id: 'default', name: 'Default', theme: 'olive', sortOrder: 0, noteCount: 1 }] });
      if (url === '/api/notes?section=default') return json({ notes: [currentNote] });
      if (url === '/api/notes/note-1' && method === 'GET') return json({ note: currentNote });
      if (url === '/api/notes/note-1' && method === 'PATCH') return json({ note: currentNote });
      return json({ error: 'unexpected' }, 500);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

async function renderEditor() {
  render(
    <DataProvider user={{ id: 'u1', username: 'alice' }} onLogout={() => {}}>
      <RailProvider>
        <NoteEditor noteId="note-1" onTrashed={() => {}} />
      </RailProvider>
    </DataProvider>,
  );
  await screen.findByLabelText('Note status');
  return document.querySelector('header.note-header') as HTMLElement;
}

describe('Back to notes button in editor header', () => {
  it('is fourth in the header button group, points to "/", and sits before the title', async () => {
    const header = await renderEditor();
    const actions = header.querySelector('.note-header-actions') as HTMLElement;
    const children = Array.from(actions.children);
    expect(children.map((el) => el.getAttribute('aria-label'))).toEqual(['Collapse sidebar', 'New note', 'New spreadsheet', 'Back to notes']);

    const backLink = within(actions).getByRole('link', { name: 'Back to notes' });
    expect(backLink).toBe(children[3]);
    expect(backLink.getAttribute('href')).toBe('/');
    expect(backLink.getAttribute('title')).toBe('Back to notes');
    expect(backLink.classList.contains('rail-toggle-btn')).toBe(true);

    const title = within(header).getByLabelText('Title');
    expect(backLink.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('navigates in-app on plain click and lets modified clicks open normally', async () => {
    const header = await renderEditor();
    const backLink = within(header).getByRole('link', { name: 'Back to notes' });

    // Modified clicks should not be prevented or navigate in-app.
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
      fireEvent(backLink, event);
      expect(event.defaultPrevented).toBe(false);
      expect(location.pathname).toBe('/n/note-1');
    }

    // Plain click navigates in-app to "/".
    await userEvent.click(backLink);
    expect(location.pathname).toBe('/');
  });

  it.each([
    ['a read-only note', () => (currentNote = makeNote({ readOnly: true }))],
    ['an Inbox note', () => (currentNote = makeNote({ inbox: true }))],
    ['a trashed note', () => (currentNote = makeNote({ deletedAt: '2026-11-21T11:00:00Z' }))],
    ['with the sidebar collapsed', () => localStorage.setItem('jot.railCollapsed', '1')],
  ])('is shown for %s', async (_label, setup) => {
    setup();
    const header = await renderEditor();
    const backLink = within(header).getByRole('link', { name: 'Back to notes' });
    expect(backLink.getAttribute('href')).toBe('/');
  });
});
