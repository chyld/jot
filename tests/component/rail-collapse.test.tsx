// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RailProvider, RailToggleButton, Sidebar } from '../../src/client/components/Sidebar';
import { DataProvider } from '../../src/client/data';
import { NoteEditor } from '../../src/client/screens/NoteEditor';
import { FONTS } from './setup';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/fonts') return json({ fonts: FONTS });
      if (url === '/api/styles') return json({ styles: [] });
      if (url === '/api/inbox') return json({ notes: [] });
      if (url === '/api/sections') return json({ sections: [{ id: 'general', name: 'General', theme: 'olive', sortOrder: 0, noteCount: 0 }] });
      if (url === '/api/notes?section=general') return json({ notes: [] });
      if (url === '/api/notes/note-1') {
        return json({
          note: {
            id: 'note-1',
            title: 'Test',
            preview: '',
            tags: [],
            createdAt: '2026-11-21T10:00:00Z',
            updatedAt: '2026-11-21T10:00:00Z',
            deletedAt: null,
            readOnly: false,
            inbox: false,
            botName: null,
            section: 'general',
            content: { type: 'doc', content: [{ type: 'paragraph' }] },
          },
        });
      }
      return json({ error: 'unexpected' }, 500);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderRail() {
  return render(
    <DataProvider user={{ id: 'u1', username: 'bob' }} onLogout={() => {}}>
      <RailProvider>
        <Sidebar path="/n/note-1" />
        <header className="note-header">
          <RailToggleButton />
          <input className="note-title" aria-label="Title" defaultValue="Test" />
        </header>
      </RailProvider>
    </DataProvider>,
  );
}

describe('collapsible left rail', () => {
  it('toggles from the button left of the title and persists to localStorage', async () => {
    renderRail();
    const nav = document.querySelector('nav.rail') as HTMLElement;
    const header = document.querySelector('header.note-header') as HTMLElement;
    expect(nav.classList.contains('is-collapsed')).toBe(false);
    expect(within(nav).queryByRole('button', { name: 'Collapse sidebar' })).toBeNull();

    const collapseBtn = within(header).getByRole('button', { name: 'Collapse sidebar' });
    const title = within(header).getByLabelText('Title');
    expect(collapseBtn.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(collapseBtn);
    expect(nav.classList.contains('is-collapsed')).toBe(true);
    expect(localStorage.getItem('jot.railCollapsed')).toBe('1');

    const expandBtn = within(header).getByRole('button', { name: 'Expand sidebar' });
    await userEvent.click(expandBtn);
    expect(nav.classList.contains('is-collapsed')).toBe(false);
    expect(localStorage.getItem('jot.railCollapsed')).toBe('0');
    expect(within(header).getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
  });

  it('restores collapsed state from localStorage and toggles with Ctrl+\\', () => {
    localStorage.setItem('jot.railCollapsed', '1');
    renderRail();
    const nav = document.querySelector('nav.rail') as HTMLElement;
    expect(nav.classList.contains('is-collapsed')).toBe(true);
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();

    fireEvent.keyDown(window, { key: '\\', ctrlKey: true });
    expect(nav.classList.contains('is-collapsed')).toBe(false);
    expect(localStorage.getItem('jot.railCollapsed')).toBe('0');

    fireEvent.keyDown(window, { key: '\\', ctrlKey: true });
    expect(nav.classList.contains('is-collapsed')).toBe(true);
    expect(localStorage.getItem('jot.railCollapsed')).toBe('1');
  });

  it('places the New note (+) button right of the collapse button and left of the title in NoteEditor', async () => {
    render(
      <DataProvider user={{ id: 'u1', username: 'bob' }} onLogout={() => {}}>
        <RailProvider>
          <NoteEditor noteId="note-1" onTrashed={() => {}} />
        </RailProvider>
      </DataProvider>,
    );
    await screen.findByLabelText('Note status');
    const header = document.querySelector('header.note-header') as HTMLElement;
    const collapseBtn = within(header).getByRole('button', { name: 'Collapse sidebar' });
    const newBtn = within(header).getByRole('button', { name: 'New note' });
    const title = within(header).getByLabelText('Title');
    expect(collapseBtn.compareDocumentPosition(newBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(newBtn.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
