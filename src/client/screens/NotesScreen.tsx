// The home page: the user's notes as a list, with search, a New button and a tag
// filter. The tag filter is how notes are browsed by tag; it lives in the URL
// (/?tag=name) so a tag name clicked anywhere can open the home page filtered.
// Opening a note goes to its own full-screen editor page.
import { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { NoteSummary, Tag } from '../../shared/types';
import { api } from '../api';
import { NoteCard, useNow } from '../components/NoteCard';
import { createAndOpenNote } from '../newNotes';
import { useData } from '../data';
import { homeHref, navigate } from '../router';

export function NotesScreen(props: { tag: string | null }) {
  const [newError, setNewError] = useState<string | null>(null);
  const { notesVersion, bumpNotes } = useData();
  const [query, setQuery] = useState('');
  const tag = props.tag || null;
  const setTag = (t: string | null) => navigate(homeHref(t));
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const now = useNow();
  // The note last moved to the trash from this list, so it can be put back with Undo.
  const [trashed, setTrashed] = useState<{ id: string; title: string } | null>(null);
  const [trashError, setTrashError] = useState<string | null>(null);
  const trash = async (n: NoteSummary) => {
    setTrashError(null);
    try {
      await api.trashNote(n.id);
      setTrashed({ id: n.id, title: n.title || 'Untitled' });
      bumpNotes();
    } catch (e) {
      setTrashError(e instanceof Error ? e.message : 'Could not move the note to the trash.');
    }
  };
  const undoTrash = async () => {
    if (!trashed) return;
    setTrashError(null);
    try {
      await api.restore(trashed.id);
      setTrashed(null);
      bumpNotes();
    } catch (e) {
      setTrashError(e instanceof Error ? e.message : 'Could not restore the note.');
    }
  };

  useEffect(() => {
    api.tags().then((r) => setTags(r.tags), () => setTags([]));
  }, [notesVersion]);
  // A tag no live note uses any more (or a mistyped URL) stops filtering.
  useEffect(() => {
    if (tag && tags && !tags.some((t) => t.name === tag)) navigate(homeHref(null), { replace: true });
  }, [tags, tag]);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    const t = setTimeout(
      async () => {
        try {
          // Search and the tag filter combine: search results are narrowed to the tag.
          const r = q ? await api.search(q) : await api.notes(tag ?? undefined);
          if (!cancelled) setNotes(q && tag ? r.notes.filter((n) => n.tags.includes(tag)) : r.notes);
        } catch {
          if (!cancelled) setNotes([]);
        }
      },
      q ? 200 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, tag, notesVersion]);

  const filtering = query.trim() !== '' || tag !== null;
  return (
    <div className="screen home">
      <div className="screen-head">
        <h1>Notes</h1>
        <label className="search-box grow">
          <Search size={16} />
          <input type="search" placeholder="Search notes" aria-label="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" onClick={() => void createAndOpenNote(bumpNotes).then(setNewError)}>
          <Plus size={16} /> New
        </button>
      </div>
      {newError && (
        <div role="alert" className="banner banner-error">
          {newError}
        </div>
      )}
      {trashError && (
        <div role="alert" className="banner banner-error">
          {trashError}
        </div>
      )}
      {trashed && (
        <div role="status" className="banner undo-banner" data-testid="trash-undo">
          <span>Moved “{trashed.title}” to the trash.</span>
          <button type="button" className="btn btn-sm" onClick={() => void undoTrash()}>
            Undo
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setTrashed(null)}>
            Dismiss
          </button>
        </div>
      )}
      <div className="tag-filter" role="group" aria-label="Filter by tag">
        <button type="button" className={`filter-chip ${tag === null ? 'is-selected' : ''}`} aria-pressed={tag === null} onClick={() => setTag(null)}>
          All
        </button>
        {(tags ?? []).map((t) => (
          <button
            key={t.name}
            type="button"
            className={`filter-chip ${tag === t.name ? 'is-selected' : ''}`}
            aria-pressed={tag === t.name}
            onClick={() => setTag(tag === t.name ? null : t.name)}
          >
            #{t.name}
          </button>
        ))}
      </div>
      <div className="notes-list wide" data-testid="notes-list">
        {notes === null && <div className="muted pad">Loading…</div>}
        {notes?.length === 0 && <div className="muted pad">{filtering ? 'No notes match.' : 'No notes yet. Create one with New.'}</div>}
        {notes?.map((n) => <NoteCard key={n.id} note={n} now={now} onTrash={() => void trash(n)} />)}
      </div>
    </div>
  );
}
