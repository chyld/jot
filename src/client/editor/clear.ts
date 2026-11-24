// Clear formatting: with a selection, removes all formatting from it (font, size, text
// colour, highlight, bold, italic, underline, strikethrough, inline code) and turns
// headings, list items and block quotes in it back into normal paragraphs. Text, links,
// tables and photos stay, and what is typed next is plain. With nothing selected, nothing
// already written changes: only the pending formatting is reset so what is typed next is
// plain. One transaction, so one undo step.
import type { Editor } from '@tiptap/core';

const CLEARED = ['textStyle', 'highlight', 'bold', 'italic', 'underline', 'strike', 'code'];

export function clearFormatting(editor: Editor): boolean {
  const original = editor.state.selection;
  if (original.empty) {
    if (!original.$from.parent.isTextblock) return false;
    return editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setStoredMarks([]);
        return true;
      })
      .run();
  }
  let chain = editor.chain().focus().clearNodes(); // headings, list items, quotes -> paragraphs (tables and photos stay)
  for (const mark of CLEARED) chain = chain.unsetMark(mark);
  return chain
    .command(({ tr }) => {
      tr.setStoredMarks([]);
      return true;
    })
    .run();
}
