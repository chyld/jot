// @vitest-environment jsdom
// Type 7 (component): sections (sections-spec.md §2–§6). The left bar's section menu, the
// current section remembered in the browser and added to requests, the theme colours, the
// home page heading, the Sections page and its dialog, and the note's section control.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataProvider } from '../../src/client/data';
import { Sidebar } from '../../src/client/components/Sidebar';
import { NotesScreen } from '../../src/client/screens/NotesScreen';
import { NoteEditor } from '../../src/client/screens/NoteEditor';
import { SectionsScreen } from '../../src/client/screens/SectionsScreen';
import { TrashScreen } from '../../src/client/screens/TrashScreen';
import { FONTS } from './setup';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let sections: any[];
let note: any;
let handler: ((url: string, init: RequestInit) => Response | null) | null;
const calls: Array<{ url: string; method: string; body: any }> = [];
const KEY = 'jot.section.u1';
const accent = () => document.documentElement.style.getPropertyValue('--accent');

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  history.replaceState(null, '', '/');
  sections = [
    { id: 'default', name: 'Default', colour: 'olive', noteCount: 1, trashCount: 0 },
    { id: 'work', name: "Bob's Work", colour: 'blue', noteCount: 2, trashCount: 0 },
    { id: 'recipe', name: 'Recipes', colour: 'amber', noteCount: 0, trashCount: 2 },
  ];
  note = {
    id: 'n1', title: 'Plan', preview: '', tags: [], createdAt: '2026-11-19T10:00:00Z', updatedAt: '2026-11-19T10:00:00Z',
    deletedAt: null, readOnly: false, inbox: false, botName: null, section: 'work', content: { type: 'doc', content: [{ type: 'paragraph' }] },
  };
  handler = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({ url, method, body: init.body ? JSON.parse(init.body as string) : undefined });
      const h = handler?.(url, init);
      if (h) return h;
      if (url === '/api/fonts') return json({ fonts: FONTS });
      if (url === '/api/styles') return json({ styles: [] });
      if (url === '/api/inbox') return json({ notes: [] });
      if (url === '/api/sections') return json({ sections });
      if (url.startsWith('/api/notes?') || url.startsWith('/api/search?') || url.startsWith('/api/trash?')) return json({ notes: [] });
      if (url.startsWith('/api/tags?')) return json({ tags: [] });
      if (url.startsWith('/api/empty-notes?')) return json({ count: 0 });
      if (url === '/api/notes/n1' && method === 'GET') return json({ note });
      return json({ error: 'unexpected' }, 500);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const inApp = (ui: React.ReactNode) =>
  render(
    <DataProvider user={{ id: 'u1', username: 'alice' }} onLogout={() => {}}>
      {ui}
    </DataProvider>,
  );
const urls = (prefix: string) => calls.filter((c) => c.url.startsWith(prefix)).map((c) => c.url);

describe('the current section', () => {
  it('is Default when nothing is remembered; the page takes its colours', async () => {
    inApp(<NotesScreen tag={null} />);
    expect(await screen.findByRole('heading', { name: 'Default' })).toBeTruthy();
    await waitFor(() => expect(urls('/api/notes?')).toContain('/api/notes?section=default'));
    expect(accent()).toBe('#4d7c0f');
  });

  it('is remembered in the browser: the home page opens in it, with its name, colours and requests', async () => {
    localStorage.setItem(KEY, 'work');
    inApp(<NotesScreen tag={null} />);
    expect(await screen.findByRole('heading', { name: "Bob's Work" })).toBeTruthy();
    await waitFor(() => expect(accent()).toBe('#1d4ed8'));
    expect(urls('/api/notes?')).toContain('/api/notes?section=work');
    expect(urls('/api/tags?')).toContain('/api/tags?section=work');
    expect(urls('/api/empty-notes?')).toContain('/api/empty-notes?section=work');
  });

  it('a remembered section that no longer exists means Default', async () => {
    localStorage.setItem(KEY, 'gone');
    inApp(<NotesScreen tag={null} />);
    await waitFor(() => expect(urls('/api/notes?').at(-1)).toBe('/api/notes?section=default'));
    expect(screen.getByRole('heading', { name: 'Default' })).toBeTruthy();
  });

  it('logging out takes the colours back to Olive', async () => {
    localStorage.setItem(KEY, 'recipe');
    const r = inApp(<NotesScreen tag={null} />);
    await waitFor(() => expect(accent()).toBe('#b45309'));
    r.unmount();
    expect(accent()).toBe('');
  });

  it('the trash is the current section’s, and its heading says whose', async () => {
    localStorage.setItem(KEY, 'recipe');
    inApp(<TrashScreen />);
    await waitFor(() => expect(urls('/api/trash?')).toContain('/api/trash?section=recipe'));
    expect(await screen.findByRole('heading', { name: 'Trash — Recipes', level: 1 })).toBeTruthy();
  });
});

