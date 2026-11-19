// The Tags page: every tag with the number of notes that carry it. A tag can be deleted
// here, which takes it off every note; the notes themselves are kept.
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Tag } from '../../shared/types';
import { api } from '../api';
import { useData } from '../data';
import { homeHref, navigate } from '../router';

const noteCount = (n: number) => (n === 1 ? '1 note' : `${n} notes`);

/** One tag. Delete asks once more in the page, saying what happens to the notes. */
function TagItem(props: { tag: Tag; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = props.tag;
  const href = homeHref(t.name);
  return (
    <li className="card tag-item" data-tag={t.name} aria-label={`#${t.name}`}>
      <a
        href={href}
        className="tag-chip"
        title={`Notes tagged ${t.name}`}
        onClick={(e) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // let the browser open new tabs
          e.preventDefault();
          navigate(href);
        }}
      >
        #{t.name}
      </a>
      <span className="muted tag-count" data-testid="tag-count">
        {noteCount(t.count)}
      </span>
      {confirming ? (
        <div className="card-actions" role="group" aria-label={`Delete tag ${t.name}`}>
          <span className="small">
            #{t.name} will be removed from every note that has it ({noteCount(t.count)}, plus any in the Inbox or the trash). The notes are kept.
          </span>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api.deleteTag(t.name);
                props.onDeleted();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not delete the tag.');
                setBusy(false);
              }
            }}
          >
            Confirm: delete tag
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="card-actions">
          <button type="button" className="btn btn-sm" aria-label={`Delete tag ${t.name}`} onClick={() => setConfirming(true)}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}
      {error && (
        <span role="alert" className="form-error">
          {error}
        </span>
      )}
    </li>
  );
}

export function TagsScreen() {
  const { notesVersion, bumpNotes } = useData();
  const [tags, setTags] = useState<Tag[] | null>(null);
  useEffect(() => {
    api.tags().then((r) => setTags(r.tags), () => setTags([]));
  }, [notesVersion]);
  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Tags</h1>
        {tags && <span className="muted">{tags.length === 1 ? '1 tag' : `${tags.length} tags`}</span>}
      </div>
      {tags?.length === 0 && <p className="muted">No tags yet. Add tags to a note while editing it.</p>}
      <ul className="tag-list" data-testid="tag-list">
        {tags?.map((t) => (
          // Deleting changes the notes' tags, so every list of notes loads again.
          <TagItem key={t.name} tag={t} onDeleted={bumpNotes} />
        ))}
      </ul>
    </div>
  );
}
