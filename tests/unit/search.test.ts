// Type 3 (unit): search query building. User input becomes a safe FTS5 MATCH
// expression: every term is quoted, so FTS operators and SQL text are inert.
import { describe, expect, it } from 'vitest';
import { buildFtsQuery, MAX_SEARCH_TERMS } from '../../src/server/search';

describe('buildFtsQuery', () => {
  it('returns null for empty input', () => {
    expect(buildFtsQuery('')).toBeNull();
    expect(buildFtsQuery('   ')).toBeNull();
    expect(buildFtsQuery('!!! ---')).toBeNull();
    expect(buildFtsQuery('#')).toBeNull();
    expect(buildFtsQuery(undefined as any)).toBeNull();
  });

  it('turns words into quoted prefix terms joined by AND', () => {
    expect(buildFtsQuery('hello')).toBe('"hello"*');
    expect(buildFtsQuery('Hello World')).toBe('"hello"* "world"*');
  });

  it('splits on punctuation', () => {
    expect(buildFtsQuery("lighthouse's kitchen, menu")).toBe('"lighthouse"* "s"* "kitchen"* "menu"*');
  });

  it('keeps unicode letters and digits', () => {
    expect(buildFtsQuery('café 2024')).toBe('"café"* "2024"*');
  });

  it('turns #tag into an exact match on the tags column', () => {
    expect(buildFtsQuery('#demo')).toBe('tags : "demo"');
    expect(buildFtsQuery('#Demo chowder')).toBe('tags : "demo" "chowder"*');
  });

  it('treats a # followed by non-letters as ordinary words', () => {
    expect(buildFtsQuery('#123')).toBe('"123"*');
  });

  it('neutralises FTS5 operators', () => {
    expect(buildFtsQuery('a OR b')).toBe('"a"* "or"* "b"*');
    expect(buildFtsQuery('NEAR(x y)')).toBe('"near"* "x"* "y"*');
    expect(buildFtsQuery('title:secret')).toBe('"title"* "secret"*');
    expect(buildFtsQuery('foo*')).toBe('"foo"*');
    expect(buildFtsQuery('-foo ^bar')).toBe('"foo"* "bar"*');
  });

  it('neutralises quotes and SQL', () => {
    expect(buildFtsQuery('"; DROP TABLE notes; --')).toBe('"drop"* "table"* "notes"*');
    expect(buildFtsQuery("' OR '1'='1")).toBe('"or"* "1"* "1"*');
  });

  it('never produces a double quote inside a term', () => {
    const q = buildFtsQuery('a"b c""d')!;
    expect(q).toBe('"a"* "b"* "c"* "d"*');
  });

  it('caps the number of terms', () => {
    const words = Array.from({ length: 50 }, (_, i) => `w${i}`).join(' ');
    const q = buildFtsQuery(words)!;
    expect(q.split(' ').length).toBe(MAX_SEARCH_TERMS);
  });
});
