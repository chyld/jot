// Note content is stored as Tiptap JSON, never as HTML. Before saving, it is rebuilt
// from a whitelist: unknown nodes, marks and attributes are dropped, and every
// attribute value is checked (palette colours, sizes, font names, photo URLs,
// link protocols). This is what stops script and CSS injection through notes.
import { MAX_BORDER_WIDTH, MAX_FONT_SIZE, MIN_BORDER_WIDTH, MIN_FONT_SIZE } from '../shared/constants';
import { findPalette, normalizeHighlightColor, normalizeTextColor } from '../shared/palette';
import type { TiptapDoc, TiptapNode } from '../shared/types';

export const MAX_DEPTH = 64;

export class ContentError extends Error {}

type Attrs = Record<string, unknown>;
type AttrRule = (v: unknown) => unknown | undefined; // undefined = drop

const int = (min: number, max: number): AttrRule => (v) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
const bool: AttrRule = (v) => (typeof v === 'boolean' ? v : undefined);

const PHOTO_SRC = /^\/api\/photos\/[A-Za-z0-9_-]{1,64}$/;
const FONT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ]{0,99}$/;

/** Font family as the editor writes it: the family name in double quotes. */
export function normalizeFontFamily(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const name = v.trim().replace(/^["']|["']$/g, '');
  return FONT_NAME.test(name) ? `"${name}"` : undefined;
}

export function normalizeFontSize(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^(\d{1,3})px$/.exec(v.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= MIN_FONT_SIZE && n <= MAX_FONT_SIZE ? `${n}px` : undefined;
}

export function isSafeHref(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 2000) return false;
  // Browsers ignore control characters and whitespace in schemes, so check without them.
  // eslint-disable-next-line no-control-regex
  const compact = v.replace(/[\u0000- ]/g, '').toLowerCase();
  return /^(https?:\/\/|mailto:)/.test(compact) && /^(https?:\/\/|mailto:)/i.test(v.trim());
}

const NODE_ATTRS: Record<string, Record<string, AttrRule>> = {
  doc: {},
  paragraph: {},
  text: {},
  hardBreak: {},
  horizontalRule: {},
  blockquote: {},
  bulletList: {},
  listItem: {},
  taskList: {},
  taskItem: { checked: bool },
  orderedList: { start: int(-1000000, 1000000), type: (v) => (v === null || (typeof v === 'string' && /^[aAiI1]$/.test(v)) ? v : undefined) },
  heading: { level: int(1, 3) },
  codeBlock: { language: (v) => (v === null || (typeof v === 'string' && /^[A-Za-z0-9+#_-]{1,30}$/.test(v)) ? v : undefined) },
  table: {},
  tableRow: {},
  tableCell: cellAttrs(),
  tableHeader: cellAttrs(),
  image: {
    src: (v) => (typeof v === 'string' && PHOTO_SRC.test(v) ? v : undefined),
    alt: (v) => (v === null || (typeof v === 'string' && v.length <= 500) ? v : undefined),
    title: (v) => (v === null || (typeof v === 'string' && v.length <= 500) ? v : undefined),
    width: int(1, 10000),
    height: int(1, 10000),
    borderWidth: int(MIN_BORDER_WIDTH, MAX_BORDER_WIDTH),
    borderColor: (v) => findPalette(v)?.name,
  },
};

function cellAttrs(): Record<string, AttrRule> {
  return {
    colspan: int(1, 1000),
    rowspan: int(1, 1000),
    colwidth: (v) => {
      if (v === null) return null;
      if (!Array.isArray(v) || v.length > 1000) return undefined;
      return v.every((w) => w === null || (typeof w === 'number' && Number.isInteger(w) && w >= 0 && w <= 10000)) ? v : undefined;
    },
  };
}

const MARK_ATTRS: Record<string, Record<string, AttrRule>> = {
  bold: {},
  italic: {},
  underline: {},
  strike: {},
  code: {},
  link: {
    href: (v) => (isSafeHref(v) ? v : undefined),
    target: (v) => (v === null || v === '_blank' ? v : undefined),
    rel: (v) => (v === null || (typeof v === 'string' && /^[a-z ]{0,100}$/.test(v)) ? v : undefined),
    class: (v) => (v === null ? null : undefined),
  },
  textStyle: {
    fontFamily: normalizeFontFamily,
    fontSize: normalizeFontSize,
    color: (v) => normalizeTextColor(v) ?? undefined,
  },
  highlight: { color: (v) => normalizeHighlightColor(v) ?? undefined },
};

/** Attributes that must be present for the node or mark to be kept at all. */
const REQUIRED: Record<string, string> = { image: 'src', link: 'href' };

const KNOWN_NODES = new Set(Object.keys(NODE_ATTRS));

// Which nodes may sit inside which (Tiptap's schema, simplified). Anything placed
// elsewhere is dropped, so a saved note always loads back into the editor.
const BLOCKS = ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'codeBlock', 'horizontalRule', 'table', 'image'];
const INLINE = ['text', 'hardBreak'];
const CHILDREN: Record<string, string[]> = {
  doc: BLOCKS,
  blockquote: BLOCKS,
  listItem: BLOCKS,
  taskItem: BLOCKS,
  tableCell: BLOCKS,
  tableHeader: BLOCKS,
  bulletList: ['listItem'],
  orderedList: ['listItem'],
  taskList: ['taskItem'],
  table: ['tableRow'],
  tableRow: ['tableCell', 'tableHeader'],
  paragraph: INLINE,
  heading: INLINE,
  codeBlock: ['text'],
};
/** Containers that must hold at least one block: an empty one gets an empty paragraph. */
const NEEDS_BLOCK = new Set(['blockquote', 'listItem', 'taskItem', 'tableCell', 'tableHeader']);
/** Containers that are meaningless when empty and are dropped. */
const DROP_IF_EMPTY = new Set(['bulletList', 'orderedList', 'taskList', 'table', 'tableRow']);

function cleanAttrs(type: string, attrs: unknown, rules: Record<string, AttrRule>): Attrs | null | undefined {
  const out: Attrs = {};
  if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
    for (const [k, rule] of Object.entries(rules)) {
      const v = (attrs as Attrs)[k];
      if (v === undefined) continue;
      const cleaned = rule(v);
      if (cleaned !== undefined && cleaned !== null) out[k] = cleaned;
    }
  }
  const req = REQUIRED[type];
  if (req && out[req] === undefined) return null; // drop the whole node/mark
  return Object.keys(out).length ? out : undefined;
}

function cleanMarks(marks: unknown): TiptapNode['marks'] | undefined {
  if (!Array.isArray(marks)) return undefined;
  const out: NonNullable<TiptapNode['marks']> = [];
  const seen = new Set<string>();
  for (const m of marks) {
    if (!m || typeof m !== 'object') continue;
    const type = (m as any).type;
    if (typeof type !== 'string' || !(type in MARK_ATTRS) || seen.has(type)) continue;
    const attrs = cleanAttrs(type, (m as any).attrs, MARK_ATTRS[type]);
    if (attrs === null) continue;
    // A textStyle or highlight with nothing valid left is dropped too.
    // (A highlight without a palette colour would fall back to a non-palette yellow.)
    if ((type === 'textStyle' || type === 'highlight') && !attrs) continue;
    seen.add(type);
    out.push(attrs ? { type, attrs } : { type });
  }
  return out.length ? out : undefined;
}

function cleanNode(node: unknown, depth: number, parent: string | null): TiptapNode | null {
  if (depth > MAX_DEPTH) throw new ContentError('Note content is nested too deeply.');
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  const type = (node as any).type;
  if (typeof type !== 'string' || !KNOWN_NODES.has(type)) return null;
  if (parent === null ? type !== 'doc' : !(CHILDREN[parent] ?? []).includes(type)) return null;

  if (type === 'text') {
    const text = (node as any).text;
    if (typeof text !== 'string' || text.length === 0) return null;
    const marks = cleanMarks((node as any).marks);
    return marks ? { type, text, marks } : { type, text };
  }

  const attrs = cleanAttrs(type, (node as any).attrs, NODE_ATTRS[type]);
  if (attrs === null) return null;
  const out: TiptapNode = { type };
  if (attrs) out.attrs = attrs;
  const content = (node as any).content;
  if (Array.isArray(content)) {
    const kids = content.map((c) => cleanNode(c, depth + 1, type)).filter((c): c is TiptapNode => c !== null);
    if (kids.length) out.content = kids;
  }
  if (!out.content) {
    if (DROP_IF_EMPTY.has(type)) return null;
    if (NEEDS_BLOCK.has(type)) out.content = [{ type: 'paragraph' }];
  }
  return out;
}

/** Validates and rebuilds a Tiptap document. Throws ContentError if it is not one. */
export function sanitizeDoc(input: unknown): TiptapDoc {
  if (!input || typeof input !== 'object' || Array.isArray(input) || (input as any).type !== 'doc') {
    throw new ContentError('Content must be a Tiptap document.');
  }
  const cleaned = cleanNode(input, 0, null) as TiptapDoc;
  return cleaned.content ? cleaned : { type: 'doc', content: [{ type: 'paragraph' }] };
}

export function emptyDoc(): TiptapDoc {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'blockquote', 'listItem', 'taskItem', 'tableCell', 'tableHeader', 'horizontalRule']);

/** Plain text of a document, with blocks separated by newlines (for search and previews). */
export function docText(doc: TiptapNode): string {
  const parts: string[] = [];
  const walk = (n: TiptapNode) => {
    if (n.type === 'text' && n.text) parts.push(n.text);
    else if (n.type === 'hardBreak') parts.push('\n');
    n.content?.forEach(walk);
    if (TEXT_BLOCKS.has(n.type)) parts.push('\n');
  };
  walk(doc);
  return parts
    .join('')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export const PREVIEW_LENGTH = 140;

export function previewOf(bodyText: string): string {
  const flat = bodyText.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LENGTH ? flat.slice(0, PREVIEW_LENGTH - 1).trimEnd() + '…' : flat;
}
