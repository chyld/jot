// @vitest-environment jsdom
// Type 7 (component): the Backup screen, the Backup item in the left bar, and unsaved
// edits kept in the browser until the server confirms them (backup-spec.md §3.1, §5).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAutosave } from '../../src/client/autosave';
import { BackupScreen } from '../../src/client/screens/BackupScreen';
import { Sidebar } from '../../src/client/components/Sidebar';
import { DataProvider, useData } from '../../src/client/data';
import { clearAllUnsaved, loadUnsaved, resumeUnsaved, storeUnsaved, unsavedKey } from '../../src/client/unsaved';
import './setup';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
let handler: Handler;
const calls: Array<{ url: string; method: string; body: unknown; headers: Record<string, string> }> = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  for (const u of ['alice', 'bob']) resumeUnsaved(u);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body, headers: (init.headers as Record<string, string>) ?? {} });
      return handler(url, init);
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const NOTE = { id: 'n1', title: 'T', preview: '', tags: [], createdAt: '', updatedAt: '', deletedAt: null, content: { type: 'doc' } };

describe('unsaved edits', () => {
  it('are kept in this browser until the server confirms them, with automatic retries', async () => {
    vi.useFakeTimers();
    let fail = 2;
    handler = () => (fail-- > 0 ? json({ error: 'Something went wrong.' }, 500) : json({ note: NOTE }));
    const onSaved = vi.fn();
    const { result } = renderHook(() => useAutosave('n1', onSaved, 'alice'));
    act(() => result.current.schedule({ title: 'typed' }));
    expect(loadUnsaved('alice', 'n1')).toEqual({ title: 'typed' });
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/not saved/i);
    expect(loadUnsaved('alice', 'n1')).toEqual({ title: 'typed' });
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(calls.filter((c) => c.method === 'PATCH').length).toBe(3);
    expect(result.current.status).toBe('saved');
    expect(result.current.error).toBeNull();
    expect(loadUnsaved('alice', 'n1')).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('also retry after a network failure or while a restore is running', async () => {
    vi.useFakeTimers();
    const answers: Array<() => Response | Promise<Response>> = [
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => json({ error: 'A restore of your data is in progress.', code: 'restore-in-progress' }, 409),
      () => json({ note: NOTE }),
    ];
    handler = () => answers.shift()!();
    const { result } = renderHook(() => useAutosave('n1', () => {}, 'alice'));
    act(() => result.current.schedule({ title: 'x' }));
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(result.current.status).toBe('saved');
    expect(calls.length).toBe(3);
  });

  it('come back after a reload and are saved', async () => {
    vi.useFakeTimers();
    storeUnsaved('alice', 'n1', { title: 'from before the reload', content: { type: 'doc' } });
    handler = () => json({ note: NOTE });
    const { result } = renderHook(() => useAutosave('n1', () => {}, 'alice'));
    expect(result.current.restored).toEqual({ title: 'from before the reload', content: { type: 'doc' } });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(JSON.parse(patch.body as string)).toEqual({ title: 'from before the reload', content: { type: 'doc' } });
    expect(loadUnsaved('alice', 'n1')).toBeNull();
  });

  it('of one user are never shown to another', async () => {
    storeUnsaved('alice', 'n1', { title: 'alice private draft' });
    handler = () => json({ note: NOTE });
    const { result } = renderHook(() => useAutosave('n1', () => {}, 'bob'));
    expect(result.current.restored).toBeNull();
    expect(Object.keys(localStorage)).toEqual([unsavedKey('alice', 'n1')]);
  });

  it('are not retried when the note no longer exists, and the warning says so', async () => {
    vi.useFakeTimers();
    handler = () => json({ error: 'Note not found.' }, 404);
    const { result } = renderHook(() => useAutosave('n1', () => {}, 'alice'));
    act(() => result.current.schedule({ title: 'old tab text' }));
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(calls.length).toBe(1);
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/no longer exists/i);
    expect(loadUnsaved('alice', 'n1')).toEqual({ title: 'old tab text' });
  });

  it('are cleared at logout, for that user only', async () => {
    storeUnsaved('alice', 'n1', { title: 'a' });
    storeUnsaved('alice', 'n2', { title: 'b' });
    storeUnsaved('bob', 'n3', { title: 'c' });

    handler = (url) => (url.includes('fonts') ? json({ fonts: [] }) : url.includes('styles') ? json({ styles: [] }) : new Response(null, { status: 204 }));
    function LogoutButton() {
      const { logout } = useData();
      return <button onClick={() => void logout()}>out</button>;
    }
    const onLogout = vi.fn();
    render(
      <DataProvider user={{ id: 'alice', username: 'alice' }} onLogout={onLogout}>
        <LogoutButton />
      </DataProvider>,
    );
    await userEvent.click(screen.getByText('out'));
    await waitFor(() => expect(onLogout).toHaveBeenCalled());
    expect(loadUnsaved('alice', 'n1')).toBeNull();
    expect(loadUnsaved('alice', 'n2')).toBeNull();
    expect(loadUnsaved('bob', 'n3')).toEqual({ title: 'c' });
  });

  it('do not come back when the editor’s last save fails after logout', async () => {
    vi.useFakeTimers();
    handler = (url) => (url === '/api/logout' ? new Response(null, { status: 204 }) : json({ error: 'Not logged in.' }, 401));
    const { result, unmount } = renderHook(() => useAutosave('n1', () => {}, 'alice'));
    act(() => result.current.schedule({ title: 'typed just before logout' }));
    clearAllUnsaved('alice'); // logout
    unmount(); // the editor closes and tries one last save, which fails
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
    expect(loadUnsaved('alice', 'n1')).toBeNull();
    // Logging in again keeps edits again.
    resumeUnsaved('alice');
    storeUnsaved('alice', 'n1', { title: 'x' });
    expect(loadUnsaved('alice', 'n1')).toEqual({ title: 'x' });
  });
});

