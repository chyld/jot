// @vitest-environment jsdom
// Type 7 (component): the Styles and Font dropdowns, and the style stamp they apply.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FontDropdown, StylesDropdown } from '../../src/client/editor/Toolbar';
import { applyStyle } from '../../src/client/editor/stamp';
import { FONTS, makeEditor, marksOf, select, style, STYLES } from './setup';

describe('Styles dropdown', () => {
  function setup(content?: unknown) {
    const editor = makeEditor(content);
    const onSaveSelection = vi.fn();
    const onManage = vi.fn();
    render(<StylesDropdown editor={editor} styles={STYLES} onSaveSelection={onSaveSelection} onManage={onManage} />);
    return { editor, onSaveSelection, onManage };
  }

  it('lists the user’s styles previewed in their own look, then the two actions', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Styles' }));
    const menu = screen.getByRole('menu', { name: 'Styles' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Body', 'Quote', 'Key Term', 'Save selection as style…', 'Manage styles…']);
    const quote = within(items[1]).getByText('Quote') as HTMLElement;
    expect(quote.style.fontFamily).toContain('Lora');
    expect(quote.style.fontSize).toBe('20px');
    expect(quote.style.fontStyle).toBe('italic');
    expect(quote.style.color).toBe('rgb(143, 42, 244)'); // Violet
    const key = within(items[2]).getByText('Key Term') as HTMLElement;
    expect(key.style.fontWeight).toBe('700');
    expect(key.style.backgroundColor).toBe('rgb(255, 229, 143)'); // Sunflower highlight
  });

  it('applies a style as plain formatting on the selection', async () => {
    const { editor } = setup('<p>Hello <strong>world</strong> again</p>');
    select(editor, 'world');
    await userEvent.click(screen.getByRole('button', { name: 'Styles' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Quote' }));
    const marks = marksOf(editor, 'world');
    expect(marks.textStyle).toMatchObject({ fontFamily: '"Lora"', fontSize: '20px', color: '#8F2AF4' });
    expect(marks.italic).toBeDefined();
    expect(marks.bold).toBeUndefined(); // the stamp replaces earlier bold
    expect(marksOf(editor, 'Hello').textStyle).toBeUndefined();
  });

  it('with no selection, changes nothing already written: the style is what is typed next', () => {
    const editor = makeEditor('<p>First para</p><p>Second para</p>');
    editor.commands.setTextSelection(11); // the end of "First para"
    applyStyle(editor, STYLES[2]);
    expect(marksOf(editor, 'First para').bold).toBeUndefined();
    expect(marksOf(editor, 'First para').highlight).toBeUndefined();
    editor.view.dispatch(editor.state.tr.insertText(' typed'));
    expect(marksOf(editor, 'typed').bold).toBeDefined();
    expect(marksOf(editor, 'typed').highlight.color).toBe('#FFE58F');
    expect(marksOf(editor, 'First para').bold).toBeUndefined();
    expect(marksOf(editor, 'Second para').bold).toBeUndefined();
  });

  it('two styles applied one after the other while typing give one phrase in two styles', () => {
    const editor = makeEditor('<p>Start </p>');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    applyStyle(editor, STYLES[2]);
    editor.view.dispatch(editor.state.tr.insertText('hello '));
    applyStyle(editor, STYLES[1]);
    editor.view.dispatch(editor.state.tr.insertText('world'));
    expect(editor.state.doc.childCount).toBe(1); // still one paragraph
    expect(marksOf(editor, 'Start').textStyle).toBeUndefined();
    expect(marksOf(editor, 'hello').bold).toBeDefined();
    expect(marksOf(editor, 'hello').highlight.color).toBe('#FFE58F');
    // The second stamp replaces the first for what follows: no bold, no highlight carried over.
    expect(marksOf(editor, 'world').textStyle).toMatchObject({ fontFamily: '"Lora"', fontSize: '20px', color: '#8F2AF4' });
    expect(marksOf(editor, 'world').italic).toBeDefined();
    expect(marksOf(editor, 'world').bold).toBeUndefined();
    expect(marksOf(editor, 'world').highlight).toBeUndefined();
  });

  it('is a stamp: editing the style later does not change stamped text until reapplied', () => {
    const editor = makeEditor('<p>stamped text</p>');
    const v1 = style({ name: 'Aside', fontFamily: 'Caveat', size: 24, textColor: 'Electric' });
    select(editor, 'stamped');
    applyStyle(editor, v1);
    const v2 = { ...v1, size: 30, textColor: 'Crimson', bold: true };
    // The style changed; the text did not.
    expect(marksOf(editor, 'stamped').textStyle).toMatchObject({ fontSize: '24px', color: '#0A47FF' });
    expect(marksOf(editor, 'stamped').bold).toBeUndefined();
    select(editor, 'stamped');
    applyStyle(editor, v2);
    expect(marksOf(editor, 'stamped').textStyle).toMatchObject({ fontFamily: '"Caveat"', fontSize: '30px', color: '#E00631' });
    expect(marksOf(editor, 'stamped').bold).toBeDefined();
  });

  it('shows the name of the style matching the text at the cursor', () => {
    const { editor } = setup('<p>alpha beta</p>');
    expect(screen.getByRole('button', { name: 'Styles' }).textContent).toBe('Styles');
    act(() => {
      select(editor, 'alpha');
      applyStyle(editor, STYLES[1]);
      editor.commands.setTextSelection(2);
    });
    expect(screen.getByRole('button', { name: 'Styles' }).textContent).toBe('Quote');
  });

  it('runs "Save selection as style…" and "Manage styles…"', async () => {
    const { onSaveSelection, onManage } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Styles' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Save selection as style…' }));
    expect(onSaveSelection).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Styles' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Manage styles…' }));
    expect(onManage).toHaveBeenCalledOnce();
  });
});

describe('Font dropdown', () => {
  function setup() {
    const editor = makeEditor('<p>Hello world</p>');
    const onBrowse = vi.fn();
    render(<FontDropdown editor={editor} fonts={FONTS} onBrowse={onBrowse} />);
    return { editor, onBrowse };
  }

  it('lists only active fonts, each in its own typeface, then "Browse fonts…"', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Font' }));
    const items = within(screen.getByRole('menu', { name: 'Font' })).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Inter', 'Lora', 'Caveat', 'Browse fonts…']);
    expect(items[1].style.fontFamily).toContain('Lora');
    expect(items.some((i) => i.textContent === 'Old Standard TT')).toBe(false);
  });

  it('sets the font on the selection and shows it as the label', async () => {
    const { editor } = setup();
    expect(screen.getByRole('button', { name: 'Font' }).textContent).toBe('Inter');
    select(editor, 'world');
    await userEvent.click(screen.getByRole('button', { name: 'Font' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Caveat' }));
    expect(marksOf(editor, 'world').textStyle.fontFamily).toBe('"Caveat"');
    expect(screen.getByRole('button', { name: 'Font' }).textContent).toBe('Caveat');
  });

  it('still shows an archived font used by the text, though it cannot be picked', () => {
    const editor = makeEditor('<p><span style="font-family: &quot;Old Standard TT&quot;">old</span></p>');
    render(<FontDropdown editor={editor} fonts={FONTS} onBrowse={() => {}} />);
    act(() => {
      editor.commands.setTextSelection(2);
    });
    expect(screen.getByRole('button', { name: 'Font' }).textContent).toBe('Old Standard TT');
  });

  it('"Browse fonts…" opens the catalogue', async () => {
    const { onBrowse } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Font' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Browse fonts…' }));
    expect(onBrowse).toHaveBeenCalledOnce();
  });
});
