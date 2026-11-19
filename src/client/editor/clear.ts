// Clear formatting: with a selection, removes all formatting from it (font, size, text
// colour, highlight, bold, italic, underline, strikethrough, inline code) and turns
// headings, list items and block quotes in it back into normal paragraphs. Text, links,
// tables and photos stay. With nothing selected it does the same to the current
// paragraph and leaves the cursor where it was. Either way what is typed next is plain.
// One transaction, so one undo step.
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

const CLEARED = ['textStyle', 'highlight', 'bold', 'italic', 'underline', 'strike', 'code'];

export function clearFormatting(editor: Editor): boolean {
  const original = editor.state.selection;
  let chain = editor.chain().focus();
  if (original.empty) {
    const { $from } = original;
    if (!$from.parent.isTextblock) return false;
    chain = chain.setTextSelection({ from: $from.start(), to: $from.end() });
  }
  chain = chain.clearNodes(); // headings, list items, quotes -> paragraphs (tables and photos stay)
  for (const mark of CLEARED) chain = chain.unsetMark(mark);
  return chain
    .command(({ tr }) => {
      if (original.empty) tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(original.from)));
      tr.setStoredMarks([]);
      return true;
    })
    .run();
}
