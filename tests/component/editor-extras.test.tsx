// @vitest-environment jsdom
// Type 7 (component): Clear formatting, opening links, and showing invisible characters and empty lines.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { Toolbar } from '../../src/client/editor/Toolbar';
import { clearFormatting } from '../../src/client/editor/clear';
import { EMPTY_LINES_KEY, emptyLinesOn, setEmptyLines } from '../../src/client/editor/emptyLines';
import { INVISIBLES_KEY, invisiblesOn, setInvisibles } from '../../src/client/editor/invisibles';
import { currentFormat } from '../../src/client/editor/stamp';
import { FONTS, makeEditor, STYLES } from './setup';

const styled = (text: string, extra: any[] = []) => ({
  type: 'text',
  text,
  marks: [
    { type: 'bold' },
    { type: 'italic' },
    { type: 'underline' },
    { type: 'strike' },
    { type: 'textStyle', attrs: { fontFamily: '"Lora"', fontSize: '32px', color: '#E11D48' } },
    { type: 'highlight', attrs: { color: '#FFE38F' } },
    ...extra,
  ],
});
const DOC = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [styled('Styled '), { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }, { type: 'bold' }] }, { type: 'text', text: ' code', marks: [{ type: 'code' }] }] },
    { type: 'heading', attrs: { level: 1 }, content: [styled('Head')] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [styled('Item')] }] }] },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [styled('Quoted')] }] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [styled('Cell')] }] }] }] },
    { type: 'image', attrs: { src: '/api/photos/abc', width: 100 } },
    { type: 'paragraph', content: [styled('Untouched')] },
  ],
};

function shape(doc: any) {
  const nodes = new Set<string>();
  const marks = new Set<string>();
  const walk = (n: any) => {
    nodes.add(n.type);
    for (const m of n.marks ?? []) marks.add(m.type);
    (n.content ?? []).forEach(walk);
  };
  walk(doc);
  return { nodes: [...nodes].sort(), marks: [...marks].sort() };
}
const select = (editor: Editor, text: string) => {
  let from = -1;
  editor.state.doc.descendants((n, pos) => {
    if (from < 0 && n.isText && n.text!.includes(text)) from = pos + n.text!.indexOf(text);
  });
  return from;
};

describe('Clear formatting', () => {
  it('clears the selection: marks except links go, headings, list items and quotes become paragraphs; text, links, tables and photos stay; one undo step', () => {
    const editor = makeEditor(DOC);
    const before = editor.getJSON();
    // From the start up to (not into) the last paragraph's text: the photo is inside the selection.
    editor.commands.setTextSelection({ from: 1, to: select(editor, 'Untouched') });
    clearFormatting(editor);
    const after = editor.getJSON() as any;
    expect(shape({ type: 'doc', content: after.content.slice(0, -1) })).toEqual({
      nodes: ['doc', 'image', 'paragraph', 'table', 'tableCell', 'tableRow', 'text'],
      marks: ['link'],
    });
    expect(after.content.find((n: any) => n.type === 'image')).toEqual(before.content!.find((n: any) => n.type === 'image'));
    expect(editor.state.doc.textContent).toBe('Styled link codeHeadItemQuotedCellUntouched');
    // The last paragraph was not selected: unchanged.
    expect(after.content.at(-1)).toEqual(before.content!.at(-1));
    // What is typed next is plain, and the toolbar is back to normal.
    expect(currentFormat(editor)).toMatchObject({ fontFamily: null, size: null, bold: false, italic: false, underline: false, strike: false, textColor: null, highlight: null });
    // One undo step.
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(before);
  });

  it('with nothing selected, leaves existing text and blocks alone and resets formatting for what is typed next', () => {
    const editor = makeEditor(DOC);
    const before = editor.getJSON();
    const endOfStyled = select(editor, 'Untouched') + 'Untouched'.length;
    editor.commands.setTextSelection(endOfStyled);
    clearFormatting(editor);
    expect(editor.getJSON()).toEqual(before);
    expect(editor.state.selection.from).toBe(endOfStyled);
    expect(editor.state.selection.empty).toBe(true);
    expect(currentFormat(editor)).toMatchObject({ fontFamily: null, size: null, bold: false, italic: false, underline: false, strike: false, textColor: null, highlight: null });
    editor.view.dispatch(editor.state.tr.insertText(' plain'));
    const last = (editor.getJSON() as any).content.at(-1);
    expect(last.content).toHaveLength(2);
    expect(last.content[0]).toEqual((before as any).content.at(-1).content[0]);
    expect(last.content[1]).toEqual({ type: 'text', text: ' plain' });
    expect(currentFormat(editor)).toMatchObject({ fontFamily: null, size: null, bold: false, italic: false, textColor: null, highlight: null });
  });

  it('is a toolbar button after undo/redo, just left of the invisibles toggle, with its tooltip', async () => {
    const editor = makeEditor(DOC);
    render(<Toolbar editor={editor} styles={STYLES} fonts={FONTS} onSaveSelectionAsStyle={vi.fn()} onManageStyles={vi.fn()} onBrowseFonts={vi.fn()} onPickImage={vi.fn()} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });
    const labels = within(toolbar).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels.slice(labels.indexOf('Redo') + 1, labels.indexOf('Redo') + 3)).toEqual(['Clear formatting', 'Show spaces, tabs and line ends']);
    const button = within(toolbar).getByRole('button', { name: 'Clear formatting' });
    expect(button.getAttribute('title')).toBe('Clear formatting');
    editor.commands.setTextSelection({ from: 1, to: 5 });
    await userEvent.click(button);
    expect((editor.getJSON() as any).content[0].content[0].marks).toBeUndefined();
  });
});

