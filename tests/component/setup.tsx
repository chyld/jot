// Shared setup for component tests (jsdom). ProseMirror measures layout through a few
// DOM APIs that jsdom does not implement; they are stubbed with empty rectangles.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { jotExtensions } from '../../src/client/editor/extensions';
import type { Style } from '../../src/shared/styles';
import type { Font } from '../../src/shared/types';

const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} };
const rects = Object.assign([], { item: () => null });
if (typeof Range !== 'undefined') {
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () => rects as unknown as DOMRectList;
}
if (typeof document !== 'undefined' && !document.elementFromPoint) {
  document.elementFromPoint = () => null;
}

const editors: Editor[] = [];
afterEach(() => {
  cleanup();
  editors.splice(0).forEach((e) => e.destroy());
});

export function makeEditor(content: unknown = '<p>Hello world</p>'): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({ element, extensions: jotExtensions(), content: content as any });
  editors.push(editor);
  return editor;
}

/** Selects the first occurrence of `text` in the document. */
export function select(editor: Editor, text: string) {
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    if (from >= 0 || !node.isText) return;
    const i = node.text!.indexOf(text);
    if (i >= 0) from = pos + i;
  });
  if (from < 0) throw new Error(`text not found: ${text}`);
  editor.commands.setTextSelection({ from, to: from + text.length });
}

/** The marks on the first text node containing `text`. */
export function marksOf(editor: Editor, text: string): Record<string, any> {
  let found: Record<string, any> | null = null;
  editor.state.doc.descendants((node) => {
    if (found || !node.isText || !node.text!.includes(text)) return;
    found = Object.fromEntries(node.marks.map((m) => [m.type.name, m.attrs]));
  });
  if (!found) throw new Error(`text not found: ${text}`);
  return found;
}

export const FONTS: Font[] = [
  { id: 'f-inter', family: 'Inter', category: 'Sans Serif', archived: false, isDefault: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'f-lora', family: 'Lora', category: 'Serif', archived: false, isDefault: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'f-caveat', family: 'Caveat', category: 'Handwriting', archived: false, isDefault: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'f-old', family: 'Old Standard TT', category: 'Serif', archived: true, isDefault: false, createdAt: '2026-01-01T00:00:00Z' },
];

export function style(partial: Partial<Style> & { name: string; fontFamily: string; size: number }): Style {
  return {
    id: `s-${partial.name}`,
    fontId: `f-${partial.fontFamily.toLowerCase()}`,
    fontArchived: false,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    textColor: null,
    highlight: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

export const STYLES: Style[] = [
  style({ name: 'Body', fontFamily: 'Inter', size: 16, textColor: 'Jet' }),
  style({ name: 'Quote', fontFamily: 'Lora', size: 20, italic: true, textColor: 'Violet' }),
  style({ name: 'Key Term', fontFamily: 'Inter', size: 16, bold: true, highlight: 'Sunflower' }),
];
