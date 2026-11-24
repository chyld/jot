// Style buttons: ten fixed numbered toolbar shortcuts (1–10) per user, each
// bound to one of the user's styles (or none) and individually hideable.
import { PALETTE } from './palette';

export const STYLE_BUTTON_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type ButtonSlot = (typeof STYLE_BUTTON_SLOTS)[number];

export interface StyleButton {
  slot: ButtonSlot;
  styleId: string | null;
  hidden: boolean;
}

export interface StyleButtonPatch {
  styleId?: string | null;
  hidden?: boolean;
}

export type StyleButtonPatchResult = { ok: true; value: StyleButtonPatch } | { ok: false; error: string };

const SLOT_STRING = /^(?:[1-9]|10)$/;
const PATCH_KEYS = new Set(['styleId', 'hidden']);

export function isButtonSlot(v: unknown): v is ButtonSlot {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10;
}

/** Parses a slot number or strict route parameter ("1".."10"); null for anything else. */
export function parseButtonSlot(v: unknown): ButtonSlot | null {
  if (isButtonSlot(v)) return v;
  if (typeof v === 'string' && SLOT_STRING.test(v)) return Number(v) as ButtonSlot;
  return null;
}

/** Chip colour for slot N: the Nth Vivid palette text colour in spec order. */
export function buttonColor(slot: ButtonSlot): string {
  return PALETTE[slot - 1].text;
}

/** Default state for all ten buttons: unbound and shown. */
export function defaultStyleButtons(): StyleButton[] {
  return STYLE_BUTTON_SLOTS.map((slot) => ({ slot, styleId: null, hidden: false }));
}

export function validateStyleButtonPatch(input: unknown): StyleButtonPatchResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Expected a JSON object.' };
  }
  const o = input as Record<string, unknown>;
  const keys = Object.keys(o);
  for (const k of keys) {
    if (!PATCH_KEYS.has(k)) return { ok: false, error: `Unknown field "${k}".` };
  }
  const hasStyle = Object.prototype.hasOwnProperty.call(o, 'styleId');
  const hasHidden = Object.prototype.hasOwnProperty.call(o, 'hidden');
  if (!hasStyle && !hasHidden) {
    return { ok: false, error: 'Specify "styleId" or "hidden".' };
  }
  const value: StyleButtonPatch = {};
  if (hasStyle) {
    if (o.styleId !== null && (typeof o.styleId !== 'string' || o.styleId.length === 0)) {
      return { ok: false, error: '"styleId" must be a style ID or null.' };
    }
    value.styleId = o.styleId;
  }
  if (hasHidden) {
    if (typeof o.hidden !== 'boolean') {
      return { ok: false, error: '"hidden" must be true or false.' };
    }
    value.hidden = o.hidden;
  }
  return { ok: true, value };
}