describe('links', () => {
  let open: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    open = vi.fn();
    vi.stubGlobal('open', open);
  });
  afterEach(() => vi.unstubAllGlobals());

  const linkIn = (editor: Editor) => editor.view.dom.querySelector('a') as HTMLAnchorElement;
  const click = (el: Element, init: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));

  it('Ctrl+click (or Cmd+click) opens the link in a new tab; a plain click does not', () => {
    const editor = makeEditor('<p>see <a href="https://example.com/page">the page</a></p>');
    const a = linkIn(editor);
    expect(a.getAttribute('title')).toBe('Ctrl+click to open');
    click(a);
    expect(open).not.toHaveBeenCalled();
    click(a, { ctrlKey: true });
    expect(open).toHaveBeenCalledWith('https://example.com/page', '_blank', 'noopener,noreferrer');
    click(a, { metaKey: true });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('Ctrl/Cmd+mousedown on a link is taken before ProseMirror, so nothing gets node-selected', () => {
    const editor = makeEditor('<p>first</p><p>see <a href="https://example.com/">it</a> now</p>');
    editor.commands.setTextSelection(3);
    const before = editor.state.selection.toJSON();
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...mod });
      linkIn(editor).dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(editor.state.selection.toJSON()).toEqual(before);
    }
    // The same on ordinary text.
    const onText = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
    editor.view.dom.querySelector('p')!.dispatchEvent(onText);
    expect(onText.defaultPrevented).toBe(true);
    expect(editor.state.selection.toJSON()).toEqual(before);
    // A plain mousedown is left to ProseMirror (it places the cursor).
    const plain = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    linkIn(editor).dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
  });

  it('a plain click opens it in a read-only note', () => {
    const editor = makeEditor('<p><a href="mailto:me@example.com">mail me</a></p>');
    editor.setEditable(false);
    click(linkIn(editor));
    expect(open).toHaveBeenCalledWith('mailto:me@example.com', '_blank', 'noopener,noreferrer');
  });

  it('a typed web address becomes a link', () => {
    const editor = makeEditor('<p></p>');
    editor.commands.insertContent('visit https://example.com/x ');
    const link = (editor.getJSON() as any).content[0].content.find((t: any) => t.marks?.some((m: any) => m.type === 'link'));
    expect(link?.text).toBe('https://example.com/x');
  });
});

// One pilcrow per paragraph or heading (Tiptap keeps an empty paragraph after a final heading).
const textblocks = (editor: Editor) => {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.isTextblock) n++;
  });
  return n;
};

