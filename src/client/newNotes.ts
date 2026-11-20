// Creating a note with a New button (the left-bar + or the home page's + New) or the
// /new address (App.tsx).
//
// Every activation creates a note: nothing is guarded, held or reused (owner decision).
// A double-click makes two notes.
//
// The editor puts the caret in the body of a note marked here once it has loaded it.
// Reopening a note later (or reloading it) finds no mark and leaves the focus alone.
import { api } from './api';
import { navigate } from './router';

const fresh = new Set<string>();

/**
 * Creates a note and opens it. Returns an error message if the create failed. `replace`
 * replaces the current address instead of adding one (used by /new, so Back and Refresh
 * never come back to it).
 */
export async function createAndOpenNote(bump: () => void, opts: { replace?: boolean } = {}): Promise<string | null> {
  try {
    const { note } = await api.createNote();
    fresh.add(note.id);
    bump();
    navigate(`/n/${note.id}`, { replace: opts.replace });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Could not create a note.';
  }
}

/** Called by the editor once it holds a note. True once, for a note just created here. */
export function takeNewNote(id: string): boolean {
  return fresh.delete(id);
}
