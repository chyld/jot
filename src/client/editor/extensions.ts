// The Tiptap extensions Jot uses (verified against Tiptap 3.34 documentation and source):
//  - StarterKit: paragraphs, headings, lists, blockquote, code, HR, bold/italic/
//    underline/strike, link, undo/redo.
//  - @tiptap/extension-text-style: TextStyle + FontFamily + FontSize + Color.
//  - @tiptap/extension-highlight with multicolor.
//  - @tiptap/extension-list: TaskList + TaskItem.
//  - @tiptap/extension-table: Table (resizable: true gives column resize), rows, cells.
//  - Photo: Tiptap's Image extended with width and border (./photo.ts).
import StarterKit from '@tiptap/starter-kit';
import { Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Photo } from './photo';

export function jotExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: false, // pasted text never becomes a link (paste is plain text)
        defaultProtocol: 'https',
        protocols: ['http', 'https', 'mailto'],
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      },
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
  ];
}
