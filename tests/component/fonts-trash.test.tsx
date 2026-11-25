// @vitest-environment jsdom
// Type 7 (component): default fonts have no Archive action on the Fonts screen; default
// styles have no Edit or Delete on the Styles screen; the
// Trash screen's Empty trash button and its in-page confirmation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataProvider } from '../../src/client/data';
import { FontsScreen } from '../../src/client/screens/FontsScreen';
import { StylesScreen } from '../../src/client/screens/StylesScreen';
import { TrashScreen } from '../../src/client/screens/TrashScreen';
import './setup';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
let handler: Handler;
const calls: Array<{ url: string; method: string }> = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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

const font = (family: string, archived = false) => ({ id: `f-${family}`, family, category: 'Serif', archived, isDefault: ['Inter', 'Lora', 'Playfair Display', 'Caveat', 'Fira Code'].includes(family), createdAt: '2026-01-01T00:00:00Z' });

const inProvider = (ui: React.ReactNode) =>
  render(
    <DataProvider user={{ id: 'u1', username: 'alice' }} onLogout={() => {}}>
      {ui}
    </DataProvider>,
  );

describe('Fonts screen', () => {
  beforeEach(() => {
    const fonts = [font('Inter'), font('Lora'), font('Roboto Slab'), font('Caveat', true), font('Bebas Neue', true)];
    handler = (url) => {
      if (url === '/api/fonts') return json({ fonts });
      if (url === '/api/styles') return json({ styles: [] });
      if (url === '/api/fonts/catalog') return json({ fonts: [{ family: 'Inter', category: 'Sans Serif' }, { family: 'Roboto Slab', category: 'Serif' }] });
      return json({ error: 'unexpected' }, 500);
    };
  });

  it('shows no Archive action for default fonts, and a Default font note instead', async () => {
    inProvider(<FontsScreen />);
    const mine = screen.getByRole('region', { name: 'Your fonts' });
    await waitFor(() => expect(mine.textContent).toContain('Roboto Slab'));
    expect(within(mine).queryByRole('button', { name: 'Archive Inter' })).toBeNull();
    expect(within(mine).queryByRole('button', { name: 'Archive Lora' })).toBeNull();
    expect(within(mine).getByRole('button', { name: 'Archive Roboto Slab' })).toBeTruthy();
    const inter = within(mine).getByText('Inter').closest('li')!;
    expect(inter.textContent).toMatch(/default font/i);
    // An already archived default font can be restored, like any other.
    expect(within(mine).getByRole('button', { name: 'Restore Caveat' })).toBeTruthy();
    expect(within(mine).getByRole('button', { name: 'Restore Bebas Neue' })).toBeTruthy();
    // The catalogue card of a default font has no Archive button either.
    const card = await screen.findByRole('article', { name: 'Inter' });
    expect(within(card).queryByRole('button', { name: /Archive/ })).toBeNull();
    expect(card.textContent).toMatch(/default font/i);
    expect(within(await screen.findByRole('article', { name: 'Roboto Slab' })).getByRole('button', { name: /Archive/ })).toBeTruthy();
  });

  it('lists user-added fonts above default fonts, and keeps an empty notice when none are added', async () => {
    inProvider(<FontsScreen />);
    await waitFor(() => expect(screen.getByTestId('custom-fonts').textContent).toContain('Roboto Slab'));
    const custom = screen.getByTestId('custom-fonts');
    const defaults = screen.getByTestId('default-fonts');
    expect(custom.compareDocumentPosition(defaults) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(custom.textContent).toContain('Roboto Slab');
    expect(custom.textContent).not.toContain('Inter');
    expect(defaults.textContent).toContain('Inter');
    expect(defaults.textContent).toContain('Lora');
    expect(defaults.textContent).not.toContain('Roboto Slab');
  });

  it('keeps the Your fonts section visible with an empty notice when only default fonts exist', async () => {
    handler = (url) => {
      if (url === '/api/fonts') return json({ fonts: [font('Inter'), font('Lora')] });
      if (url === '/api/styles') return json({ styles: [] });
      if (url === '/api/fonts/catalog') return json({ fonts: [{ family: 'Inter', category: 'Sans Serif' }] });
      return json({ error: 'unexpected' }, 500);
    };
    inProvider(<FontsScreen />);
    await waitFor(() => expect(screen.getByTestId('default-fonts').textContent).toContain('Inter'));
    expect(screen.getByTestId('custom-fonts').textContent).toMatch(/No custom fonts added yet/i);
  });
});

describe('Trash screen', () => {
  const note = (id: string, title: string) => ({ id, title, preview: '', tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', deletedAt: '2026-01-02T00:00:00Z' });
  let trash: any[];
  beforeEach(() => {
    trash = [note('a', 'One'), note('b', 'Two'), note('c', 'Three')];
    handler = (url, init) => {
      if (url === '/api/trash?section=default' && (init.method ?? 'GET') === 'GET') return json({ notes: trash });
      if (url === '/api/trash?section=default' && init.method === 'DELETE') {
        const n = trash.length;
        trash = [];
        return json({ deleted: n });
      }
      if (url === '/api/fonts') return json({ fonts: [] });
      if (url === '/api/styles') return json({ styles: [] });
      return json({ error: 'unexpected' }, 500);
    };
  });

  it('empties the trash after a second click that says how many notes and that it cannot be undone', async () => {
    inProvider(<TrashScreen />);
    await screen.findByText('Three');
    await userEvent.click(screen.getByRole('button', { name: 'Empty trash' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(screen.getByText(/3 notes will be deleted forever.*cannot be undone/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm: empty trash' }));
    await waitFor(() => expect(screen.getByText('The trash is empty.')).toBeTruthy());
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/api/trash?section=default']);
    expect(screen.queryByRole('button', { name: 'Empty trash' })).toBeNull();
  });

  it('can be cancelled', async () => {
    inProvider(<TrashScreen />);
    await screen.findByText('One');
    await userEvent.click(screen.getByRole('button', { name: 'Empty trash' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Empty trash' })).toBeTruthy();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(screen.getByText('One')).toBeTruthy();
  });

  it('says "1 note" for a single note', async () => {
    trash = [note('a', 'Only')];
    inProvider(<TrashScreen />);
    await screen.findByText('Only');
    await userEvent.click(screen.getByRole('button', { name: 'Empty trash' }));
    expect(screen.getByText(/1 note will be deleted forever/i)).toBeTruthy();
  });

  it('shows no Empty trash button when the trash is empty', async () => {
    trash = [];
    inProvider(<TrashScreen />);
    await screen.findByText('The trash is empty.');
    expect(screen.queryByRole('button', { name: 'Empty trash' })).toBeNull();
  });
});

describe('Styles screen', () => {
  const style = (name: string, isDefault: boolean) => ({
    id: `s-${name}-${isDefault}`, name, fontId: 'f-Inter', fontFamily: 'Inter', fontArchived: false, size: 16, bold: false, italic: false,
    underline: false, strike: false, textColor: null, highlight: null, isDefault, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  });
  beforeEach(() => {
    handler = (url) => {
      if (url === '/api/fonts') return json({ fonts: [font('Inter')] });
      if (url === '/api/styles') return json({ styles: [style('Body', true), style('Quote', true), style('Body', false), style('Mine', false)] });
      return json({ error: 'unexpected' }, 500);
    };
  });

  it('shows a Default style note instead of Edit and Delete on default styles only', async () => {
    inProvider(<StylesScreen />);
    await waitFor(() => expect(screen.getAllByTestId('style-card').length).toBe(4));
    const cards = screen.getAllByTestId('style-card');
    const defaults = cards.filter((c) => c.textContent!.includes('Default style'));
    expect(defaults.map((c) => c.getAttribute('aria-label')).sort()).toEqual(['Style Body', 'Style Quote']);
    for (const c of defaults) {
      expect(within(c).queryByRole('button', { name: /Edit/ })).toBeNull();
      expect(within(c).queryByRole('button', { name: /Delete/ })).toBeNull();
    }
    const own = cards.filter((c) => !c.textContent!.includes('Default style'));
    expect(own.map((c) => c.getAttribute('aria-label')).sort()).toEqual(['Style Body', 'Style Mine']);
    for (const c of own) {
      expect(within(c).getByRole('button', { name: /Edit/ })).toBeTruthy();
      expect(within(c).getByRole('button', { name: /Delete/ })).toBeTruthy();
    }
    const customSec = screen.getByTestId('custom-styles');
    const defaultSec = screen.getByTestId('default-styles');
    expect(customSec.compareDocumentPosition(defaultSec) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(customSec).getAllByTestId('style-card').map((c) => c.getAttribute('aria-label'))).toEqual(['Style Body', 'Style Mine']);
    expect(within(defaultSec).getAllByTestId('style-card').map((c) => c.getAttribute('aria-label'))).toEqual(['Style Body', 'Style Quote']);
  });

  it('keeps the Your styles section visible with an empty notice when only default styles exist', async () => {
    handler = (url) => {
      if (url === '/api/fonts') return json({ fonts: [font('Inter')] });
      if (url === '/api/styles') return json({ styles: [style('Body', true), style('Quote', true)] });
      return json({ error: 'unexpected' }, 500);
    };
    inProvider(<StylesScreen />);
    await waitFor(() => expect(screen.getAllByTestId('style-card').length).toBe(2));
    expect(screen.getByTestId('custom-styles').textContent).toMatch(/No custom styles yet/i);
    expect(within(screen.getByTestId('default-styles')).getAllByTestId('style-card')).toHaveLength(2);
  });
});
