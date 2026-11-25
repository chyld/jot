// Whiteboard scene storage, validation and plain-text extraction.
// Whiteboards are stored in notes.content as { type: 'board', version: 1, elements, appState, files }
// wrapping an Excalidraw scene snapshot.
import type { BoardDoc } from '../shared/types';
import { ContentError, isSafeHref } from './content';

export const MAX_BOARD_BYTES = 8 * 1024 * 1024;
export const MAX_BOARD_DEPTH = 20;
export const MAX_BOARD_ELEMENTS = 10_000;
export const MAX_BODY_TEXT = 200_000;
export const MAX_MCP_CHARS = 50_000;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const STRIP_ELEMENT_KEYS = new Set(['customData']);

/** Element types persisted in v1. Embeds, iframes and inline images are excluded. */
const ALLOWED_ELEMENT_TYPES = new Set([
  'rectangle',
  'diamond',
  'ellipse',
  'arrow',
  'line',
  'freedraw',
  'text',
  'frame',
  'magicframe',
]);

/** Durable scene-level appState keys; transient UI state (selection, zoom, collaborators) is dropped. */
const ALLOWED_APP_STATE_KEYS = new Set([
  'viewBackgroundColor',
  'gridSize',
  'gridStep',
  'gridModeEnabled',
]);

const SAFE_COLOR = /^(?:#[0-9a-fA-F]{3,8}|transparent|(?:rgb|hsl)a?\([\d.,%\s/]+\)|[a-zA-Z]{1,32})$/;

export function emptyBoard(): BoardDoc {
  return {
    type: 'board',
    version: 1,
    elements: [],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

interface Budget {
  bytes: number;
}

function charge(budget: Budget, n: number) {
  budget.bytes += n;
  if (budget.bytes > MAX_BOARD_BYTES) {
    throw new ContentError('Whiteboard is larger than the 8 MB limit.');
  }
}

function cleanValue(val: unknown, depth: number, budget: Budget): unknown {
  if (depth > MAX_BOARD_DEPTH) throw new ContentError('Whiteboard data is nested too deeply.');
  if (val === null || typeof val === 'boolean') {
    charge(budget, 5);
    return val;
  }
  if (typeof val === 'string') {
    charge(budget, Buffer.byteLength(val, 'utf8') + 2);
    return val;
  }
  if (typeof val === 'number') {
    charge(budget, 8);
    return Number.isFinite(val) ? val : null;
  }
  if (Array.isArray(val)) {
    charge(budget, 2);
    const out: unknown[] = [];
    for (const item of val) {
      out.push(cleanValue(item, depth + 1, budget));
    }
    return out;
  }
  if (typeof val === 'object') {
    charge(budget, 2);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k) || v === undefined) continue;
      charge(budget, Buffer.byteLength(k, 'utf8') + 3);
      out[k] = cleanValue(v, depth + 1, budget);
    }
    return out;
  }
  return undefined;
}

function sanitizeAppState(raw: unknown, budget: Budget): Record<string, unknown> {
  if (raw === undefined) return { viewBackgroundColor: '#ffffff' };
  if (!isPlainObject(raw)) {
    throw new ContentError('Whiteboard appState must be an object.');
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_APP_STATE_KEYS.has(k) || v === undefined) continue;
    if (k === 'viewBackgroundColor') {
      if (typeof v === 'string' && v.length <= 64 && SAFE_COLOR.test(v.trim())) {
        const cleaned = v.trim();
        charge(budget, cleaned.length + 24);
        out[k] = cleaned;
      }
    } else if (k === 'gridSize' || k === 'gridStep') {
      if (v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 1000)) {
        charge(budget, 16);
        out[k] = v;
      }
    } else if (k === 'gridModeEnabled') {
      if (typeof v === 'boolean') {
        charge(budget, 16);
        out[k] = v;
      }
    }
  }
  if (out.viewBackgroundColor === undefined) {
    out.viewBackgroundColor = '#ffffff';
  }
  return out;
}

