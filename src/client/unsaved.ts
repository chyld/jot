// Edits the server has not confirmed yet, kept in this browser (localStorage) so they
// survive a failed save, a closed tab or a reload. Kept per user and per note, and
// cleared at logout, so one user's unsaved text is never shown to another.
export type UnsavedPatch = { title?: string; content?: unknown };

const PREFIX = 'jot.unsaved.';
/** Users who logged out in this page: nothing more is stored for them until they log in again. */
const loggedOut = new Set<string>();
export const unsavedKey = (userId: string, noteId: string) => `${PREFIX}${userId}.${noteId}`;

export function loadUnsaved(userId: string, noteId: string): UnsavedPatch | null {
  try {
    const raw = localStorage.getItem(unsavedKey(userId, noteId));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as UnsavedPatch) : null;
  } catch {
    return null;
  }
}

export function storeUnsaved(userId: string, noteId: string, patch: UnsavedPatch) {
  if (loggedOut.has(userId)) return; // e.g. the editor's last save failing after logout
  try {
    localStorage.setItem(unsavedKey(userId, noteId), JSON.stringify(patch));
  } catch {
    // Storage full or blocked: the edit is still on screen and still being saved.
  }
}

export function clearUnsaved(userId: string, noteId: string) {
  try {
    localStorage.removeItem(unsavedKey(userId, noteId));
  } catch {
    /* nothing to do */
  }
}

/** At logout: forget every unsaved edit of this user, and keep no new ones. */
export function clearAllUnsaved(userId: string) {
  loggedOut.add(userId);
  try {
    const mine = `${PREFIX}${userId}.`;
    for (const k of Object.keys(localStorage)) if (k.startsWith(mine)) localStorage.removeItem(k);
  } catch {
    /* nothing to do */
  }
}

/** At login: this user's edits are kept again. */
export function resumeUnsaved(userId: string) {
  loggedOut.delete(userId);
}
