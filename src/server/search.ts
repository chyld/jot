// Turns what the user typed into a safe SQLite FTS5 MATCH expression.
// Every word becomes a double-quoted prefix term containing only letters and
// digits, so FTS operators (OR, NEAR, column:, *, ^, quotes) in the input are inert.
// "#tag" becomes an exact match on the tags column.

export const MAX_SEARCH_TERMS = 20;

export function buildFtsQuery(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const terms: string[] = [];
  for (const raw of input.slice(0, 1000).split(/\s+/)) {
    if (!raw) continue;
    const tag = /^#([A-Za-z]+)$/.exec(raw);
    if (tag) {
      terms.push(`tags : "${tag[1].toLowerCase()}"`);
      continue;
    }
    for (const word of raw.match(/[\p{L}\p{N}]+/gu) ?? []) terms.push(`"${word.toLowerCase()}"*`);
  }
  return terms.length ? terms.slice(0, MAX_SEARCH_TERMS).join(' ') : null;
}
