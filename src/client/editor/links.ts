// Opening links in a note. Ctrl+click (Cmd+click on a Mac) opens the link in a new tab;
// a plain click places the cursor so the link text can be edited. In a read-only note
// (nothing to edit) a plain click opens it. Only http, https and mailto links open (the
// server's sanitiser keeps no others).
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

const SAFE = /^(https?:\/\/|mailto:)/i;

export const LinkOpener = Extension.create({
  name: 'linkOpener',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            // Ctrl/Cmd+mousedown on a link is ours: ProseMirror would select the whole
            // paragraph (its modifier-click node selection), and the next keystroke would
            // replace it. Taking the event here leaves the selection exactly as it was.
            mousedown(view, event) {
              const a = (event.target as Element | null)?.closest?.('a[href]');
              if (!a || !view.dom.contains(a) || event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
              event.preventDefault();
              return true;
            },
            click(view, event) {
              const a = (event.target as Element | null)?.closest?.('a[href]');
              if (!a || !view.dom.contains(a)) return false;
              event.preventDefault(); // never let the browser follow it by itself
              const open = !view.editable || event.ctrlKey || event.metaKey;
              const href = a.getAttribute('href') ?? '';
              if (open && SAFE.test(href.trim())) window.open(href, '_blank', 'noopener,noreferrer');
              return open;
            },
          },
        },
      }),
    ];
  },
});
