// The Inbox: notes bots wrote that the user has not kept yet, newest first, each showing
// its bot's name. Keep moves a note into the current section (the bot's name stays on it).
// The Inbox is not divided by section: it shows every Inbox note whichever is current.
// Opening a note opens the normal editor.
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { NoteSummary } from '../../shared/types';
import { api } from '../api';
import { NoteCard, useNow } from '../components/NoteCard';
import { useSections } from '../currentSection';
import { useData } from '../data';

export function InboxScreen() {
  const { bumpNotes, reloadInbox } = useData();
  const { current } = useSections();
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();
  const load = () =>
    api.inbox().then(
      (r) => setNotes(r.notes),
      () => setNotes([]),
    );
  useEffect(() => {
    void load();
  }, []);
  const keep = async (n: NoteSummary) => {
    setError(null);
    try {
      await api.keep(n.id);
      bumpNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not keep the note.');
    }
    await load();
    await reloadInbox();
  };
  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Inbox</h1>
        {notes && <span className="muted">{notes.length} {notes.length === 1 ? 'note' : 'notes'} from bots</span>}
      </div>
      <p className="muted hint">Notes your bots wrote. Keep moves a note into the current section, {current.name}; you can also open, edit or trash it.</p>
      {error && (
        <div role="alert" className="banner banner-error">
          {error}
        </div>
      )}
      {notes?.length === 0 && <p className="muted">The Inbox is empty.</p>}
      <ul className="inbox-list">
        {notes?.map((n) => (
          <li key={n.id} className="inbox-item">
            <NoteCard note={n} now={now} />
            <button type="button" className="btn btn-sm btn-primary inbox-keep" aria-label={`Keep ${n.title || 'Untitled'}`} title={`Keep in ${current.name}`} onClick={() => void keep(n)}>
              <Check size={14} /> Keep in {current.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