describe('the section menu in the left bar', () => {
  it('shows the first letter of the current section; choosing another makes it current and goes home', async () => {
    localStorage.setItem(KEY, 'work');
    history.replaceState(null, '', '/tags');
    inApp(<Sidebar path="/tags" />);
    const button = await screen.findByRole('button', { name: "Section: Bob's Work" });
    expect(button.textContent).toBe('B');
    await userEvent.click(button);
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem').map((i) => i.getAttribute('aria-label') ?? i.textContent);
    expect(items).toEqual(['Default', "Bob's Work (current section)", 'Recipes', 'Manage sections']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Recipes' }));
    expect(location.pathname).toBe('/');
    expect(localStorage.getItem(KEY)).toBe('recipe');
    await waitFor(() => expect(accent()).toBe('#b45309'));
    expect(screen.getByRole('button', { name: 'Section: Recipes' }).textContent).toBe('R');
  });

  it('Manage sections opens the Sections page', async () => {
    inApp(<Sidebar path="/" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Section: Default' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Manage sections' }));
    expect(location.pathname).toBe('/sections');
  });
});

describe('the Sections page', () => {
  it('shows one card per section with its name, ID, number of notes, Edit and Open or “Current section”', async () => {
    localStorage.setItem(KEY, 'work');
    inApp(<SectionsScreen />);
    const card = await screen.findByRole('listitem', { name: "Bob's Work" });
    expect(card.textContent).toContain('ID: work');
    expect(card.textContent).toContain('2 notes');
    expect(within(card).getByText('Current section')).toBeTruthy();
    expect((card as HTMLElement).style.getPropertyValue('--accent')).toBe('#1d4ed8'); // its own colours
    const other = screen.getByRole('listitem', { name: 'Recipes' });
    expect(other.textContent).toContain('0 notes');
    expect(within(other).queryByRole('button', { name: /delete/i })).toBeNull();
    await userEvent.click(within(other).getByRole('button', { name: 'Open Recipes' }));
    expect(localStorage.getItem(KEY)).toBe('recipe');
    expect(location.pathname).toBe('/');
  });

  it('each card has a Trash button with the number of its trashed notes, which opens that section’s trash', async () => {
    localStorage.setItem(KEY, 'work');
    inApp(<SectionsScreen />);
    const work = await screen.findByRole('listitem', { name: "Bob's Work" });
    // Beside Edit and Open, also on the current section's card, and shown when the trash is empty.
    expect(within(work).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Edit', 'Trash 0']);
    expect(within(work).getByRole('button', { name: "Trash of Bob's Work (0 notes)" })).toBeTruthy();
    const recipes = screen.getByRole('listitem', { name: 'Recipes' });
    expect(within(recipes).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Edit', 'Open', 'Trash 2']);
    expect(within(recipes).getByRole('button', { name: 'Trash of Recipes (2 notes)' }).querySelector('svg')).toBeTruthy(); // the trash-can icon
    await userEvent.click(within(recipes).getByRole('button', { name: /^Trash of Recipes/ }));
    expect(localStorage.getItem(KEY)).toBe('recipe');
    expect(location.pathname).toBe('/trash');
  });

  it('creates a section with name, ID and colour; errors are shown in the dialog', async () => {
    handler = (url, init) => {
      if (url !== '/api/sections' || init.method !== 'POST') return null;
      const b = JSON.parse(init.body as string);
      if (b.id === 'work') return json({ error: 'You already have a section with the ID "work".' }, 409);
      sections = [...sections, { ...b, noteCount: 0, trashCount: 0 }];
      return json({ section: { ...b, noteCount: 0, trashCount: 0 } }, 201);
    };
    inApp(<SectionsScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'New section' }));
    const dialog = screen.getByRole('dialog', { name: 'New section' });
    expect(dialog.textContent).toMatch(/cannot be changed later/);
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Travel');
    await userEvent.type(within(dialog).getByLabelText('ID'), 'my trips');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create section' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/letters a–z/);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.clear(within(dialog).getByLabelText('ID'));
    await userEvent.type(within(dialog).getByLabelText('ID'), 'work');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create section' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/already/);
    await userEvent.clear(within(dialog).getByLabelText('ID'));
    await userEvent.type(within(dialog).getByLabelText('ID'), 'Trips');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Teal' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create section' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.filter((c) => c.method === 'POST').at(-1)!.body).toEqual({ id: 'trips', name: 'Travel', colour: 'teal' });
    expect(await screen.findByRole('listitem', { name: 'Travel' })).toBeTruthy();
  });

  it('Edit changes the name and colour; the ID is fixed', async () => {
    handler = (url, init) => {
      if (url !== '/api/sections/recipe' || init.method !== 'PATCH') return null;
      const b = JSON.parse(init.body as string);
      sections = sections.map((s) => (s.id === 'recipe' ? { ...s, ...b } : s));
      return json({ section: sections[2] });
    };
    inApp(<SectionsScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Recipes' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Recipes' });
    const id = within(dialog).getByLabelText('ID') as HTMLInputElement;
    expect(id.value).toBe('recipe');
    expect(id.disabled).toBe(true);
    expect((within(dialog).getByRole('radio', { name: 'Amber' }) as HTMLElement).getAttribute('aria-checked')).toBe('true');
    await userEvent.clear(within(dialog).getByLabelText('Name'));
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Cooking');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Slate' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ name: 'Cooking', colour: 'slate' });
    expect(await screen.findByRole('listitem', { name: 'Cooking' })).toBeTruthy();
  });
});

