// @vitest-environment jsdom
// Type 7 (component): the trash button on note cards in the notes list (with Undo), and
// the Tags screen with its counts and the in-page confirmation before a tag is deleted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataProvider } from '../../src/client/data';
import { NoteCard } from '../../src/client/components/NoteCard';
import { NotesScreen } from '../../src/client/screens/NotesScreen';
import { TagsScreen } from '../../src/client/screens/TagsScreen';
import './setup';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
let handler: Handler;
const calls: Array<{ url: string; method: string }> = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const changes = () => calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`);

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET' });
      return handler(url, init);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const inProvider = (ui: React.ReactNode) =>
  render(
    <DataProvider user={{ id: 'u1', username: 'alice' }} onLogout={() => {}}>
      {ui}
    </DataProvider>,
  );

const note = (id: string, title: string, readOnly = false) => ({
  id,
  title,
  preview: '',
  tags: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  deletedAt: null,
  inbox: false,
  botName: null,
  readOnly,
});

describe('note card trash button', () => {
  it('is shown when the list can trash notes, and calls back without opening the note', async () => {
    const onTrash = vi.fn();
    render(<NoteCard note={note('n1', 'Shopping')} now={new Date()} onTrash={onTrash} />);
    await userEvent.click(screen.getByRole('button', { name: 'Move Shopping to the trash' }));
    expect(onTrash).toHaveBeenCalledTimes(1);
    expect(location.pathname).not.toBe('/n/n1');
  });

  it('names an untitled note', () => {
    render(<NoteCard note={note('n1', '')} now={new Date()} onTrash={() => {}} />);
    expect(screen.getByRole('button', { name: 'Move Untitled to the trash' })).toBeTruthy();
  });

  it('is missing on a read-only note, which cannot be trashed', () => {
    render(<NoteCard note={note('n1', 'Fixed', true)} now={new Date()} onTrash={() => {}} />);
    expect(screen.queryByRole('button', { name: /to the trash/ })).toBeNull();
  });

  it('is missing where the list gives no trash action', () => {
    render(<NoteCard note={note('n1', 'Plain')} now={new Date()} />);
    expect(screen.queryByRole('button', { name: /to the trash/ })).toBeNull();
  });
});

describe('notes list', () => {
  let live: any[];
  beforeEach(() => {
    live = [note('a', 'Alpha'), note('b', 'Beta'), note('m', 'User manual', true)];
    let trashed: any[] = [];
    handler = (url, init) => {
      const method = init.method ?? 'GET';
      if (url === '/api/notes' && method === 'GET') return json({ notes: live });
      if (url === '/api/tags') return json({ tags: [] });
      if (url === '/api/inbox') return json({ notes: [] });
      if (url === '/api/fonts') return json({ fonts: [] });
      if (url === '/api/styles') return json({ styles: [] });
      const del = /^\/api\/notes\/(\w+)$/.exec(url);
      if (del && method === 'DELETE') {
        const n = live.find((x) => x.id === del[1]);
        live = live.filter((x) => x !== n);
        trashed.push(n);
        return json({ note: n });
      }
      const restore = /^\/api\/trash\/(\w+)\/restore$/.exec(url);
      if (restore && method === 'POST') {
        const n = trashed.find((x) => x.id === restore[1]);
        trashed = trashed.filter((x) => x !== n);
        live.push(n);
        return json({ note: n });
      }
      return json({ error: 'unexpected' }, 500);
    };
  });

  it('moves a note to the trash with one click, and Undo puts it back', async () => {
    inProvider(<NotesScreen tag={null} />);
    await screen.findByText('Alpha');
    await userEvent.click(screen.getByRole('button', { name: 'Move Alpha to the trash' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Alpha' })).toBeNull());
    expect(changes()).toEqual(['DELETE /api/notes/a']);
    const undo = screen.getByTestId('trash-undo');
    expect(undo.textContent).toMatch(/Moved “Alpha” to the trash/);

    await userEvent.click(within(undo).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByRole('article', { name: 'Alpha' })).toBeTruthy());
    expect(changes()).toEqual(['DELETE /api/notes/a', 'POST /api/trash/a/restore']);
    expect(screen.queryByTestId('trash-undo')).toBeNull();
  });

  it('has no trash button on the read-only note', async () => {
    inProvider(<NotesScreen tag={null} />);
    const manual = await screen.findByRole('article', { name: 'User manual' });
    expect(within(manual).queryByRole('button')).toBeNull();
    expect(within(screen.getByRole('article', { name: 'Beta' })).getByRole('button', { name: 'Move Beta to the trash' })).toBeTruthy();
  });
});

describe('Tags screen', () => {
  let tags: Array<{ name: string; count: number }>;
  let refuse: boolean;
  beforeEach(() => {
    tags = [
      { name: 'home', count: 2 },
      { name: 'manual', count: 1 },
      { name: 'work', count: 12 },
    ];
    refuse = false;
    handler = (url, init) => {
      const method = init.method ?? 'GET';
      if (url === '/api/tags' && method === 'GET') return json({ tags });
      if (url === '/api/inbox') return json({ notes: [] });
      if (url === '/api/fonts') return json({ fonts: [] });
      if (url === '/api/styles') return json({ styles: [] });
      const del = /^\/api\/tags\/(\w+)$/.exec(url);
      if (del && method === 'DELETE') {
        if (refuse) return json({ error: 'This tag cannot be deleted: a read-only note has it, and read-only notes cannot be changed.' }, 409);
        const t = tags.find((x) => x.name === del[1])!;
        tags = tags.filter((x) => x !== t);
        return json({ tag: t.name, removedFrom: t.count });
      }
      return json({ error: 'unexpected' }, 500);
    };
  });

  const item = (name: string) => screen.getByRole('listitem', { name: `#${name}` });

  it('lists every tag with its number of notes', async () => {
    inProvider(<TagsScreen />);
    await screen.findByText('#work');
    expect(screen.getByText('3 tags')).toBeTruthy();
    expect(within(item('home')).getByTestId('tag-count').textContent).toBe('2 notes');
    expect(within(item('manual')).getByTestId('tag-count').textContent).toBe('1 note');
    expect(within(item('work')).getByTestId('tag-count').textContent).toBe('12 notes');
    expect(within(item('work')).getByRole('link', { name: '#work' }).getAttribute('href')).toBe('/?tag=work');
  });

  it('deletes a tag only after a confirmation that says the notes are kept', async () => {
    inProvider(<TagsScreen />);
    await screen.findByText('#work');
    await userEvent.click(screen.getByRole('button', { name: 'Delete tag work' }));
    expect(changes()).toEqual([]);
    const confirm = screen.getByRole('group', { name: 'Delete tag work' });
    expect(confirm.textContent).toMatch(/#work will be removed from every note that has it \(12 notes/);
    expect(confirm.textContent).toMatch(/The notes are kept/);

    await userEvent.click(within(confirm).getByRole('button', { name: 'Confirm: delete tag' }));
    await waitFor(() => expect(screen.queryByText('#work')).toBeNull());
    expect(changes()).toEqual(['DELETE /api/tags/work']);
    expect(screen.getByText('2 tags')).toBeTruthy();
    expect(screen.getByText('#home')).toBeTruthy();
  });

  it('can be cancelled', async () => {
    inProvider(<TagsScreen />);
    await screen.findByText('#home');
    await userEvent.click(screen.getByRole('button', { name: 'Delete tag home' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(changes()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Delete tag home' })).toBeTruthy();
    expect(screen.getByText('#home')).toBeTruthy();
  });

  it('shows why a tag on a read-only note cannot be deleted, and keeps it', async () => {
    refuse = true;
    inProvider(<TagsScreen />);
    await screen.findByText('#manual');
    await userEvent.click(screen.getByRole('button', { name: 'Delete tag manual' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm: delete tag' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/read-only/);
    expect(screen.getByText('#manual')).toBeTruthy();
  });

  it('says so when there are no tags', async () => {
    tags = [];
    inProvider(<TagsScreen />);
    expect(await screen.findByText(/No tags yet/)).toBeTruthy();
  });
});
