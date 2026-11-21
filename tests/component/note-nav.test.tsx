// @vitest-environment jsdom
// Type 7 (component): Previous note / Next note in the editor header. They walk the note's
// section in home page order (the list as the server gives it, fetched again at click
// time), wrap at both ends, save what was typed first, and are not shown for a trashed or
// Inbox note or the only note of a section. Rendered from the real NoteEditor with the API
// answered by a stubbed fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataProvider } from '../../src/client/data';
import { NoteEditor } from '../../src/client/screens/NoteEditor';
import { FONTS } from './setup';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const makeNote = (id: string, extra: object = {}) => ({
  id,
  title: `Note ${id}`,
  preview: '',
  tags: [],
  createdAt: '2026-11-19T10:00:00Z',
  updatedAt: '2026-11-19T10:00:00Z',
  deletedAt: null,
  readOnly: false,
  inbox: false,
  botName: null,
  section: 'work',
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  ...extra,
});

let notes: Record<string, any>;
/** The section's list in home page order, as GET /api/notes?section=work answers it. */
let order: string[];
let calls: string[];

beforeEach(() => {
  notes = { a: makeNote('a'), b: makeNote('b'), c: makeNote('c') };
  order = ['a', 'b', 'c'];
  calls = [];
  history.replaceState(null, '', '/');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push(`${method} ${url}`);
      if (url === '/api/fonts') return json({ fonts: FONTS });
      if (url === '/api/styles') return json({ styles: [] });
      if (url === '/api/inbox') return json({ notes: [] });
      if (url === '/api/notes?section=work') return json({ notes: order.map((id) => notes[id]) });
      const m = url.match(/^\/api\/notes\/(\w+)$/);
      if (m && method === 'GET') return json({ note: notes[m[1]] });
      if (m && method === 'PATCH') return json({ note: { ...notes[m[1]], ...JSON.parse(init.body as string) } });
      return json({ error: 'unexpected' }, 500);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function openNote(id: string) {
  history.replaceState(null, '', `/n/${id}`);
  render(
    <DataProvider user={{ id: 'u1', username: 'alice' }} onLogout={() => {}}>
      <NoteEditor noteId={id} onTrashed={() => {}} />
    </DataProvider>,
  );
  await screen.findByLabelText('Note status');
  return document.querySelector('.note-header') as HTMLElement;
}

const next = () => screen.findByRole('button', { name: 'Next note' });
const previous = () => screen.findByRole('button', { name: 'Previous note' });

describe('previous and next note', () => {
  it('sit in the header just right of Move to trash: Move to trash, Previous, Next', async () => {
    const header = await openNote('b');
    await next();
    const labels = within(header)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'))
      .filter((l) => l === 'Previous note' || l === 'Next note' || l === 'Move to trash');
    expect(labels).toEqual(['Move to trash', 'Previous note', 'Next note']);
    const trash = within(header).getByRole('button', { name: 'Move to trash' });
    const nextBtn = within(header).getByRole('button', { name: 'Next note' });
    expect(nextBtn.compareDocumentPosition(trash) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect((nextBtn.closest('.note-nav-buttons') as HTMLElement).previousElementSibling).toBe(trash);
  });

  it('Next opens the note after this one and Previous the one before, in the section list order', async () => {
    await openNote('b');
    await userEvent.click(await next());
    await waitFor(() => expect(location.pathname).toBe('/n/c'));
    history.replaceState(null, '', '/n/b');
    await userEvent.click(await previous());
    await waitFor(() => expect(location.pathname).toBe('/n/a'));
    // The note's own section is asked for, not a filtered or searched list.
    expect(calls.filter((c) => c.startsWith('GET /api/notes?'))).toEqual(Array(3).fill('GET /api/notes?section=work'));
  });

  it('wraps: Next on the last note opens the first, Previous on the first opens the last', async () => {
    await openNote('c');
    await userEvent.click(await next());
    await waitFor(() => expect(location.pathname).toBe('/n/a'));
    history.replaceState(null, '', '/n/c');
    order = ['c', 'a', 'b'];
    await userEvent.click(await previous());
    await waitFor(() => expect(location.pathname).toBe('/n/b'));
  });

  it('uses the list as it is at click time (an edited note has moved to the top)', async () => {
    await openNote('b');
    await next();
    order = ['b', 'a', 'c']; // b was edited, so it is now first
    await userEvent.click(await previous());
    await waitFor(() => expect(location.pathname).toBe('/n/c'));
  });

  it('saves what was typed before opening the other note', async () => {
    await openNote('a');
    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Typed just now' } });
    await userEvent.click(await next());
    await waitFor(() => expect(location.pathname).toBe('/n/b'));
    const patch = calls.indexOf('PATCH /api/notes/a');
    expect(patch).toBeGreaterThan(-1);
    expect(patch).toBeLessThan(calls.lastIndexOf('GET /api/notes?section=work'));
  });

  it('are shown for a read-only note', async () => {
    notes.b = makeNote('b', { readOnly: true });
    const header = await openNote('b');
    await next();
    expect(within(header).getByRole('button', { name: 'Previous note' })).toBeTruthy();
    expect(within(header).queryByRole('button', { name: 'Move to trash' })).toBeNull();
    await userEvent.click(await next());
    await waitFor(() => expect(location.pathname).toBe('/n/c'));
  });

  it.each([
    ['a trashed note', () => (notes.b = makeNote('b', { deletedAt: '2026-11-19T11:00:00Z' }))],
    ['an Inbox note', () => (notes.b = makeNote('b', { inbox: true }))],
    ['the only note of its section', () => (order = ['b'])],
  ])('are not shown for %s', async (_name, setup) => {
    setup();
    const header = await openNote('b');
    // Give the section list time to arrive, then check nothing appeared.
    await waitFor(() => expect(within(header).getByLabelText('Title')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 50));
    expect(within(header).queryByRole('button', { name: 'Next note' })).toBeNull();
    expect(within(header).queryByRole('button', { name: 'Previous note' })).toBeNull();
  });
});
