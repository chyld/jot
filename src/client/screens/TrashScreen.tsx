import { useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { relativeTime } from '../../shared/time';
import type { NoteSummary } from '../../shared/types';
import { api } from '../api';
import { useNow } from '../components/NoteCard';
import { useData } from '../data';

function TrashItem(props: { note: NoteSummary; now: Date; onRestore: () => void; onPurge: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const n = props.note;
  return (
    <li className="card trash-item" data-note-id={n.id} aria-label={n.title || 'Untitled'}>
      <div className="trash-text">
        <div className="note-card-title">{n.title || 'Untitled'}</div>
        {n.preview && <div className="note-card-preview">{n.preview}</div>}
        <div className="muted small">Deleted {relativeTime(n.deletedAt!, props.now)}</div>
      </div>
      <div className="card-actions">
        <button type="button" className="btn btn-sm" onClick={props.onRestore}>
          <RotateCcw size={14} /> Restore
        </button>
        {confirming ? (
          <>
            <button type="button" className="btn btn-sm btn-danger" onClick={props.onPurge}>
              Confirm: delete forever
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => setConfirming(true)}>
            <Trash2 size={14} /> Delete permanently
          </button>
        )}
      </div>
    </li>
  );
}

export function TrashScreen() {
  const { bumpNotes } = useData();
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const now = useNow();
  const load = () => api.trash().then((r) => setNotes(r.notes), () => setNotes([]));
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Trash</h1>
        {notes && <span className="muted">{notes.length} {notes.length === 1 ? 'note' : 'notes'}</span>}
      </div>
      {notes?.length === 0 && <p className="muted">The trash is empty.</p>}
      <ul className="trash-list">
        {notes?.map((n) => (
          <TrashItem
            key={n.id}
            note={n}
            now={now}
            onRestore={async () => {
              await api.restore(n.id);
              bumpNotes();
              await load();
            }}
            onPurge={async () => {
              await api.purge(n.id);
              await load();
            }}
          />
        ))}
      </ul>
    </div>
  );
}
