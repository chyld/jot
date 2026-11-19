// Pasting into the note editor.
//  - Text always goes in as plain text: every line becomes a paragraph, and the text takes
//    the formatting at the cursor, as typed text would. Nothing from the clipboard's
//    formatting survives (fonts, sizes, colours, highlights, bold, italic, links,
//    headings, lists, tables), whether it came from another app, a web page or Jot itself.
//  - When there is no usable text and the clipboard holds a file, it is pasted as a photo
//    (uploaded like Insert → Image). Pasted HTML is never parsed, so an external or data:
//    image URL can never get into a note.
import { Fragment, Slice, type ResolvedPos } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
export const PHOTO_TYPE_MESSAGE = 'Photos must be JPEG, PNG, GIF or WebP images.';

const BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'TABLE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER']);

/** The text of an HTML clipboard (used only when the clipboard has no plain text). */
export function textFromHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += (n.textContent ?? '').replace(/\s+/g, ' ');
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as Element;
    if (['SCRIPT', 'STYLE', 'TEMPLATE', 'IMG'].includes(el.tagName)) return;
    if (el.tagName === 'BR') out += '\n';
    el.childNodes.forEach(walk);
    if (el.tagName === 'TD' || el.tagName === 'TH') out += '\t';
    if (BLOCKS.has(el.tagName)) out += '\n';
  };
  walk(doc.body);
  return out;
}

/** The clipboard's file, an image first. */
function clipboardFile(data: DataTransfer): File | null {
  const files = [...Array.from(data.files)];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f && !files.includes(f)) files.push(f);
    }
  }
  return files.find((f) => f.type.startsWith('image/')) ?? files[0] ?? null;
}

/** Plain text as paragraphs, carrying the formatting at the cursor (as typing would). */
export function plainTextSlice(text: string, $context: ResolvedPos, view: EditorView): Slice {
  const { schema } = view.state;
  const marks = view.state.storedMarks ?? $context.marks();
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/^\n+|\n+$/g, '')
    .split(/\n+/);
  return new Slice(Fragment.from(lines.map((l) => schema.nodes.paragraph.create(null, l ? schema.text(l, marks) : null))), 1, 1);
}

/**
 * ProseMirror props for the editor: handlePaste decides what a paste becomes, and
 * clipboardTextParser turns plain text into paragraphs. Ctrl+V and the browser's Paste
 * menu both arrive as the same paste event.
 */
export function pasteProps(onFile: (file: File) => void) {
  let pastingText = false;
  return {
    handlePaste(view: EditorView, event: ClipboardEvent): boolean {
      if (pastingText) return false; // our own plain-text paste, below
      const data = event.clipboardData;
      if (!data) return false;
      let text = data.getData('text/plain');
      if (!text.trim()) {
        const html = data.getData('text/html');
        if (html) text = textFromHtml(html);
      }
      if (text.trim()) {
        pastingText = true;
        try {
          view.pasteText(text, event);
        } finally {
          pastingText = false;
        }
        return true;
      }
      const file = clipboardFile(data);
      if (file) onFile(file);
      return true; // nothing else on a clipboard is ever inserted
    },
    clipboardTextParser: (text: string, $context: ResolvedPos, _plain: boolean, view: EditorView) => plainTextSlice(text, $context, view),
  };
}