function sanitizeElement(raw: unknown, budget: Budget): Record<string, unknown> | null {
  if (!isPlainObject(raw)) {
    throw new ContentError('Each whiteboard element must be an object.');
  }
  if (raw.isDeleted === true) return null;
  if (typeof raw.type !== 'string') {
    throw new ContentError('Each whiteboard element must have a type.');
  }
  if (!ALLOWED_ELEMENT_TYPES.has(raw.type)) return null;
  if (typeof raw.id !== 'string' || !raw.id || raw.id.length > 200) {
    throw new ContentError('Each whiteboard element must have a valid id.');
  }
  if (typeof raw.x !== 'number' || !Number.isFinite(raw.x) || typeof raw.y !== 'number' || !Number.isFinite(raw.y)) {
    throw new ContentError('Each whiteboard element must have finite coordinates.');
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (FORBIDDEN_KEYS.has(k) || STRIP_ELEMENT_KEYS.has(k) || v === undefined) continue;
    if (k === 'link') {
      if (v === null) {
        out.link = null;
      } else if (typeof v === 'string' && isSafeHref(v.trim())) {
        charge(budget, Buffer.byteLength(v, 'utf8') + 8);
        out.link = v.trim();
      } else {
        out.link = null;
      }
      continue;
    }
    charge(budget, Buffer.byteLength(k, 'utf8') + 3);
    out[k] = cleanValue(v, 2, budget);
  }
  return out;
}

/** Validates and rebuilds a BoardDoc snapshot. Throws ContentError if invalid or oversized. */
export function sanitizeBoard(input: unknown): BoardDoc {
  if (!isPlainObject(input)) {
    throw new ContentError('Content must be a whiteboard.');
  }
  if (input.type !== 'board' || input.version !== 1) {
    throw new ContentError('Content must be a whiteboard.');
  }
  if (!Array.isArray(input.elements)) {
    throw new ContentError('Whiteboard elements must be an array.');
  }
  if (input.elements.length > MAX_BOARD_ELEMENTS) {
    throw new ContentError(`Whiteboard can have at most ${MAX_BOARD_ELEMENTS} elements.`);
  }
  if (input.files !== undefined && !isPlainObject(input.files)) {
    throw new ContentError('Whiteboard files must be an object.');
  }

  const budget: Budget = { bytes: 0 };
  const elements: Array<Record<string, unknown>> = [];
  for (const raw of input.elements) {
    const cleaned = sanitizeElement(raw, budget);
    if (cleaned) elements.push(cleaned);
  }
  const appState = sanitizeAppState(input.appState, budget);
  // v1 disables inline image files; always store an empty map.
  const files: Record<string, unknown> = {};

  const doc: BoardDoc = { type: 'board', version: 1, elements, appState, files };
  const finalBytes = Buffer.byteLength(JSON.stringify(doc), 'utf8');
  if (finalBytes > MAX_BOARD_BYTES) {
    throw new ContentError('Whiteboard is larger than the 8 MB limit.');
  }
  return doc;
}

