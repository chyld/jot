// @vitest-environment jsdom
// Type 7 (component): the toolbar, its order and Jot's commands.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbar, normalizeLink } from '../../src/client/editor/Toolbar';
import { FONTS, makeEditor, marksOf, select, STYLES } from './setup';

function renderToolbar(content?: unknown) {
  const editor = makeEditor(content);
  const handlers = {
    onSaveSelectionAsStyle: vi.fn(),
    onManageStyles: vi.fn(),
    onBrowseFonts: vi.fn(),
    onPickImage: vi.fn(),
  };
  render(<Toolbar editor={editor} styles={STYLES} fonts={FONTS} {...handlers} />);
  return { editor, ...handlers };
}

describe('Toolbar', () => {
  it('shows the controls left to right as in the screenshots', () => {
    renderToolbar();
    const bar = screen.getByRole('toolbar', { name: 'Formatting' });
    const labels = [...bar.querySelectorAll('button[aria-label], input[aria-label]')].map((el) => el.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Styles',
      'Font',
      'Decrease font size',
      'Font size',
      'Increase font size',
      'Text colour',
      'Highlight colour',
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Inline code',
      'Link',
      'Heading',
      'List',
      'Insert',
      'Undo',
      'Redo',
      'Clear formatting',
      'Show spaces, tabs and line ends',
      'Show empty lines',
    ]);
  });

  it('heading menu offers Normal text and Heading 1-3', async () => {
    const { editor } = renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: 'Heading' }));
    const menu = screen.getByRole('menu', { name: 'Heading' });
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent?.trim())).toEqual(['Normal text', 'H1 Heading 1', 'H2 Heading 2', 'H3 Heading 3']);
    await userEvent.click(within(menu).getByText('Heading 2'));
    expect(editor.isActive('heading', { level: 2 })).toBe(true);
  });

  it('list menu offers bullet, numbered and task lists', async () => {
    const { editor } = renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: 'List' }));
    const menu = screen.getByRole('menu', { name: 'List' });
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent?.trim())).toEqual(['Bullet list', 'Numbered list', 'Task list']);
    await userEvent.click(within(menu).getByText('Task list'));
    expect(editor.isActive('taskList')).toBe(true);
  });

  it('insert menu offers horizontal line, block quote, table and image', async () => {
    const { onPickImage } = renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
    const menu = screen.getByRole('menu', { name: 'Insert' });
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent?.trim())).toEqual(['Horizontal line', 'Block quote', 'Table', 'Image']);
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'p.png', { type: 'image/png' });
    await userEvent.upload(screen.getByTestId('image-file-input'), file);
    expect(onPickImage).toHaveBeenCalledWith(file);
  });

  it('shows table controls only when the cursor is in a table', async () => {
    const { editor } = renderToolbar();
    expect(screen.queryByRole('toolbar', { name: 'Table' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Table/ }));
    const bar = await screen.findByRole('toolbar', { name: 'Table' });
    for (const name of ['Add column before', 'Add column after', 'Delete column', 'Add row before', 'Add row after', 'Delete row', 'Header row', 'Merge cells', 'Split cell', 'Delete table']) {
      expect(within(bar).getByRole('button', { name })).toBeTruthy();
    }
    const rows = () => editor.getJSON().content!.find((n) => n.type === 'table')!.content!.length;
    expect(rows()).toBe(3);
    await userEvent.click(within(bar).getByRole('button', { name: 'Add row after' }));
    expect(rows()).toBe(4);
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    });
    expect(screen.queryByRole('toolbar', { name: 'Table' })).toBeNull();
  });

  it('shows photo controls only when a photo is selected', () => {
    const { editor } = renderToolbar({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }, { type: 'image', attrs: { src: '/api/photos/abcdefghijklmnopqrstuv' } }],
    });
    expect(screen.queryByRole('toolbar', { name: 'Photo' })).toBeNull();
    let imagePos = -1;
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name === 'image') imagePos = pos;
    });
    act(() => {
      editor.commands.setNodeSelection(imagePos);
    });
    expect(screen.getByRole('toolbar', { name: 'Photo' })).toBeTruthy();
  });

  it('font size box applies a size, and minus/plus step it', async () => {
    const { editor } = renderToolbar();
    select(editor, 'world');
    const box = screen.getByRole('textbox', { name: 'Font size' }) as HTMLInputElement;
    expect(box.value).toBe('16');
    await userEvent.clear(box);
    await userEvent.type(box, '24{Enter}');
    expect(marksOf(editor, 'world').textStyle.fontSize).toBe('24px');
    await userEvent.click(screen.getByRole('button', { name: 'Increase font size' }));
    expect(marksOf(editor, 'world').textStyle.fontSize).toBe('25px');
    await userEvent.click(screen.getByRole('button', { name: 'Decrease font size' }));
    await userEvent.click(screen.getByRole('button', { name: 'Decrease font size' }));
    expect(marksOf(editor, 'world').textStyle.fontSize).toBe('23px');
  });

  it('font size is clamped to the allowed range', async () => {
    const { editor } = renderToolbar();
    select(editor, 'world');
    const box = screen.getByRole('textbox', { name: 'Font size' });
    await userEvent.clear(box);
    await userEvent.type(box, '999{Enter}');
    expect(marksOf(editor, 'world').textStyle.fontSize).toBe('200px');
  });

  it('text and highlight colours come only from the palette', async () => {
    const { editor } = renderToolbar();
    select(editor, 'world');
    await userEvent.click(screen.getByRole('button', { name: 'Text colour' }));
    const textMenu = screen.getByRole('menu', { name: 'Text colour' });
    expect(within(textMenu).getAllByRole('menuitemradio').length).toBe(11); // 10 colours + default
    await userEvent.click(within(textMenu).getByRole('menuitemradio', { name: 'Text colour Crimson' }));
    expect(marksOf(editor, 'world').textStyle.color).toBe('#E00631');

    await userEvent.click(screen.getByRole('button', { name: 'Highlight colour' }));
    const hlMenu = screen.getByRole('menu', { name: 'Highlight colour' });
    expect(within(hlMenu).getAllByRole('menuitemradio').length).toBe(11);
    await userEvent.click(within(hlMenu).getByRole('menuitemradio', { name: 'Highlight Sunflower' }));
    expect(marksOf(editor, 'world').highlight.color).toBe('#FFE58F');
  });

  it('colour pickers show swatches only, each with an accessible name', async () => {
    const { editor } = renderToolbar();
    select(editor, 'world');
    for (const [button, prefix] of [
      ['Text colour', 'Text colour '],
      ['Highlight colour', 'Highlight '],
    ] as const) {
      await userEvent.click(screen.getByRole('button', { name: button }));
      const menu = screen.getByRole('menu', { name: button });
      expect(menu.textContent).toBe(''); // no colour names as visible text
      const swatches = within(menu).getAllByRole('menuitemradio');
      const names = swatches.map((s) => s.getAttribute('aria-label'));
      for (const c of ['Jet', 'Crimson', 'Tangerine', 'Sunflower', 'Lime', 'Jade', 'Cyan', 'Electric', 'Violet', 'Magenta']) {
        expect(names).toContain(prefix + c);
      }
      for (const s of swatches.slice(1)) expect(s.style.background).not.toBe('');
      await userEvent.keyboard('{Escape}');
    }
  });

  it('marks the current colour as selected', async () => {
    const { editor } = renderToolbar();
    select(editor, 'world');
    act(() => {
      editor.chain().setColor('#089163').run();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Text colour' }));
    expect(screen.getByRole('menuitemradio', { name: 'Text colour Jade' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: 'Default text colour' }).getAttribute('aria-checked')).toBe('false');
  });

  it('link refuses unsafe addresses and adds https:// to bare domains', async () => {
    const { editor } = renderToolbar();
    expect(normalizeLink('javascript:alert(1)')).toBeNull();
    expect(normalizeLink('example.com')).toBe('https://example.com');
    expect(normalizeLink('me@example.com')).toBe('mailto:me@example.com');
    select(editor, 'world');
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    const input = screen.getByRole('textbox', { name: 'Link address' });
    await userEvent.type(input, 'javascript:alert(1){Enter}');
    expect(screen.getByRole('alert').textContent).toMatch(/web or email/);
    expect(marksOf(editor, 'world').link).toBeUndefined();
    await userEvent.clear(input);
    await userEvent.type(input, 'example.com{Enter}');
    expect(marksOf(editor, 'world').link.href).toBe('https://example.com');
  });

  it('bold toggles and undo/redo follow history', async () => {
    const { editor } = renderToolbar();
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    select(editor, 'world');
    await userEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(marksOf(editor, 'world').bold).toBeDefined();
    expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(marksOf(editor, 'world').bold).toBeUndefined();
    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(marksOf(editor, 'world').bold).toBeDefined();
  });
});
