// Type 3 (unit): tag rules. Letters a-z only, 1-30 characters; uppercase is lowercased;
// digits, hyphens, spaces, accents and >30 characters are rejected with a message.
import { describe, expect, it } from 'vitest';
import { normalizeTag, MAX_TAG_LENGTH } from '../../src/shared/tags';

describe('normalizeTag', () => {
  it('accepts lowercase letters', () => {
    expect(normalizeTag('demo')).toEqual({ ok: true, tag: 'demo' });
    expect(normalizeTag('a')).toEqual({ ok: true, tag: 'a' });
  });

  it('converts uppercase to lowercase', () => {
    expect(normalizeTag('Demo')).toEqual({ ok: true, tag: 'demo' });
    expect(normalizeTag('FONTS')).toEqual({ ok: true, tag: 'fonts' });
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeTag('  demo  ')).toEqual({ ok: true, tag: 'demo' });
  });

  it('accepts exactly 30 letters and rejects 31', () => {
    expect(MAX_TAG_LENGTH).toBe(30);
    expect(normalizeTag('a'.repeat(30))).toEqual({ ok: true, tag: 'a'.repeat(30) });
    const r = normalizeTag('a'.repeat(31));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/30/);
  });

  it.each([
    ['digits', 'demo1'],
    ['only digits', '2024'],
    ['hyphen', 'to-do'],
    ['inner space', 'to do'],
    ['accent', 'café'],
    ['uppercase accent', 'CAFÉ'],
    ['underscore', 'to_do'],
    ['hash', '#demo'],
    ['emoji', 'demo🙂'],
    ['dotless i', 'İstanbul'],
    ['non-latin letters', 'привет'],
  ])('rejects %s (%s) with a message', (_label, input) => {
    const r = normalizeTag(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(typeof r.error).toBe('string');
      expect(r.error.length).toBeGreaterThan(0);
    }
  });

  it('rejects empty and whitespace-only input', () => {
    expect(normalizeTag('').ok).toBe(false);
    expect(normalizeTag('   ').ok).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(normalizeTag(undefined as any).ok).toBe(false);
    expect(normalizeTag(42 as any).ok).toBe(false);
  });

  it('gives a letters-only message for bad characters', () => {
    const r = normalizeTag('to-do');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/a.z/);
  });
});
