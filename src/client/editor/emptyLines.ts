// Show empty lines: display only. Each empty top-level paragraph or heading (including the
// trailing one) gets a class, and CSS draws a small dot in the left gutter, so nothing is
// added to the note: not saved, not copied, not searched, not backed up. The choice is
// remembered in this browser, the same way as Show spaces, tabs and line ends.
import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const EMPTY_LINES_KEY = 'jot.showEmptyLines';
const key = new PluginKey<{ on: boolean; deco: DecorationSet }>('emptyLines');

function readPref(): boolean {
  try {
    return localStorage.getItem(EMPTY_LINES_KEY) === '1';
  } catch {
    return false;
  }
}

function build(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.forEach((node, pos) => {
    if (node.isTextblock && node.content.size === 0) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'empty-line' }));
  });
  return DecorationSet.create(doc, decos);
}

export const EmptyLines = Extension.create({
  name: 'emptyLines',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: (_config, state: EditorState) => {
            const on = readPref();
            return { on, deco: on ? build(state.doc) : DecorationSet.empty };
          },
          apply(tr, value, _old, state) {
            const meta = tr.getMeta(key) as boolean | undefined;
            const on = meta ?? value.on;
            if (!on) return { on, deco: DecorationSet.empty };
            if (meta !== undefined || tr.docChanged) return { on, deco: build(state.doc) };
            return value;
          },
        },
        props: {
          decorations: (state) => key.getState(state)?.deco ?? DecorationSet.empty,
        },
      }),
    ];
  },
});

export function emptyLinesOn(editor: Editor): boolean {
  return key.getState(editor.state)?.on ?? false;
}

export function setEmptyLines(editor: Editor, on: boolean) {
  try {
    if (on) localStorage.setItem(EMPTY_LINES_KEY, '1');
    else localStorage.removeItem(EMPTY_LINES_KEY);
  } catch {
    /* the choice just is not remembered */
  }
  editor.view.dispatch(editor.state.tr.setMeta(key, on).setMeta('addToHistory', false));
}
