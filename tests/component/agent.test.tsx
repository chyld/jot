// @vitest-environment jsdom
// Type 7 (component): the Bots section of the Account page, the Inbox screen and its
// left-bar count, and the bot's name on note cards (agent-spec.md §2, §3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataProvider } from '../../src/client/data';
import { AccountScreen } from '../../src/client/screens/AccountScreen';
import { InboxScreen } from '../../src/client/screens/InboxScreen';
import { Sidebar } from '../../src/client/components/Sidebar';
import { NoteCard } from '../../src/client/components/NoteCard';
import './setup';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
let handler: Handler;
const calls: Array<{ url: string; method: string; body: unknown }> = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const writeText = vi.fn(async (_t: string) => {});

beforeEach(() => {
  calls.length = 0;
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body });
      return handler(url, init);
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
const note = (id: string, title: string, extra: object = {}) => ({
  id, title, preview: 'preview', tags: [], createdAt: '2026-11-19T10:00:00Z', updatedAt: '2026-11-19T10:00:00Z', deletedAt: null, readOnly: false, inbox: true, botName: 'Grok', ...extra,
});
const common = (url: string) => {
  if (url === '/api/fonts') return json({ fonts: [] });
  if (url === '/api/styles') return json({ styles: [] });
  if (url === '/api/safety-backups') return json({ backups: [] });
  return null;
};

