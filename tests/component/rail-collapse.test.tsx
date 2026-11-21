// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RailExpandButton, RailProvider, Sidebar } from '../../src/client/components/Sidebar';
import { DataProvider } from '../../src/client/data';
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
          <RailExpandButton />
        </header>
      </RailProvider>
    </DataProvider>,
  );
}

describe('collapsible left rail', () => {
  it('collapses via the rail button, shows the header expand button, and persists to localStorage', async () => {
    renderRail();
    const nav = document.querySelector('nav.rail') as HTMLElement;
    expect(nav.classList.contains('is-collapsed')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Expand sidebar' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(nav.classList.contains('is-collapsed')).toBe(true);
    expect(localStorage.getItem('jot.railCollapsed')).toBe('1');

    const expandBtn = screen.getByRole('button', { name: 'Expand sidebar' });
    await userEvent.click(expandBtn);
    expect(nav.classList.contains('is-collapsed')).toBe(false);
    expect(localStorage.getItem('jot.railCollapsed')).toBe('0');
    expect(screen.queryByRole('button', { name: 'Expand sidebar' })).toBeNull();
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
});
