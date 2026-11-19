// Shown when the cursor is in a table: Tiptap's standard table commands.
// (Column resize is built into the table itself: drag a column border.)
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';

const COMMANDS = [
  ['Add column before', 'addColumnBefore'],
  ['Add column after', 'addColumnAfter'],
  ['Delete column', 'deleteColumn'],
  ['Add row before', 'addRowBefore'],
  ['Add row after', 'addRowAfter'],
  ['Delete row', 'deleteRow'],
  ['Header row', 'toggleHeaderRow'],
  ['Header column', 'toggleHeaderColumn'],
  ['Merge cells', 'mergeCells'],
  ['Split cell', 'splitCell'],
  ['Delete table', 'deleteTable'],
] as const;

export function TableControls(props: { editor: Editor }) {
  const can = useEditorState({
    editor: props.editor,
    selector: ({ editor }) => Object.fromEntries(COMMANDS.map(([, cmd]) => [cmd, (editor.can() as any)[cmd]()])),
  }) as Record<string, boolean>;
  return (
    <div className="context-bar" role="toolbar" aria-label="Table">
      <span className="context-title">Table</span>
      {COMMANDS.map(([label, cmd]) => (
        <button
          key={cmd}
          type="button"
          className={`ctx-btn ${cmd === 'deleteTable' ? 'ctx-danger' : ''}`}
          disabled={!can[cmd]}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (props.editor.chain().focus() as any)[cmd]().run()}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
