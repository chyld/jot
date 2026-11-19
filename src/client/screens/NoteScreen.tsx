// A note open in the editor, full screen (everything but the left bar).
import { useData } from '../data';
import { NoteEditor } from './NoteEditor';

export function NoteScreen(props: { noteId: string }) {
  const { bumpNotes } = useData();
  return (
    <section className="note-pane full">
      <NoteEditor key={props.noteId} noteId={props.noteId} onTrashed={bumpNotes} />
    </section>
  );
}
