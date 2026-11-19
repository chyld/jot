// Show spaces, tabs and line ends: display only. A dot for each space, an arrow for each
// tab, a return mark at a line break and a pilcrow at the end of each paragraph, drawn
// by CSS around ProseMirror decorations, so nothing is added to the note: not saved, not
// copied, not searched, not backed up. The choice is remembered in this browser.
import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const INVISIBLES_KEY = 'jot.showInvisibles';
const key = new PluginKey<{ on: boolean; deco: DecorationSet }>('invisibles');

function readPref(): boolean {
  try {
    return localStorage.getItem(INVISIBLES_KEY) === '1';
  } catch {
    return false;
  }
}

const marker = (cls: string) => () => {
  const s = document.createElement('span');
  s.className = cls;
  s.setAttribute('aria-hidden', 'true');
  return s;
};

function build(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.isText) {
      const t = node.text!;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === ' ') decos.push(Decoration.inline(pos + i, pos + i + 1, { class: 'inv-space' }));
        else if (t[i] === '\t') decos.push(Decoration.inline(pos + i, pos + i + 1, { class: 'inv-tab' }));
      }
      return false;
    }
    if (node.type.name === 'hardBreak') {
      decos.push(Decoration.widget(pos, marker('inv-break'), { side: -1, ignoreSelection: true, key: 'br' }));
      return false;
    }
    if (node.isTextblock) decos.push(Decoration.widget(pos + node.nodeSize - 1, marker('inv-para'), { side: 1, ignoreSelection: true, key: 'p' }));
    return true;
  });
  return DecorationSet.create(doc, decos);
}

export const Invisibles = Extension.create({
  name: 'invisibles',
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

export function invisiblesOn(editor: Editor): boolean {
  return key.getState(editor.state)?.on ?? false;
}

export function setInvisibles(editor: Editor, on: boolean) {
  try {
    if (on) localStorage.setItem(INVISIBLES_KEY, '1');
    else localStorage.removeItem(INVISIBLES_KEY);
  } catch {
    /* the choice just is not remembered */
  }
  editor.view.dispatch(editor.state.tr.setMeta(key, on).setMeta('addToHistory', false));
}