describe('Bots on the Account page', () => {
  let bots: any[];
  beforeEach(() => {
    bots = [{ id: 'b1', name: 'Grok', token: 'jot_' + 'g'.repeat(43), createdAt: '2026-11-19T09:00:00Z', lastUsedAt: null }];
    handler = (url, init) => {
      const c = common(url);
      if (c) return c;
      const m = init.method ?? 'GET';
      if (url === '/api/inbox') return json({ notes: [] });
      if (url === '/api/bots' && m === 'GET') return json({ publicUrl: 'https://jot.example.org', mcpUrl: 'https://jot.example.org/mcp', bots });
      if (url === '/api/bots' && m === 'POST') {
        const name = JSON.parse(init.body as string).name;
        if (bots.some((b) => b.name === name)) return json({ error: 'You already have a bot with that name.' }, 409);
        const bot = { id: 'b2', name, token: 'jot_' + 'c'.repeat(43), createdAt: '2026-11-19T11:00:00Z', lastUsedAt: null };
        bots = [...bots, bot];
        return json({ bot }, 201);
      }
      if (url === '/api/bots/b1' && m === 'DELETE') {
        bots = bots.filter((b) => b.id !== 'b1');
        return new Response(null, { status: 204 });
      }
      return json({ error: 'unexpected' }, 500);
    };
  });

  it('shows the address, each token with Copy, last used and Revoke, and a setup snippet', async () => {
    inApp(<AccountScreen />);
    const region = await screen.findByRole('region', { name: 'Bots' });
    await waitFor(() => expect(within(region).getByText('Grok')).toBeTruthy());
    expect(region.textContent).toContain('https://jot.example.org/mcp');
    expect(within(region).getByTestId('bot-token').textContent).toBe('jot_' + 'g'.repeat(43));
    expect(region.textContent).toMatch(/last used: never/i);
    expect(region.textContent).toMatch(/Authorization/);
    expect(region.textContent).toMatch(/Bearer/);
    await userEvent.click(within(region).getByRole('button', { name: 'Copy token for Grok' }));
    expect(writeText).toHaveBeenLastCalledWith('jot_' + 'g'.repeat(43));
    await userEvent.click(within(region).getByRole('button', { name: 'Copy setup for Grok' }));
    const snippet = writeText.mock.calls.at(-1)![0];
    expect(snippet).toContain('https://jot.example.org/mcp');
    expect(snippet).toContain(`Bearer jot_${'g'.repeat(43)}`);
    await userEvent.click(within(region).getByRole('button', { name: 'Copy address' }));
    expect(writeText).toHaveBeenLastCalledWith('https://jot.example.org/mcp');
  });

  it('creates a bot by name; a duplicate name shows the message', async () => {
    inApp(<AccountScreen />);
    const region = await screen.findByRole('region', { name: 'Bots' });
    await userEvent.type(within(region).getByLabelText('Bot name'), 'Claude');
    await userEvent.click(within(region).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(within(region).getByText('Claude')).toBeTruthy());
    expect(JSON.parse(calls.find((c) => c.url === '/api/bots' && c.method === 'POST')!.body as string)).toEqual({ name: 'Claude' });
    expect(within(region).getAllByTestId('bot-token').map((t) => t.textContent)).toContain('jot_' + 'c'.repeat(43));
    await userEvent.type(within(region).getByLabelText('Bot name'), 'Grok');
    await userEvent.click(within(region).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(within(region).getByRole('alert').textContent).toMatch(/already/));
  });

  it('revokes only after a second click', async () => {
    inApp(<AccountScreen />);
    const region = await screen.findByRole('region', { name: 'Bots' });
    await waitFor(() => within(region).getByText('Grok'));
    await userEvent.click(within(region).getByRole('button', { name: 'Revoke Grok' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(within(region).getByRole('button', { name: 'Confirm: revoke Grok' }));
    await waitFor(() => expect(within(region).queryByText('Grok')).toBeNull());
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/api/bots/b1']);
  });
});

describe('Inbox', () => {
  let inbox: any[];
  beforeEach(() => {
    inbox = [note('n1', 'From the bot'), note('n2', 'Another', { botName: 'Claude' })];
    handler = (url, init) => {
      const c = common(url);
      if (c) return c;
      if (url === '/api/inbox') return json({ notes: inbox });
      if (url === '/api/notes/n1/keep' && init.method === 'POST') {
        const kept = { ...inbox[0], inbox: false };
        inbox = inbox.slice(1);
        return json({ note: kept });
      }
      return json({ error: 'unexpected' }, 500);
    };
  });

  it('the left bar shows the Inbox with the number of notes in it', async () => {
    inApp(<Sidebar path="/" />);
    const link = screen.getByRole('link', { name: /^Inbox/ });
    expect(link.getAttribute('href')).toBe('/inbox');
    await waitFor(() => expect(within(link).getByTestId('inbox-count').textContent).toBe('2'));
    const labels = screen.getAllByRole('link').map((a) => a.getAttribute('aria-label'));
    expect(labels.indexOf('Inbox')).toBe(1); // right after the home logo
  });

  it('lists Inbox notes with their bot’s name; Keep moves one out', async () => {
    inApp(<InboxScreen />);
    expect(screen.getByRole('heading', { name: 'Inbox', level: 1 })).toBeTruthy();
    const card = await screen.findByRole('article', { name: 'From the bot' });
    expect(within(card).getByTestId('note-bot').textContent).toMatch(/Grok/);
    expect(within(screen.getByRole('article', { name: 'Another' })).getByTestId('note-bot').textContent).toMatch(/Claude/);
    await userEvent.click(screen.getByRole('button', { name: 'Keep From the bot' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'From the bot' })).toBeNull());
    expect(calls.some((c) => c.url === '/api/notes/n1/keep' && c.method === 'POST')).toBe(true);
  });

  it('says so when it is empty', async () => {
    inbox = [];
    inApp(<InboxScreen />);
    expect(await screen.findByText(/The Inbox is empty/)).toBeTruthy();
  });

  it('a note card shows the bot’s name, also after it was kept', () => {
    render(<NoteCard note={note('n3', 'Kept one', { inbox: false, botName: 'Grok' }) as any} now={new Date()} />);
    expect(screen.getByTestId('note-bot').textContent).toMatch(/Grok/);
    render(<NoteCard note={note('n4', 'Mine', { inbox: false, botName: null }) as any} now={new Date()} />);
    expect(screen.getAllByTestId('note-bot').length).toBe(1);
  });
});

void fireEvent;
