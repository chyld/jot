// Style validation, shared by the server (authoritative) and the style editor.
import { MAX_FONT_SIZE, MAX_STYLE_NAME_LENGTH, MIN_FONT_SIZE } from './constants';
import { findPalette } from './palette';

export interface StyleInput {
  name: string;
  fontId: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** Palette colour name, or null for none. */
  textColor: string | null;
  /** Palette colour name, or null for none. */
  highlight: string | null;
}

/** A style as returned by the API. */
export interface Style extends StyleInput {
  id: string;
  fontFamily: string;
  fontArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type StyleResult = { ok: true; value: StyleInput } | { ok: false; error: string };

export function validateStyleInput(input: unknown): StyleResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'A style must be an object.' };
  const o = input as Record<string, unknown>;

  if (typeof o.name !== 'string' || o.name.trim().length === 0) return { ok: false, error: 'A style needs a name.' };
  const name = o.name.trim();
  if (name.length > MAX_STYLE_NAME_LENGTH) return { ok: false, error: `Style names can be at most ${MAX_STYLE_NAME_LENGTH} characters.` };

  if (typeof o.fontId !== 'string' || o.fontId.length === 0) return { ok: false, error: 'A style needs a font.' };

  if (typeof o.size !== 'number' || !Number.isInteger(o.size)) return { ok: false, error: 'A style needs a whole-number size.' };
  if (o.size < MIN_FONT_SIZE || o.size > MAX_FONT_SIZE) {
    return { ok: false, error: `Size must be between ${MIN_FONT_SIZE} and ${MAX_FONT_SIZE} px.` };
  }

  const flags: Record<'bold' | 'italic' | 'underline' | 'strike', boolean> = { bold: false, italic: false, underline: false, strike: false };
  for (const k of Object.keys(flags) as Array<keyof typeof flags>) {
    const v = o[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'boolean') return { ok: false, error: `"${k}" must be true or false.` };
    flags[k] = v;
  }

  const colour = (key: 'textColor' | 'highlight'): string | null | Error => {
    const v = o[key];
    if (v === undefined || v === null || v === '') return null;
    const p = findPalette(v);
    return p ? p.name : new Error(`${key === 'textColor' ? 'Text colour' : 'Highlight colour'} must be one of the palette colours.`);
  };
  const textColor = colour('textColor');
  if (textColor instanceof Error) return { ok: false, error: textColor.message };
  const highlight = colour('highlight');
  if (highlight instanceof Error) return { ok: false, error: highlight.message };

  return { ok: true, value: { name, fontId: o.fontId, size: o.size, ...flags, textColor, highlight } };
}
