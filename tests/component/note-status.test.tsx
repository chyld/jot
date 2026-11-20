// @vitest-environment jsdom
// Type 7 (component): the status line at the bottom of the note screen (save status,
// word and character counts, read-only and bot labels, dates), rendered from the real
// NoteEditor with the API answered by a stubbed fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { DataProvider } from '../../src/client/data';
import { NoteEditor } from '../../src/client/screens/NoteEditor';
import { FONTS } from './setup';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const para = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
let note: any;

const makeNote = (extra: object = {}) => ({
  id: 'n1',
  title: 'Status',
  preview: '',
  tags: [],
  createdAt: '2026-11-19T10:00:00Z',
  updatedAt: new Date().toISOString(),
  deletedAt: null,
  readOnly: false,
  inbox: false,
  botName: null,
  content: { type: 'doc', content: [para('Hello there world'), para('Two lines')] },
  ...extra,
});

beforeEach(() => {
  note = makeNote();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url === '/api/fonts') return json({ fonts: FONTS });
      if (url === '/api/styles') return json({ styles: [] });
      if (url === '/api/inbox') return json({ notes: [] });
      if (url === '/api/notes/n1' && (init.method ?? 'GET') === 'GET') return json({ note });
      if (url === '/api/notes/n1' && init.method === 'PATCH') return json({ note: { ...note, ...JSON.parse(init.body as string) } });
      return json({ error: 'unexpected' }, 500);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function openNote() {
  render(
    <DataProvider user={{ id: 'u1', username: 'alice' }} onLogout={() => {}}>
      <NoteEditor noteId="n1" onTrashed={() => {}} />
    </DataProvider>,
  );
  const bar = await screen.findByLabelText('Note status');
  const body = document.querySelector('.note-body') as HTMLElement & { editor: Editor };
  return { bar, header: document.querySelector('.note-header') as HTMLElement, editor: body.editor };
}

describe('note status line', () => {
  it('is a footer after the writing area holding the counts, save status and dates, in order', async () => {
    const { bar, header } = await openNote();
    expect(bar.tagName).toBe('FOOTER');
    expect(document.querySelector('.note-page')!.nextElementSibling).toBe(bar);
    const ids = Array.from(bar.querySelectorAll('[data-testid]')).map((e) => e.getAttribute('data-testid'));
    expect(ids).toEqual(['word-count', 'char-count', 'save-status', 'note-dates']);
    expect(within(bar).getByTestId('save-status').getAttribute('role')).toBe('status');
    expect(within(bar).getByTestId('note-dates').textContent).toMatch(/^Created [A-Z][a-z]{2} \d{1,2}, \d{4} · Updated just now$/);
    // The header keeps the title, tags and the trash button only.
    for (const id of ['save-status', 'note-dates', 'word-count', 'char-count']) expect(within(header).queryByTestId(id)).toBeNull();
    expect(within(header).getByLabelText('Title')).toBeTruthy();
    expect(within(header).getByRole('button', { name: 'Move to trash' })).toBeTruthy();
  });

  it('counts words and characters of the text and follows typing', async () => {
    const { bar, editor } = await openNote();
    // "Hello there world" + "Two lines": 5 words, 26 characters (spaces count, paragraph breaks do not).
    expect(within(bar).getByTestId('word-count').textContent).toBe('5 words');
    expect(within(bar).getByTestId('char-count').textContent).toBe('26 characters');
    editor.commands.setContent({ type: 'doc', content: [para('Hi')] }, { emitUpdate: true });
    await waitFor(() => expect(within(bar).getByTestId('word-count').textContent).toBe('1 word'));
    expect(within(bar).getByTestId('char-count').textContent).toBe('2 characters');
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, [
      { type: 'text', text: ' ' },
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' again' },
    ]);
    await waitFor(() => expect(within(bar).getByTestId('word-count').textContent).toBe('3 words'));
    expect(within(bar).getByTestId('char-count').textContent).toBe('13 characters'); // "Hi bold again": the bold markup is not counted
    editor.commands.setContent({ type: 'doc', content: [para('')] }, { emitUpdate: true });
    await waitFor(() => expect(within(bar).getByTestId('word-count').textContent).toBe('0 words'));
    expect(within(bar).getByTestId('char-count').textContent).toBe('0 characters');
    editor.commands.insertContent('a');
    await waitFor(() => expect(within(bar).getByTestId('char-count').textContent).toBe('1 character'));
  });

  it('shows the read-only and bot labels after the counts on a read-only bot note', async () => {
    note = makeNote({ readOnly: true, botName: 'Grok' });
    const { bar, header } = await openNote();
    const ids = Array.from(bar.querySelectorAll('[data-testid]')).map((e) => e.getAttribute('data-testid'));
    expect(ids).toEqual(['word-count', 'char-count', 'save-status', 'read-only-indicator', 'note-bot', 'note-dates']);
    expect(within(bar).getByTestId('note-bot').textContent).toMatch(/From Grok/);
    expect(within(header).queryByTestId('read-only-indicator')).toBeNull();
    expect(within(header).queryByTestId('note-bot')).toBeNull();
  });

  it('is shown on a trashed note too', async () => {
    note = makeNote({ deletedAt: new Date().toISOString() });
    const { bar } = await openNote();
    expect(within(bar).getByTestId('word-count').textContent).toBe('5 words');
    expect(within(bar).getByTestId('note-dates')).toBeTruthy();
  });

  it('keeps the Keep button of an Inbox note in the header', async () => {
    note = makeNote({ inbox: true, botName: 'Grok' });
    const { bar, header } = await openNote();
    expect(within(header).getByRole('button', { name: /Keep/ })).toBeTruthy();
    expect(within(bar).queryByRole('button')).toBeNull();
  });
});
