// The fixed "Vivid" palette: 10 text colours, 10 highlight colours and 10 photo
// border colours. There is no free colour picker anywhere in Jot.

export interface PaletteColor {
  name: string;
  text: string;
  highlight: string;
  border: string;
}

export const PALETTE: readonly PaletteColor[] = [
  { name: 'Jet', text: '#141414', highlight: '#C7C7C7', border: '#292929' },
  { name: 'Crimson', text: '#E00631', highlight: '#FF8FA5', border: '#F9103F' },
  { name: 'Tangerine', text: '#F55A00', highlight: '#FFB88F', border: '#FF640A' },
  { name: 'Sunflower', text: '#CC9C00', highlight: '#FFE58F', border: '#FFC60A' },
  { name: 'Lime', text: '#5B9C11', highlight: '#CBFF8F', border: '#8BE723' },
  { name: 'Jade', text: '#089163', highlight: '#8FFFDA', border: '#16F3A9' },
  { name: 'Cyan', text: '#0099B8', highlight: '#8FECFF', border: '#0AD6FF' },
  { name: 'Electric', text: '#0A47FF', highlight: '#8FABFF', border: '#0A47FF' },
  { name: 'Violet', text: '#8F2AF4', highlight: '#C78FFF', border: '#8516F3' },
  { name: 'Magenta', text: '#E90CA6', highlight: '#FF8FDD', border: '#F316B1' },
];

/** Finds a palette entry by name, case-insensitively. */
export function findPalette(name: unknown): PaletteColor | undefined {
  if (typeof name !== 'string' || !name) return undefined;
  const n = name.toLowerCase();
  return PALETTE.find((p) => p.name.toLowerCase() === n);
}

/** Converts "#abc", "#aabbcc" or "rgb(r, g, b)" to "#AABBCC"; null for anything else. */
export function toHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return '#' + m[1].toUpperCase();
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (m) return ('#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
  m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(v);
  if (m) {
    const parts = [m[1], m[2], m[3]].map(Number);
    if (parts.some((p) => p > 255)) return null;
    return '#' + parts.map((p) => p.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return null;
}

/** Returns the canonical palette text colour for a value, or null if it is not one. */
export function normalizeTextColor(value: unknown): string | null {
  const hex = toHex(value);
  return hex ? (PALETTE.find((p) => p.text === hex)?.text ?? null) : null;
}

/** Returns the canonical palette highlight colour for a value, or null if it is not one. */
export function normalizeHighlightColor(value: unknown): string | null {
  const hex = toHex(value);
  return hex ? (PALETTE.find((p) => p.highlight === hex)?.highlight ?? null) : null;
}

/** Photo border colour for a palette name, or null. */
export function borderColorHex(name: unknown): string | null {
  return findPalette(name)?.border ?? null;
}

/** Palette name for a text colour hex, or null. */
export function textColorName(value: unknown): string | null {
  const hex = normalizeTextColor(value);
  return hex ? PALETTE.find((p) => p.text === hex)!.name : null;
}

/** Palette name for a highlight colour hex, or null. */
export function highlightColorName(value: unknown): string | null {
  const hex = normalizeHighlightColor(value);
  return hex ? PALETTE.find((p) => p.highlight === hex)!.name : null;
}