describe('the note’s section', () => {
  const openNote = () => inApp(<NoteEditor noteId="n1" onTrashed={() => {}} />);

  it('opening a note makes its section current', async () => {
    openNote();
    expect(await screen.findByRole('button', { name: "Section: Bob's Work" })).toBeTruthy();
    await waitFor(() => expect(localStorage.getItem(KEY)).toBe('work'));
    await waitFor(() => expect(accent()).toBe('#1d4ed8'));
  });

  it('choosing another section moves the note, and the app follows it', async () => {
    handler = (url, init) => {
      if (url !== '/api/notes/n1/section' || init.method !== 'POST') return null;
      note = { ...note, section: JSON.parse(init.body as string).section };
      return json({ note });
    };
    openNote();
    await userEvent.click(await screen.findByRole('button', { name: "Section: Bob's Work" }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move to Recipes' }));
    expect(await screen.findByRole('button', { name: 'Section: Recipes' })).toBeTruthy();
    expect(calls.find((c) => c.url === '/api/notes/n1/section')!.body).toEqual({ section: 'recipe' });
    await waitFor(() => expect(localStorage.getItem(KEY)).toBe('recipe'));
    await waitFor(() => expect(accent()).toBe('#b45309'));
  });

  it('a read-only or trashed note shows its section but cannot be moved', async () => {
    note = { ...note, readOnly: true };
    const r = openNote();
    expect(((await screen.findByRole('button', { name: "Section: Bob's Work" })) as HTMLButtonElement).disabled).toBe(true);
    r.unmount();
    note = { ...note, readOnly: false, deletedAt: '2026-11-19T11:00:00Z' };
    openNote();
    expect(((await screen.findByRole('button', { name: "Section: Bob's Work" })) as HTMLButtonElement).disabled).toBe(true);
  });

  it('an Inbox note leaves the current section alone, and Keep says where the note will go', async () => {
    localStorage.setItem(KEY, 'recipe');
    note = { ...note, inbox: true, botName: 'Grok', section: 'default' };
    openNote();
    expect(await screen.findByRole('button', { name: /Keep in Recipes/ })).toBeTruthy();
    expect(localStorage.getItem(KEY)).toBe('recipe');
  });
});
