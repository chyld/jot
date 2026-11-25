// @vitest-environment jsdom
// Type 7 (component): Internal Jot copy/cut/paste preserves rich formatting and blocks,
// while external pastes arrive as plain text taking the formatting at the cursor.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { jotExtensions } from '../../src/client/editor/extensions';
import { JOT_CLIPBOARD_MIME, pasteProps } from '../../src/client/editor/paste';
import './setup';

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
});

function makePasteEditor(content: unknown, editable = true) {
  const onFile = vi.fn();
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: jotExtensions(),
    enablePasteRules: false,
    content: content as any,
    editable,
    editorProps: pasteProps(onFile),
  });
  editors.push(editor);
  return { editor, onFile };
}

class FakeDataTransfer {
  private map = new Map<string, string>();
  files: File[] = [];
  items: DataTransferItem[] = [];
  clearData() {
    this.map.clear();
  }
  setData(type: string, value: string) {
    this.map.set(type, value);
  }
  getData(type: string) {
    return this.map.get(type) ?? '';
  }
}

function dispatchClipboard(editor: Editor, type: 'copy' | 'cut' | 'paste', dt = new FakeDataTransfer()) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: dt });
  editor.view.dom.dispatchEvent(event);
  return dt;
}

const STYLED_MARKS = [
  { type: 'bold' },
  { type: 'italic' },
  { type: 'underline' },
  { type: 'textStyle', attrs: { fontFamily: '"Lora"', fontSize: '28px', color: '#E00631' } },
  { type: 'highlight', attrs: { color: '#FFE58F' } },
];

const RICH_DOC = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Styled', marks: STYLED_MARKS },
        { type: 'text', text: ' ' },
        { type: 'text', text: 'Link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
      ],
    },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Section' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bullet' }] }] }] },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell', marks: [{ type: 'bold' }] }] }] },
          ],
        },
      ],
    },
    { type: 'image', attrs: { src: '/api/photos/photo123', width: 240, borderWidth: 2, borderColor: 'Crimson' } },
  ],
};

describe('internal rich paste vs external plain paste', () => {
  it('copy inside Jot writes Jot slice, HTML and plain text, and pasting into another editor preserves everything', () => {
    const { editor: src } = makePasteEditor(RICH_DOC);
    src.commands.selectAll();
    const dt = dispatchClipboard(src, 'copy');
    expect(dt.getData('text/plain')).toContain('Styled');
    expect(dt.getData('text/html')).toContain('Lora');
    expect(dt.getData(JOT_CLIPBOARD_MIME)).toBeTruthy();

    const { editor: dst } = makePasteEditor('<p></p>');
    dst.commands.setTextSelection(1);
    dispatchClipboard(dst, 'paste', dt);
    expect(dst.getJSON()).toEqual(src.getJSON());
  });

  it('cut removes the selection and pastes back with its formatting', () => {
    const { editor } = makePasteEditor({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Fancy', marks: STYLED_MARKS }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Target ' }] },
      ],
    });
    editor.commands.setTextSelection({ from: 1, to: 6 });
    const dt = dispatchClipboard(editor, 'cut');
    expect(editor.getText()).not.toContain('Fancy');

    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    dispatchClipboard(editor, 'paste', dt);
    const last = (editor.getJSON() as any).content.at(-1);
    expect(last.content).toHaveLength(2);
    expect(last.content[0]).toEqual({ type: 'text', text: 'Target ' });
    expect(last.content[1].text).toBe('Fancy');
    expect(last.content[1].marks).toEqual(expect.arrayContaining([
      { type: 'bold' },
      { type: 'italic' },
      { type: 'underline' },
      { type: 'textStyle', attrs: { fontFamily: '"Lora"', fontSize: '28px', color: '#E00631' } },
      { type: 'highlight', attrs: { color: '#FFE58F' } },
    ]));
  });

  it('copying a single photo node pastes the photo cleanly with its attributes', () => {
    const { editor: src } = makePasteEditor({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: '/api/photos/pic99', width: 320, borderWidth: 3, borderColor: 'Electric' } }],
    });
    src.commands.setNodeSelection(0);
    const dt = dispatchClipboard(src, 'copy');
    expect(dt.getData(JOT_CLIPBOARD_MIME)).toBeTruthy();

    const { editor: dst } = makePasteEditor('<p>Before</p>');
    dst.commands.setTextSelection(dst.state.doc.content.size - 1);
    dispatchClipboard(dst, 'paste', dt);
    const img = (dst.getJSON() as any).content.find((n: any) => n.type === 'image');
    expect(img).toMatchObject({ type: 'image', attrs: { src: '/api/photos/pic99', width: 320, borderWidth: 3, borderColor: 'Electric' } });
  });

  it('copying from a read-only editor preserves formatting on paste, while cut does not edit the read-only note', () => {
    const { editor: ro } = makePasteEditor(
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Locked', marks: STYLED_MARKS }] }] },
      false,
    );
    const before = ro.getJSON();
    ro.commands.selectAll();
    dispatchClipboard(ro, 'cut');
    expect(ro.getJSON()).toEqual(before);

    const dt = dispatchClipboard(ro, 'copy');
    const { editor: dst } = makePasteEditor('<p></p>');
    dst.commands.setTextSelection(1);
    dispatchClipboard(dst, 'paste', dt);
    expect((dst.getJSON() as any).content[0].content[0].marks).toEqual(expect.arrayContaining([{ type: 'bold' }, { type: 'italic' }]));
  });

  it('external paste (no Jot slice) and corrupt Jot slice still paste as plain text inheriting cursor marks', () => {
    const { editor } = makePasteEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bold ', marks: [{ type: 'bold' }] }] }],
    });
    editor.commands.setTextSelection(6);

    const external = new FakeDataTransfer();
    external.setData('text/html', '<h1 style="color:red"><i>External</i></h1>');
    external.setData('text/plain', 'External');
    dispatchClipboard(editor, 'paste', external);

    const corrupt = new FakeDataTransfer();
    corrupt.setData(JOT_CLIPBOARD_MIME, '{not valid json');
    corrupt.setData('text/plain', ' Fallback');
    dispatchClipboard(editor, 'paste', corrupt);

    expect(editor.getJSON()).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bold External Fallback', marks: [{ type: 'bold' }] }] }],
    });
  });
});
