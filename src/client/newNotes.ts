// Notes just created with a New button in this page. The editor puts the caret in the
// body of such a note once it has loaded it, so the user can type at once. Reopening a
// note later (or reloading it) finds no mark and leaves the focus alone.
const fresh = new Set<string>();

export function markNewNote(id: string) {
  fresh.add(id);
}

/** True once for a note marked by markNewNote. */
export function takeNewNote(id: string): boolean {
  return fresh.delete(id);
}
