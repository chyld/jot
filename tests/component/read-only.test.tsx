// @vitest-environment jsdom
// Type 7 (component): the read-only lock toggle at the end of the editor toolbar (with an
// in-page confirmation that cannot be undone from the web app), the disabled toolbar of a
// read-only note, and the read-only mark on note cards.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbar } from '../../src/client/editor/Toolbar';
import { NoteCard } from '../../src/client/components/NoteCard';
import { FONTS, makeEditor, STYLES } from './setup';

function renderToolbar(readOnly: boolean) {
  const editor = makeEditor('<p>Hello world</p>');
  const onMakeReadOnly = vi.fn(async () => {});
  render(
    <Toolbar
      editor={editor}
      styles={STYLES}
      fonts={FONTS}
      onSaveSelectionAsStyle={vi.fn()}
      onManageStyles={vi.fn()}
      onBrowseFonts={vi.fn()}
      onPickImage={vi.fn()}
      readOnly={readOnly}
      onMakeReadOnly={onMakeReadOnly}
    />,
  );
  return { onMakeReadOnly, toolbar: screen.getByRole('toolbar', { name: 'Formatting' }) };
}

describe('read-only toggle', () => {
  it('is the last control of the toolbar', () => {
    const { toolbar } = renderToolbar(false);
    const buttons = within(toolbar).getAllByRole('button');
    expect(buttons.at(-1)!.getAttribute('aria-label')).toBe('Make read-only');
    expect(buttons.at(-1)!.getAttribute('aria-pressed')).toBe('false');
  });

  it('asks once more in the page, saying plainly what read-only means', async () => {
    const { onMakeReadOnly } = renderToolbar(false);
    await userEvent.click(screen.getByRole('button', { name: 'Make read-only' }));
    expect(onMakeReadOnly).not.toHaveBeenCalled();
    const confirm = screen.getByRole('group', { name: 'Make read-only' });
    expect(confirm.textContent).toMatch(/nothing about the note can be changed/i);
    expect(confirm.textContent).toMatch(/cannot be deleted/i);
    expect(confirm.textContent).toMatch(/only be made writable again from the command line on the server/i);
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Make read-only' })).toBeNull();
    expect(onMakeReadOnly).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Make read-only' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm: make read-only' }));
    expect(onMakeReadOnly).toHaveBeenCalledTimes(1);
  });

  it('on a read-only note: every toolbar control is disabled and the toggle cannot turn it off', async () => {
    const { toolbar, onMakeReadOnly } = renderToolbar(true);
    const buttons = within(toolbar).getAllByRole('button');
    for (const b of buttons) expect((b as HTMLButtonElement).disabled, b.getAttribute('aria-label') ?? b.textContent ?? '').toBe(true);
    expect((within(toolbar).getByRole('textbox', { name: 'Font size' }) as HTMLInputElement).disabled).toBe(true);
    const lock = within(toolbar).getByRole('button', { name: 'Read-only' });
    expect(lock.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(lock);
    expect(onMakeReadOnly).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Make read-only' })).toBeNull();
  });
});

describe('note card', () => {
  const note = { id: 'n1', title: 'Fixed', preview: '', tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', deletedAt: null };
  it('marks a read-only note', () => {
    render(<NoteCard note={{ ...note, readOnly: true }} now={new Date()} />);
    expect(screen.getByLabelText('Read-only')).toBeTruthy();
  });
  it('shows no mark on other notes', () => {
    render(<NoteCard note={{ ...note, readOnly: false }} now={new Date()} />);
    expect(screen.queryByLabelText('Read-only')).toBeNull();
  });
});
