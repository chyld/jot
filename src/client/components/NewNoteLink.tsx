// A New button that is also a link to /new (the bookmarkable address, see App.tsx).
//
// A plain click, Enter or Space creates the note in place through createAndOpenNote; every
// activation makes a note. Because it is a real link, it can also be dragged to the bookmarks bar, copied, or opened in a
// new tab (middle-click, Ctrl/Cmd/Shift-click), and there /new makes the note.
import { createAndOpenNote } from '../newNotes';

export function NewNoteLink(props: {
  className: string;
  bump: () => void;
  onError: (message: string | null) => void;
  label?: string;
  children: React.ReactNode;
}) {
  const create = () => void createAndOpenNote(props.bump).then(props.onError);
  return (
    <a
      href="/new"
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
