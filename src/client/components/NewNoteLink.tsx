// A New button that is also a link to /new (the bookmarkable address, see App.tsx).
//
// A plain click, Enter or Space creates the note in place through createAndOpenNote; every
// activation makes a note. Because it is a real link, it can also be dragged to the bookmarks bar, copied, or opened in a
// new tab (middle-click, Ctrl/Cmd/Shift-click), and there /new makes the note.
import type { NoteKind } from '../../shared/types';
import { createAndOpenNote } from '../newNotes';

export function NewNoteLink(props: {
  className: string;
  bump: () => void;
  onError: (message: string | null) => void;
  kind?: NoteKind;
  label?: string;
  children: React.ReactNode;
}) {
  const kind = props.kind ?? 'doc';
  const href = kind === 'sheet' ? '/new?kind=sheet' : kind === 'board' ? '/new?kind=board' : '/new';
  const create = () => void createAndOpenNote(props.bump, { kind }).then(props.onError);
  return (
    <a
      href={href}
      role="button"
      className={props.className}
      aria-label={props.label}
      title={props.label}
      onClick={(e) => {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // the browser opens /new
        e.preventDefault();
        create();
      }}
      onKeyDown={(e) => {
        if (e.key !== ' ') return; // Enter already clicks a link; Space does not
        e.preventDefault();
        create();
      }}
    >
      {props.children}
    </a>
  );
}
