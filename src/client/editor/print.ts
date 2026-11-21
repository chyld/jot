// Save as PDF: the browser's own print dialog, where the user picks "Save as PDF". The
// print rules at the end of styles.css leave only the note's title and body on the page.
// Fonts and the note's photos are waited for first so they are on the printed page, and
// the page title is the note's title while the dialog is open, so that is the file name
// the browser suggests.

/** Resolves once every photo in `root` has loaded (or failed to). */
function imagesLoaded(root: HTMLElement | null): Promise<unknown> {
  const pending = [...(root?.querySelectorAll('img') ?? [])].filter((img) => !img.complete);
  return Promise.all(
    pending.map(
      (img) =>
        new Promise((done) => {
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        }),
    ),
  );
}

export async function printNote(title: string, root: HTMLElement | null): Promise<void> {
  await document.fonts?.ready;
  await imagesLoaded(root);
  const before = document.title;
  document.title = title.trim() || 'Untitled';
  try {
    window.print(); // returns when the print dialog closes
  } finally {
    document.title = before;
  }
}
