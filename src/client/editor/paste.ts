// Pasting into the note editor.
//  - Internal copies/cuts from Jot carry the ProseMirror selection slice under
//    application/x-jot-slice (alongside text/plain and text/html for external apps).
//    Pasting that slice back into Jot preserves all formatting, blocks, links, tables
//    and photos.
//  - External pastes (from other apps, web pages, or plain-text Ctrl+Shift+V) always go
//    in as plain text: every line becomes a paragraph, and the text takes the formatting
//    at the cursor, as typed text would.
//  - When there is no usable text and the clipboard holds a file, it is pasted as a photo
//    (uploaded like Insert → Image). External HTML is never parsed, so an external or
//    data: image URL can never get into a note.
import { Fragment, Slice, type ResolvedPos, type Schema } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';

export const JOT_CLIPBOARD_MIME = 'application/x-jot-slice';
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
export const PHOTO_TYPE_MESSAGE = 'Photos must be JPEG, PNG, GIF or WebP images.';

/** Parses a Jot clipboard slice back into a ProseMirror Slice, or null if invalid. */
export function parseJotSlice(raw: string, schema: Schema): Slice | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const slice = Slice.fromJSON(schema, parsed);
    return slice.size > 0 || slice.content.childCount > 0 ? slice : null;
  } catch {
    return null;
  }
}

function handleCopyOrCut(view: EditorView, event: ClipboardEvent): boolean {
  if (event.type === 'cut' && !view.editable) return false;
  const { selection } = view.state;
  if (selection.empty) return false;
  const data = event.clipboardData;
  if (!data) return false;
  const slice = selection.content();
  const { dom, text } = view.serializeForClipboard(slice);
  event.preventDefault();
  data.clearData();
  data.setData('text/html', dom.innerHTML);
  data.setData('text/plain', text);
  const json = slice.toJSON();
  if (json) data.setData(JOT_CLIPBOARD_MIME, JSON.stringify(json));
  if (event.type === 'cut') {
    view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'));
  }
  return true;
}

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
 * ProseMirror props for the editor: copy/cut attaches Jot's native slice alongside plain
 * text and HTML, handlePaste restores internal Jot slices with full formatting and turns
 * external pastes into plain text (or uploads a pasted image file), and
 * clipboardTextParser turns plain text into paragraphs.
 */
export function pasteProps(onFile: (file: File) => void) {
  let pastingText = false;
  return {
    handleDOMEvents: {
      copy: (view: EditorView, event: Event) => handleCopyOrCut(view, event as ClipboardEvent),
      cut: (view: EditorView, event: Event) => handleCopyOrCut(view, event as ClipboardEvent),
    },
    handlePaste(view: EditorView, event: ClipboardEvent): boolean {
      if (pastingText) return false; // our own plain-text paste, below
      if (!view.editable) return false;
      const data = event.clipboardData;
      if (!data) return false;
      const jotRaw = data.getData(JOT_CLIPBOARD_MIME);
      if (jotRaw) {
        const slice = parseJotSlice(jotRaw, view.state.schema);
        if (slice) {
          for (const plugin of view.state.plugins) {
            const fn = plugin.props.handlePaste;
            if (fn && fn.call(plugin, view, event, slice)) return true;
          }
          const single = slice.openStart === 0 && slice.openEnd === 0 && slice.content.childCount === 1 ? slice.content.firstChild : null;
          const tr = single ? view.state.tr.replaceSelectionWith(single, false) : view.state.tr.replaceSelection(slice);
          view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
          return true;
        }
      }
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
