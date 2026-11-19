// The photo node: Tiptap's Image extended with width, border size and border colour,
// stored with the photo in the note. Jot draws it with its own small node view so
// width and border changes from the photo controls show immediately, and grab handles
// on all four corners resize it by dragging (keeping the aspect ratio).
import Image from '@tiptap/extension-image';
import { MAX_BORDER_WIDTH } from '../../shared/constants';
import { borderColorHex, findPalette } from '../../shared/palette';

export const DEFAULT_BORDER_COLOR = 'Jet';
export const MIN_PHOTO_WIDTH = 40;
export const MAX_PHOTO_WIDTH = 4000;

export const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type Corner = (typeof CORNERS)[number];

/** Live width while a corner is being dragged, so the photo controls can follow. */
export const photoResizeEvents = new EventTarget();

export const clampPhotoWidth = (w: number) => Math.round(Math.min(MAX_PHOTO_WIDTH, Math.max(MIN_PHOTO_WIDTH, w)));

/**
 * New width for a corner drag. Right-hand corners grow when dragged right, left-hand
 * ones when dragged left; top/bottom likewise vertically. Whichever movement is larger
 * (vertical scaled by the aspect ratio) decides, so the photo keeps its proportions.
 */
export function cornerDragWidth(corner: Corner, startWidth: number, ratio: number, dx: number, dy: number): number {
  const sx = corner.endsWith('right') ? 1 : -1;
  const sy = corner.startsWith('bottom') ? 1 : -1;
  const r = ratio > 0 && Number.isFinite(ratio) ? ratio : 1;
  const delta = Math.abs(dx) >= Math.abs(dy * r) ? sx * dx : sy * dy * r;
  return clampPhotoWidth(startWidth + delta);
}

function borderCss(width: unknown, color: unknown): string {
  const w = typeof width === 'number' ? Math.max(0, Math.min(MAX_BORDER_WIDTH, Math.round(width))) : 0;
  if (w === 0) return '';
  return `${w}px solid ${borderColorHex(color) ?? borderColorHex(DEFAULT_BORDER_COLOR)}`;
}

export const Photo = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const n = parseInt(el.getAttribute('width') ?? '', 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (a) => (a.width ? { width: String(a.width) } : {}),
      },
      borderWidth: {
        default: 0,
        parseHTML: (el) => {
          const n = parseInt(el.getAttribute('data-border-width') ?? '0', 10);
          return Number.isFinite(n) ? Math.max(0, Math.min(MAX_BORDER_WIDTH, n)) : 0;
        },
        renderHTML: (a) => (a.borderWidth ? { 'data-border-width': String(a.borderWidth) } : {}),
      },
      borderColor: {
        default: null,
        parseHTML: (el) => findPalette(el.getAttribute('data-border-color'))?.name ?? null,
        renderHTML: (a) => (a.borderColor ? { 'data-border-color': a.borderColor } : {}),
      },
    };
  },

  renderHTML({ HTMLAttributes, node }) {
    const style = [node.attrs.width ? `width: ${node.attrs.width}px` : '', borderCss(node.attrs.borderWidth, node.attrs.borderColor) ? `border: ${borderCss(node.attrs.borderWidth, node.attrs.borderColor)}` : '']
      .filter(Boolean)
      .join('; ');
    return ['img', { ...HTMLAttributes, ...(style ? { style } : {}) }];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'jot-photo';
      dom.dataset.testid = 'photo';
      const img = document.createElement('img');
      img.draggable = false;
      // Handles sit on the outer corners of the photo, border included.
      const handles = CORNERS.map((corner) => {
        const h = document.createElement('span');
        h.className = `jot-photo-handle jot-photo-handle-${corner}`;
        h.dataset.corner = corner;
        h.contentEditable = 'false';
        h.setAttribute('aria-hidden', 'true');
        return h;
      });
      dom.append(img, ...handles);

      const apply = (n: typeof node) => {
        if (img.getAttribute('src') !== n.attrs.src) img.setAttribute('src', n.attrs.src ?? '');
        img.alt = n.attrs.alt ?? '';
        img.style.width = n.attrs.width ? `${n.attrs.width}px` : '';
        img.style.border = borderCss(n.attrs.borderWidth, n.attrs.borderColor);
        img.dataset.borderWidth = String(n.attrs.borderWidth ?? 0);
        if (n.attrs.borderColor) img.dataset.borderColor = n.attrs.borderColor;
        else delete img.dataset.borderColor;
      };
      apply(node);

      const startDrag = (corner: Corner) => (e: MouseEvent) => {
        if (!editor.isEditable || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const rect = img.getBoundingClientRect();
        const startWidth = rect.width;
        const ratio = rect.height > 0 ? rect.width / rect.height : 1;
        let width = clampPhotoWidth(startWidth);
        dom.classList.add('is-resizing');
        document.body.dataset.photoResizing = corner;
        const move = (ev: MouseEvent) => {
          width = cornerDragWidth(corner, startWidth, ratio, ev.clientX - startX, ev.clientY - startY);
          img.style.width = `${width}px`;
          photoResizeEvents.dispatchEvent(new CustomEvent('resize', { detail: { width } }));
        };
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          dom.classList.remove('is-resizing');
          delete document.body.dataset.photoResizing;
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (typeof pos === 'number') {
            editor.chain().setNodeSelection(pos).updateAttributes('image', { width, height: null }).run();
          }
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      };
      handles.forEach((h) => h.addEventListener('mousedown', startDrag(h.dataset.corner as Corner)));

      return {
        dom,
        update(n) {
          if (n.type !== current.type) return false;
          current = n;
          apply(n);
          return true;
        },
        selectNode() {
          dom.classList.add('is-selected');
        },
        deselectNode() {
          dom.classList.remove('is-selected');
        },
        stopEvent(e) {
          return handles.includes(e.target as HTMLSpanElement);
        },
        ignoreMutation() {
          return true;
        },
      };
    };
  },
}).configure({ inline: false, allowBase64: false });
