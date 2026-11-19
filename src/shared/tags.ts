// Tag rules: letters a-z only, 1 to 30 characters. Uppercase input is lowercased.
// Anything else (digits, hyphens, spaces, accents, too long) is rejected with a message.

export const MAX_TAG_LENGTH = 30;

export type TagResult = { ok: true; tag: string } | { ok: false; error: string };

export function normalizeTag(input: unknown): TagResult {
  if (typeof input !== 'string') return { ok: false, error: 'Tag must be text.' };
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, error: 'Tag cannot be empty.' };
  // Only ASCII A-Z are lowercased, so accented or other letters stay invalid.
  const lower = trimmed.replace(/[A-Z]/g, (c) => c.toLowerCase());
  if (!/^[a-z]+$/.test(lower)) {
    return { ok: false, error: 'Tags can only contain the letters a–z (no digits, hyphens, spaces or accents).' };
  }
  if (lower.length > MAX_TAG_LENGTH) {
    return { ok: false, error: `Tags can be at most ${MAX_TAG_LENGTH} letters long.` };
  }
  return { ok: true, tag: lower };
}
