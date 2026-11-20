// The Tiptap extensions Jot uses (verified against Tiptap 3.34 documentation and source):
//  - StarterKit: paragraphs, headings, lists, blockquote, code, HR, bold/italic/
//    underline/strike, link, undo/redo.
//  - @tiptap/extension-text-style: TextStyle + FontFamily + FontSize + Color.
//  - @tiptap/extension-highlight with multicolor.
//  - @tiptap/extension-list: TaskList + TaskItem, and OrderedList extended (below).
//  - @tiptap/extension-table: Table (resizable: true gives column resize), rows, cells.
//  - Photo: Tiptap's Image extended with width and border (./photo.ts).
import StarterKit from '@tiptap/starter-kit';
import { mergeAttributes } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import { Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import { OrderedList, TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Invisibles } from './invisibles';
import { LinkOpener } from './links';
import { Photo } from './photo';

/** Tiptap's link, with the hint for opening it drawn on screen (not stored with the link). */
const JotLink = Link.extend({
  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { title: 'Ctrl+click to open' }), 0];
  },
});

/**
 * Tiptap's numbered list, also writing an explicit type="1" (Tiptap leaves it out). The note
 * styles number nested lists 1. a. i. by depth only when the list has no type of its own.
 */
const JotOrderedList = OrderedList.extend({
  renderHTML({ HTMLAttributes }) {
    const { start, type, ...rest } = HTMLAttributes;
    return ['ol', mergeAttributes(this.options.HTMLAttributes, rest, start !== 1 ? { start } : {}, type ? { type } : {}), 0];
  },
});

export function jotExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      orderedList: false,
    }),
    JotOrderedList,
    JotLink.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: false, // pasted text never becomes a link (paste is plain text)
      defaultProtocol: 'https',
      protocols: ['http', 'https', 'mailto'],
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    }),
    TextStyle,
    FontFamily,
    FontSize,
    Color,
    Highlight.configure({ multicolor: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true, cellMinWidth: 50 }),
    TableRow,
    TableHeader,
    TableCell,
    Photo,
    LinkOpener,
    Invisibles,
  ];
}