describe('left bar', () => {
  it('has a Backup item above Trash', () => {
    handler = (url) => (url.includes('fonts') ? json({ fonts: [] }) : json({ styles: [] }));
    render(
      <DataProvider user={{ id: 'u', username: 'alice' }} onLogout={() => {}}>
        <Sidebar path="/backup" />
      </DataProvider>,
    );
    const labels = screen.getAllByRole('link').map((a) => a.getAttribute('aria-label'));
    expect(labels).toEqual(['Jot home: all notes', 'Fonts', 'Styles', 'Backup', 'Trash']);
    expect(screen.getByRole('link', { name: 'Backup' }).getAttribute('aria-current')).toBe('page');
  });
});

describe('Backup screen', () => {
  const SUMMARY = {
    createdAt: '2026-11-17T08:30:00.000Z',
    counts: { notes: 3, photos: 2, fonts: 6, styles: 5 },
    adjustedNotes: 1,
    missing: [{ name: 'photos/x', what: 'Photo "beach.png"' }],
  };
  let safety: any[];
  beforeEach(() => {
    safety = [{ name: 'jot-safety-20261118-090503-0a1b2c3d.tar', size: 2048, createdAt: '2026-11-18T09:05:03.000Z' }];
    handler = (url, init) => {
      const m = init.method ?? 'GET';
      if (url === '/api/safety-backups' && m === 'GET') return json({ backups: safety });
      if (url.startsWith('/api/safety-backups/') && m === 'DELETE') {
        safety = [];
        return new Response(null, { status: 204 });
      }
      if (url === '/api/backup' && m === 'POST')
        return json({ backup: { id: 'b1', name: 'jot-backup-alice-20261118-100000.tar', size: 4096, counts: SUMMARY.counts, missing: SUMMARY.missing } }, 201);
      if (url === '/api/restore' && m === 'POST') return json({ restore: { id: 'r1', summary: SUMMARY } }, 201);
      if (url === '/api/restore/r1/confirm') return json({ restored: SUMMARY });
      if (url === '/api/restore/r1' && m === 'DELETE') return new Response(null, { status: 204 });
      return json({ error: 'unexpected' }, 500);
    };
  });

  it('has the three parts, and only those', async () => {
    render(<BackupScreen />);
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-labelledby'))).toEqual(['backup-make', 'backup-restore', 'backup-safety']);
    expect(document.body.textContent).not.toMatch(/full system backup|command line|docker compose/i);
    expect(screen.getByRole('heading', { name: 'Backup' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Back up my data' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Restore from a backup' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Safety backups' })).toBeTruthy();
  });

  it('backs up and downloads, and names anything that was already lost', async () => {
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.getAttribute('href')!);
    });
    render(<BackupScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Back up my data' }));
    await waitFor(() => expect(clicked).toEqual(['/api/backup/b1']));
    expect(screen.getByText(/jot-backup-alice-20261118-100000\.tar/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Back up my data' }).textContent).toMatch(/already lost/i);
    expect(screen.getByText(/beach\.png/)).toBeTruthy();
  });

  it('restores only after showing the summary and RESTORE is typed', async () => {
    const onRestored = vi.fn();
    render(<BackupScreen onRestored={onRestored} />);
    const file = new File([new Uint8Array([1, 2, 3])], 'my.tar', { type: 'application/x-tar' });
    await userEvent.upload(screen.getByLabelText('Backup file'), file);
    const region = screen.getByRole('region', { name: 'Restore from a backup' });
    await waitFor(() => expect(region.textContent).toMatch(/3 notes/));
    const upload = calls.find((c) => c.url === '/api/restore')!;
    expect(upload.body).toBe(file);
    expect(upload.headers['content-type']).toBe('application/x-tar');
    for (const s of ['2 photos', '6 fonts', '5 styles', '1 note will be adjusted', 'beach.png', '2026']) expect(region.textContent).toContain(s);
    expect(region.textContent).toMatch(/replace/i);
    const button = screen.getByRole('button', { name: 'Restore' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Type RESTORE to confirm'), 'restore');
    expect(button.disabled).toBe(true);
    await userEvent.clear(screen.getByLabelText('Type RESTORE to confirm'));
    await userEvent.type(screen.getByLabelText('Type RESTORE to confirm'), 'RESTORE');
    expect(button.disabled).toBe(false);
    await userEvent.click(button);
    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    expect(JSON.parse(calls.find((c) => c.url === '/api/restore/r1/confirm')!.body as string)).toEqual({ confirm: 'RESTORE' });
  });

  it('cancels a restore', async () => {
    render(<BackupScreen onRestored={() => {}} />);
    await userEvent.upload(screen.getByLabelText('Backup file'), new File([new Uint8Array([1])], 'b.tar'));
    await waitFor(() => screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/restore/r1' && c.method === 'DELETE')).toBe(true));
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  });

  it('shows why a backup was refused', async () => {
    const base = handler;
    handler = (url, init) => (url === '/api/restore' ? json({ error: 'This backup is damaged: data.json does not match its checksum.' }, 400) : base(url, init));
    render(<BackupScreen onRestored={() => {}} />);
    await userEvent.upload(screen.getByLabelText('Backup file'), new File([new Uint8Array([1])], 'b.tar'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/damaged/));
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  });

  it('lists safety backups to download or delete', async () => {
    render(<BackupScreen />);
    const region = screen.getByRole('region', { name: 'Safety backups' });
    const link = await waitFor(() => screen.getByRole('link', { name: /Download/ }));
    expect(link.getAttribute('href')).toBe('/api/safety-backups/jot-safety-20261118-090503-0a1b2c3d.tar');
    expect(region.textContent).toMatch(/2 KB|2\.0 KB/);
    await userEvent.click(screen.getByRole('button', { name: /Delete/ }));
    // Deleting asks once more.
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: /Confirm/ }));
    await waitFor(() => expect(region.textContent).toMatch(/no safety backups/i));
  });

});
