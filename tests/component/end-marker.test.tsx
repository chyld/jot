// @vitest-environment jsdom
// Type 7 (component): the end-of-note marker. It is drawn by styles.css as a ::after on the
// editor element (.note-body), so it comes after the note's last block, is always on (read-
// only notes too) and never enters the note: the editor's text, its document and what is
// saved stay exactly as they were. Rendered from the real NoteEditor with a stubbed fetch.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DataProvider } from '../../src/client/data';
import { NoteEditor } from '../../src/client/screens/NoteEditor';
import { FONTS } from './setup';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const CONTENT = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Roast the tomatoes first.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Basil goes in at the end.' }] },
  ],
};
const makeNote = (extra: object = {}) => ({
  id: 'a', title: 'Soup', preview: '', tags: [], createdAt: '2026-11-19T10:00:00Z', updatedAt: '2026-11-19T10:00:00Z',
  deletedAt: null, readOnly: false, inbox: false, botName: null, section: 'work', content: CONTENT, ...extra,
});

let note: ReturnType<typeof makeNote>;
let patches: any[];
beforeEach(() => {
  note = makeNote();
  patches = [];
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
      if (url === '/api/notes/a' && method === 'PATCH') {
        patches.push(JSON.parse(init.body as string));
        return json({ note: { ...note, ...patches.at(-1) } });
      }
      return json({ error: 'unexpected' }, 500);
    }),
  );
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
  return screen.getByLabelText('Note text');
}

const css = readFileSync('src/client/styles.css', 'utf8'); // tests run from the project root
const markerRule = css.match(/\n\.note-body::after \{([^}]*)\}/)?.[1] ?? '';

describe('end-of-note marker', () => {
  it('is a rule with END drawn after the note body, outside the note and not clickable', () => {
    expect(markerRule).toContain("content: 'END'");
    expect(markerRule).toContain('display: block');
    expect(markerRule).toContain('var(--border)');
    expect(markerRule).toContain('color: var(--muted)');
    expect(markerRule).toContain('pointer-events: none');
    expect(markerRule).toContain('user-select: none');
  });

  it('is left out of the printed PDF', () => {
    const print = css.slice(css.lastIndexOf('@media print {'));
    expect(print).toMatch(/\.note-body::after[^{]*\{ content: none; \}/);
  });

  it('applies to the editor element, after its last line, and the note content is unchanged', async () => {
    const editorEl = await openNote();
    expect(editorEl.classList.contains('note-body')).toBe(true); // the element the ::after is drawn on
    expect(editorEl.getAttribute('contenteditable')).toBe('true');
    expect([...editorEl.children].map((c) => c.textContent)).toEqual(['Roast the tomatoes first.', 'Basil goes in at the end.']);
    expect(editorEl.textContent).not.toContain('END');
    expect(document.querySelector('[data-testid="end-marker"], .end-marker')).toBeNull(); // no element added to the page

    // What is saved is just the note.
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Soup for four' } });
    await waitFor(() => expect(patches.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(JSON.stringify(patches)).not.toContain('END');
    for (const p of patches) if (p.content) expect(p.content).toEqual(CONTENT);
  });

  it('is on read-only notes too (same element, no toggle)', async () => {
    note = makeNote({ readOnly: true });
    const editorEl = await openNote();
    expect(editorEl.classList.contains('note-body')).toBe(true);
    expect(editorEl.getAttribute('contenteditable')).toBe('false');
    expect(editorEl.textContent).not.toContain('END');
  });
});