describe('show invisible characters', () => {
  beforeEach(() => localStorage.clear());
  const CONTENT = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a b\tc' }, { type: 'hardBreak' }, { type: 'text', text: 'd' }] }, { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'two words' }] }] };

  it('shows dots, arrows, return marks and pilcrows, without changing the note', () => {
    const editor = makeEditor(CONTENT);
    editor.view.dispatch(editor.state.tr); // let Tiptap add its trailing paragraph first
    const before = JSON.stringify(editor.getJSON());
    const text = editor.getText();
    expect(editor.view.dom.querySelectorAll('.inv-space, .inv-tab, .inv-para, .inv-break').length).toBe(0);
    setInvisibles(editor, true);
    expect(invisiblesOn(editor)).toBe(true);
    const dom = editor.view.dom;
    expect(dom.querySelectorAll('.inv-space').length).toBe(2);
    expect(dom.querySelectorAll('.inv-tab').length).toBe(1);
    expect(dom.querySelectorAll('.inv-break').length).toBe(1);
    expect(dom.querySelectorAll('.inv-para').length).toBe(textblocks(editor));
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    expect(editor.getText()).toBe(text);
    // Typing with it on saves exactly what was typed.
    editor.commands.setTextSelection(2);
    editor.view.dispatch(editor.state.tr.insertText(' x'));
    expect((editor.getJSON() as any).content[0].content[0].text).toBe('a x b\tc');
    setInvisibles(editor, false);
    expect(dom.querySelectorAll('.inv-space, .inv-tab, .inv-para, .inv-break').length).toBe(0);
  });

  it('is remembered in this browser', () => {
    const a = makeEditor(CONTENT);
    setInvisibles(a, true);
    expect(localStorage.getItem(INVISIBLES_KEY)).toBe('1');
    const b = makeEditor(CONTENT);
    expect(invisiblesOn(b)).toBe(true);
    expect(b.view.dom.querySelectorAll('.inv-para').length).toBe(textblocks(b));
    setInvisibles(b, false);
    expect(invisiblesOn(makeEditor(CONTENT))).toBe(false);
  });

  it('is a toolbar toggle that stays enabled on a read-only note', async () => {
    const editor = makeEditor(CONTENT);
    render(
      <Toolbar editor={editor} styles={STYLES} fonts={FONTS} onSaveSelectionAsStyle={vi.fn()} onManageStyles={vi.fn()} onBrowseFonts={vi.fn()} onPickImage={vi.fn()} readOnly onMakeReadOnly={vi.fn()} />,
    );
    const toggle = screen.getByRole('button', { name: 'Show spaces, tabs and line ends' });
    expect(toggle.getAttribute('title')).toBe('Show spaces, tabs and line ends');
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(editor.view.dom.querySelectorAll('.inv-para').length).toBe(textblocks(editor));
  });
});

describe('show empty lines', () => {
  beforeEach(() => localStorage.clear());
  const t = (text: string) => [{ type: 'text', text }];
  const CONTENT = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: t('one') },
      { type: 'paragraph' },
      { type: 'heading', attrs: { level: 2 } },
      { type: 'paragraph', content: t('two') },
      { type: 'paragraph' },
    ],
  };

  it('dots only the empty lines, without changing the note', () => {
    const editor = makeEditor(CONTENT);
    const before = JSON.stringify(editor.getJSON());
    const dom = editor.view.dom;
    expect(dom.querySelectorAll('.empty-line').length).toBe(0);
    setEmptyLines(editor, true);
    expect(emptyLinesOn(editor)).toBe(true);
    const marked = [...dom.querySelectorAll('.empty-line')];
    expect(marked.map((el) => el.tagName)).toEqual(['P', 'H2', 'P']);
    expect(marked.every((el) => el.textContent === '')).toBe(true);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    // Typing into an empty line takes its dot away; the note holds just what was typed.
    editor.commands.setTextSelection(6);
    editor.view.dispatch(editor.state.tr.insertText('x'));
    expect((editor.getJSON() as any).content[1]).toEqual({ type: 'paragraph', content: t('x') });
    expect(dom.querySelectorAll('.empty-line').length).toBe(2);
    setEmptyLines(editor, false);
    expect(dom.querySelectorAll('.empty-line').length).toBe(0);
  });

  it('is remembered in this browser', () => {
    const a = makeEditor(CONTENT);
    expect(emptyLinesOn(a)).toBe(false);
    setEmptyLines(a, true);
    expect(localStorage.getItem(EMPTY_LINES_KEY)).toBe('1');
    const b = makeEditor(CONTENT);
    expect(emptyLinesOn(b)).toBe(true);
    expect(b.view.dom.querySelectorAll('.empty-line').length).toBe(3);
    setEmptyLines(b, false);
    expect(emptyLinesOn(makeEditor(CONTENT))).toBe(false);
  });

  it('is a toolbar toggle right after the pilcrow that stays enabled on a read-only note', async () => {
    const editor = makeEditor(CONTENT);
    render(
      <Toolbar editor={editor} styles={STYLES} fonts={FONTS} onSaveSelectionAsStyle={vi.fn()} onManageStyles={vi.fn()} onBrowseFonts={vi.fn()} onPickImage={vi.fn()} readOnly onMakeReadOnly={vi.fn()} />,
    );
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    const i = labels.indexOf('Show spaces, tabs and line ends');
    expect(labels.slice(i, i + 3)).toEqual(['Show spaces, tabs and line ends', 'Show empty lines', 'Read-only']);
    const toggle = screen.getByRole('button', { name: 'Show empty lines' });
    expect(toggle.getAttribute('title')).toBe('Show empty lines');
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(editor.view.dom.querySelectorAll('.empty-line').length).toBe(3);
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(editor.view.dom.querySelectorAll('.empty-line').length).toBe(0);
  });
});

