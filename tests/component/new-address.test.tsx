// @vitest-environment jsdom
// Type 7 (component): the bookmarkable /new address, rendered from the real App inside
// React StrictMode (which runs effects twice) with the API answered by a stubbed fetch.
// It creates exactly one note, replaces /new with the note's address, keeps /new through
// the login page, and offers Try again when the create fails.
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/client/App';
import { FONTS } from './setup';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const user = { id: 'u1', username: 'alice' };
const note = {
  id: 'n1',
  title: '',
  preview: '',
  tags: [],
  createdAt: '2026-11-19T10:00:00Z',
  updatedAt: '2026-11-19T10:00:00Z',
  deletedAt: null,
  readOnly: false,
  inbox: false,
  botName: null,
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
};
let loggedIn: boolean;
let failCreates: number;
let creates: number;

beforeEach(() => {
  loggedIn = true;
  failCreates = 0;
  creates = 0;
  history.replaceState(null, '', '/new');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      if (url === '/api/me') return loggedIn ? json({ user }) : json({ error: 'Not logged in.' }, 401);
      if (url === '/api/login') {
        loggedIn = true;
        return json({ user });
      }
      if (url === '/api/fonts') return json({ fonts: FONTS });
      if (url === '/api/styles') return json({ styles: [] });
      if (url === '/api/inbox') return json({ notes: [] });
      if (url === '/api/notes' && method === 'POST') {
        creates++;
        if (failCreates > 0) {
          failCreates--;
          return json({ error: 'The disk is full.' }, 500);
        }
        return json({ note });
      }
      if (url === '/api/notes/n1' && method === 'GET') return json({ note });
      if (url === '/api/notes/n1' && method === 'PATCH') return json({ note });
      return json({ error: 'unexpected' }, 500);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const renderApp = () =>
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

/** On the new note's address with its editor open. The editor taking the new note also
 *  releases the in-flight guard kept in newNotes.ts, which the next test needs. */
async function opened() {
  await waitFor(() => expect(location.pathname).toBe('/n/n1'));
  await waitFor(() => expect(document.querySelector('article[data-note-id="n1"] .note-body')).not.toBeNull());
}

describe('the /new address', () => {
  it('creates exactly one note under StrictMode and replaces /new with the note’s address', async () => {
    const pushes = vi.spyOn(history, 'pushState');
    const length = history.length;
    renderApp();
    await opened();
    expect(creates).toBe(1);
    expect(pushes).not.toHaveBeenCalled();
    expect(history.length).toBe(length); // replaced, not added: Back never returns to /new
    pushes.mockRestore();
  });

  it('shows “Creating note…” while the note is being made', async () => {
    renderApp();
    expect(await screen.findByText('Creating note…')).toBeTruthy();
    await opened();
  });

  it('when logged out, keeps /new through the login page and creates the note after logging in', async () => {
    loggedIn = false;
    renderApp();
    await waitFor(() => expect(location.pathname + location.search).toBe('/login?next=%2Fnew'));
    await screen.findByRole('button', { name: 'Log in' });
    expect(creates).toBe(0);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await opened();
    expect(creates).toBe(1);
  });

  it('after login ignores any other next address (no open redirect)', async () => {
    for (const next of ['//evil.example', 'https://evil.example/new', '/account', '/new/x']) {
      history.replaceState(null, '', `/login?next=${encodeURIComponent(next)}`);
      const view = renderApp();
      await waitFor(() => expect(location.pathname).toBe('/'));
      view.unmount();
    }
    expect(creates).toBe(0);
  });

  it('shows the error when the create fails, and Try again creates the note', async () => {
    failCreates = 1;
    renderApp();
    expect((await screen.findByRole('alert')).textContent).toBe('The disk is full.');
    expect(location.pathname).toBe('/new');
    expect(creates).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await opened();
    expect(creates).toBe(2);
  });
});
