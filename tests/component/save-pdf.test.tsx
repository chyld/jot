// @vitest-environment jsdom
// Type 7 (component): Save as PDF in the editor toolbar. It sits just left of the lock,
// works on read-only notes, saves what was typed first, then opens the browser's print
// dialog with the note's title as the page title (the suggested file name) and puts the
// open note's tab title ("<title> · Jot") back afterwards. Rendered from the real NoteEditor with the API answered by a
// stubbed fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataProvider } from '../../src/client/data';
import { NoteEditor } from '../../src/client/screens/NoteEditor';
import { FONTS } from './setup';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const makeNote = (extra: object = {}) => ({
  id: 'a',
  title: 'Trip plan',
  preview: '',
  tags: [],
  createdAt: '2026-11-19T10:00:00Z',
  updatedAt: '2026-11-19T10:00:00Z',
  deletedAt: null,
  readOnly: false,
  inbox: false,
  botName: null,
  section: 'work',
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] },
  ...extra,
});

let note: ReturnType<typeof makeNote>;
let calls: string[];
/** What the page looked like each time window.print was called. */
let prints: { title: string; callsSoFar: string[] }[];

beforeEach(() => {
  note = makeNote();
  calls = [];
  prints = [];
  document.title = 'Jot';
  history.replaceState(null, '', '/n/a');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push(`${method} ${url}`);
      if (url === '/api/fonts') return json({ fonts: FONTS });
      if (url === '/api/styles') return json({ styles: [] });
      if (url === '/api/inbox') return json({ notes: [] });
      if (url === '/api/notes?section=work') return json({ notes: [note] });
      if (url === '/api/notes/a' && method === 'GET') return json({ note });
      if (url === '/api/notes/a' && method === 'PATCH') return json({ note: { ...note, ...JSON.parse(init.body as string) } });
      return json({ error: 'unexpected' }, 500);
    }),
  );
  vi.spyOn(window, 'print').mockImplementation(() => {
    prints.push({ title: document.title, callsSoFar: [...calls] });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openNote() {
  render(
    <DataProvider user={{ id: 'u1', username: 'alice' }} onLogout={() => {}}>
      <NoteEditor noteId="a" onTrashed={() => {}} />
    </DataProvider>,
  );
  await screen.findByLabelText('Note status');
  return screen.getByRole('toolbar', { name: 'Formatting' });
}

describe('Save as PDF', () => {
  it('sits at the right end of the toolbar, after Show empty lines and just left of the lock', async () => {
    const toolbar = await openNote();
    const labels = within(toolbar)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(labels.slice(-3)).toEqual(['Show empty lines', 'Save as PDF', 'Make read-only']);
    const button = within(toolbar).getByRole('button', { name: 'Save as PDF' });
    expect(button.getAttribute('title')).toBe('Save as PDF');
    expect(button.querySelector('svg')).toBeTruthy();
  });

  it('saves what was typed, then prints with the note title as the page title, and restores it', async () => {
    await openNote();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Typed title' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
    await waitFor(() => expect(prints).toHaveLength(1));
    expect(prints[0].title).toBe('Typed title');
    expect(prints[0].callsSoFar).toContain('PATCH /api/notes/a'); // saved before the dialog opened
    expect(document.title).toBe('Typed title · Jot'); // the open note's tab title is back
  });

  it('works on a read-only note', async () => {
    note = makeNote({ readOnly: true });
    const toolbar = await openNote();
    const button = within(toolbar).getByRole('button', { name: 'Save as PDF' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await userEvent.click(button);
    await waitFor(() => expect(prints).toHaveLength(1));
    expect(prints[0].title).toBe('Trip plan');
    expect(document.title).toBe('Trip plan · Jot');
  });
});
