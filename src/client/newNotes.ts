// Creating a note with a New button (the left-bar + or the home page's + New).
//
// One intent creates one note. A single in-flight flag, shared by both buttons, is set
// when one is activated and cleared once the new note's editor is ready (or the create
// fails). While it is set, further activations are ignored, never queued. Focus leaves the
// button at once, so Enter or Space cannot press it again, and the keys typed in the
// meantime are held and then typed into the note's body, in order. No timers: a
// deliberate press after the new note is open still creates another note.
//
// One more rule (owner decision): if the note open in the editor is completely empty (no
// title, no body, no tags, not read-only, not trashed, judged from the editor's current
// state), a New button does not create another note; it puts the cursor in that note's
// body. That stops bursts the flag alone cannot (the editor is ready before the next
// click), and nobody needs a second empty note while sitting in an empty one.
//
// The editor puts the caret in the body of a note marked here once it has loaded it.
// Reopening a note later (or reloading it) finds no mark and leaves the focus alone.
import { api } from './api';
import { navigate } from './router';

const fresh = new Set<string>();

/** The note open in the editor, as the editor sees it right now. */
export interface OpenNote {
  isEmpty: () => boolean;
  focusBody: () => void;
}
let openNote: OpenNote | null = null;

/** The editor registers the open note while it is on screen. */
export function setOpenNote(note: OpenNote) {
  openNote = note;
}

/** The editor closed: forget its note (unless another editor has registered since). */
export function clearOpenNote(note: OpenNote) {
  if (openNote === note) openNote = null;
}
let creating = false;
let typed: string[] = []; // characters, and '\n' for Enter

function holdKeys(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  if (e.key.length === 1) typed.push(e.key);
  else if (e.key === 'Enter') typed.push('\n');
  else if (e.key === 'Backspace') typed.pop();
  else return;
  e.preventDefault(); // and nothing else sees it: no button press, no stray input
  e.stopPropagation();
}

function finish(): string[] {
  creating = false;
  window.removeEventListener('keydown', holdKeys, true);
  const keys = typed;
  typed = [];
  return keys;
}

/**
 * Creates a note and opens it; ignored while another is being created. Returns an error
 * message if the create failed (the guard is then released).
 */
export async function createAndOpenNote(bump: () => void): Promise<string | null> {
  if (creating) return null;
  if (openNote?.isEmpty()) {
    openNote.focusBody(); // reuse the empty note that is already open
    return null;
  }
  creating = true;
  typed = [];
  window.addEventListener('keydown', holdKeys, true);
  (document.activeElement as HTMLElement | null)?.blur?.();
  try {
    const { note } = await api.createNote();
    fresh.add(note.id);
    bump();
    navigate(`/n/${note.id}`);
    return null;
  } catch (err) {
    finish();
    return err instanceof Error ? err.message : 'Could not create a note.';
  }
}

/**
 * Called by the editor once it holds a note. True once for a note just created here: the
 * guard is released and the keys typed meanwhile are returned, to be typed into the body.
 */
export function takeNewNote(id: string): string[] | null {
  if (!fresh.delete(id)) return null;
  return finish();
}

/** The new note could not be opened: release the guard. */
export function dropNewNote(id: string) {
  if (fresh.delete(id)) finish();
}