function cleanDisplayText(raw: string): string {
  return raw.replace(/[\x00-\x08\x0B-\x1F\x7F]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function liveElements(doc: BoardDoc): Array<Record<string, unknown>> {
  if (!Array.isArray(doc.elements)) return [];
  return doc.elements.filter((el): el is Record<string, unknown> => isPlainObject(el) && el.isDeleted !== true);
}

function sortReadingOrder(elements: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return [...elements].sort((a, b) => {
    const ay = typeof a.y === 'number' && Number.isFinite(a.y) ? a.y : 0;
    const by = typeof b.y === 'number' && Number.isFinite(b.y) ? b.y : 0;
    const rowDiff = Math.floor(ay / 24) - Math.floor(by / 24);
    if (rowDiff !== 0) return rowDiff;
    const ax = typeof a.x === 'number' && Number.isFinite(a.x) ? a.x : 0;
    const bx = typeof b.x === 'number' && Number.isFinite(b.x) ? b.x : 0;
    return ax - bx;
  });
}

function elementText(el: Record<string, unknown>): string {
  if (el.type === 'text') {
    const raw = typeof el.originalText === 'string' && el.originalText.trim() ? el.originalText : typeof el.text === 'string' ? el.text : '';
    return cleanDisplayText(raw);
  }
  if ((el.type === 'frame' || el.type === 'magicframe') && typeof el.name === 'string') {
    return cleanDisplayText(el.name);
  }
  return '';
}

/** Flattened plain text of text labels and frame names (for FTS search and home previews). */
export function boardText(doc: BoardDoc): string {
  const lines: string[] = [];
  let total = 0;
  for (const el of sortReadingOrder(liveElements(doc))) {
    const text = elementText(el);
    if (!text) continue;
    lines.push(text);
    total += text.length + 1;
    if (total >= MAX_BODY_TEXT) return lines.join('\n').slice(0, MAX_BODY_TEXT);
  }
  return lines.join('\n');
}

/** True when the whiteboard has no non-deleted elements. */
export function isEmptyBoard(doc: BoardDoc): boolean {
  return liveElements(doc).length === 0;
}

/** Compact text outline of a whiteboard for MCP read_note. */
export function boardToMarkdown(doc: BoardDoc): string {
  const elements = sortReadingOrder(liveElements(doc));
  if (elements.length === 0) return '(empty)';

  const byId = new Map<string, Record<string, unknown>>();
  const labelByContainer = new Map<string, string>();
  const counts = { shapes: 0, arrows: 0, lines: 0, freedraw: 0, text: 0, frames: 0 };

  for (const el of elements) {
    if (typeof el.id === 'string') byId.set(el.id, el);
    const type = el.type;
    if (type === 'rectangle' || type === 'diamond' || type === 'ellipse') counts.shapes++;
    else if (type === 'arrow') counts.arrows++;
    else if (type === 'line') counts.lines++;
    else if (type === 'freedraw') counts.freedraw++;
    else if (type === 'text') {
      counts.text++;
      const text = elementText(el);
      if (text && typeof el.containerId === 'string') {
        const prev = labelByContainer.get(el.containerId);
        labelByContainer.set(el.containerId, prev ? `${prev} ${text}` : text);
      }
    } else if (type === 'frame' || type === 'magicframe') counts.frames++;
  }

  const parts: string[] = [];
  if (counts.frames) parts.push(`${counts.frames} ${counts.frames === 1 ? 'frame' : 'frames'}`);
  if (counts.shapes) parts.push(`${counts.shapes} ${counts.shapes === 1 ? 'shape' : 'shapes'}`);
  if (counts.arrows) parts.push(`${counts.arrows} ${counts.arrows === 1 ? 'arrow' : 'arrows'}`);
  if (counts.lines) parts.push(`${counts.lines} ${counts.lines === 1 ? 'line' : 'lines'}`);
  if (counts.freedraw) parts.push(`${counts.freedraw} ${counts.freedraw === 1 ? 'drawing' : 'drawings'}`);
  if (counts.text) parts.push(`${counts.text} ${counts.text === 1 ? 'text item' : 'text items'}`);

  const lines: string[] = [`Whiteboard: ${parts.join(', ') || `${elements.length} elements`}`];
  let total = lines[0].length;
  let truncated = false;
  const push = (line: string) => {
    if (total + line.length + 1 > MAX_MCP_CHARS) {
      truncated = true;
      return false;
    }
    lines.push(line);
    total += line.length + 1;
    return true;
  };

  const shapeLabel = (id: unknown): string | null => {
    if (typeof id !== 'string') return null;
    const direct = labelByContainer.get(id);
    if (direct) return direct;
    const target = byId.get(id);
    if (!target) return null;
    const own = elementText(target);
    if (own) return own;
    return typeof target.type === 'string' ? `[${target.type}]` : null;
  };

  const itemLines: string[] = [];
  const connLines: string[] = [];

  for (const el of elements) {
    const id = typeof el.id === 'string' ? el.id : '';
    if (el.type === 'frame' || el.type === 'magicframe') {
      const name = elementText(el);
      if (name) itemLines.push(`- Frame: ${name}`);
    } else if (el.type === 'rectangle' || el.type === 'diamond' || el.type === 'ellipse') {
      const label = labelByContainer.get(id);
      if (label) itemLines.push(`- [${el.type}] ${label}`);
    } else if (el.type === 'text' && typeof el.containerId !== 'string') {
      const text = elementText(el);
      if (text) itemLines.push(`- ${text}`);
    } else if (el.type === 'arrow') {
      const start = isPlainObject(el.startBinding) ? shapeLabel(el.startBinding.elementId) : null;
      const end = isPlainObject(el.endBinding) ? shapeLabel(el.endBinding.elementId) : null;
      const arrowLabel = labelByContainer.get(id);
      if (start || end) {
        const lhs = start ?? '(start)';
        const rhs = end ?? '(end)';
        connLines.push(arrowLabel ? `- ${lhs} --(${arrowLabel})--> ${rhs}` : `- ${lhs} --> ${rhs}`);
      } else if (arrowLabel) {
        itemLines.push(`- [arrow] ${arrowLabel}`);
      }
    }
  }

  if (itemLines.length > 0 && push('') && push('## Items')) {
    for (const line of itemLines) {
      if (!push(line)) break;
    }
  }
  if (!truncated && connLines.length > 0 && push('') && push('## Connections')) {
    for (const line of connLines) {
      if (!push(line)) break;
    }
  }

  const out = lines.join('\n');
  return truncated ? `${out}\n\n… (truncated at ${MAX_MCP_CHARS} characters)` : out;
}