describe('numbered lists', () => {
  const item = (text: string, ...more: any[]) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...more] });
  const ol = (attrs: any, ...items: any[]) => ({ type: 'orderedList', attrs, content: items });

  it('writes an explicit type, including "1", so the depth styles (1. a. i.) leave it alone', () => {
    const editor = makeEditor({ type: 'doc', content: [ol({}, item('outer', ol({ type: '1' }, item('explicit')), ol({ type: 'A', start: 3 }, item('upper'))))] });
    const lists = [...editor.view.dom.querySelectorAll('ol')];
    expect(lists.map((l) => l.getAttribute('type'))).toEqual([null, '1', 'A']);
    expect(lists[2].getAttribute('start')).toBe('3');
    expect(lists[0].hasAttribute('start')).toBe(false);
    // The attribute still reads back into the same type.
    const json = editor.getJSON() as any;
    expect(json.content[0].content[0].content[1].attrs).toMatchObject({ type: '1' });
  });
});

describe('task list styling', () => {
  // The selector styles.css lays task items out with (checkbox in the gutter, text at 28px).
  // Tiptap's task-item node view builds the li without data-type, so it must not rely on it.
  const TASK_ITEM = "ul[data-type='taskList'] > li";
  const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const task = (text: string, ...more: any[]) => ({ type: 'taskItem', attrs: { checked: false }, content: [para(text), ...more] });
  const tasks = (...items: any[]) => ({ type: 'taskList', content: items });
  const bullets = (...texts: string[]) => ({ type: 'bulletList', content: texts.map((t) => ({ type: 'listItem', content: [para(t)] })) });

  it('is the selector styles.css uses', () => {
    const css = readFileSync('src/client/styles.css', 'utf8'); // tests run from the project root
    expect(css).toContain(`.note-body ${TASK_ITEM} { display: flex;`);
    expect(css).toContain(`.note-body ${TASK_ITEM} > label > input {`);
  });

  it('matches every task item in the editor, nested ones too, and no bullet item inside a task', () => {
    const editor = makeEditor({ type: 'doc', content: [tasks(task('top', tasks(task('nested task')), bullets('bullet in task')), task('second'))] });
    const matched = [...editor.view.dom.querySelectorAll(TASK_ITEM)];
    expect(matched.map((li) => li.querySelector(':scope > div > p')?.textContent)).toEqual(['top', 'nested task', 'second']);
    for (const li of matched) {
      expect(li.querySelector(':scope > label > input[type="checkbox"]')).not.toBeNull();
      expect(li.querySelector(':scope > div')).not.toBeNull();
    }
    const bullet = [...editor.view.dom.querySelectorAll('li')].find((li) => li.textContent === 'bullet in task')!;
    expect(bullet).toBeDefined();
    expect(bullet.matches(TASK_ITEM)).toBe(false);
  });
});
