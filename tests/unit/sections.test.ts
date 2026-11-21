// Type 3 (unit): the shared section rules (sections-spec.md §1): the ID follows the tag
// rules, the name is 1 to 60 characters, and the colour is one of six.
import { describe, expect, it } from 'vitest';
import { isSectionColour, normalizeSectionId, normalizeSectionName, SECTION_COLOURS } from '../../src/shared/sections';
import { THEMES } from '../../src/client/theme';

describe('section IDs', () => {
  it('are letters a–z, 1 to 30, with uppercase lowercased', () => {
    expect(normalizeSectionId('recipe')).toEqual({ ok: true, id: 'recipe' });
    expect(normalizeSectionId(' Work ')).toEqual({ ok: true, id: 'work' });
    expect(normalizeSectionId('a'.repeat(30))).toEqual({ ok: true, id: 'a'.repeat(30) });
  });
  it.each([[''], ['a'.repeat(31)], ['two words'], ['demo1'], ['with-dash'], ['café'], ['#tag'], [42], [null]])('refuses %j', (v) => {
    const r = normalizeSectionId(v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ID/);
  });
});

describe('section names', () => {
  it('are trimmed, 1 to 60 characters', () => {
    expect(normalizeSectionName("  Bob's Recipes ")).toEqual({ ok: true, name: "Bob's Recipes" });
    expect(normalizeSectionName('n'.repeat(60)).ok).toBe(true);
    for (const v of ['', '   ', 'n'.repeat(61), 3, undefined]) expect(normalizeSectionName(v).ok).toBe(false);
  });
});

describe('colours', () => {
  it('are the six, with no rose or pink', () => {
    expect(SECTION_COLOURS).toEqual(['olive', 'blue', 'violet', 'amber', 'teal', 'slate']);
    expect(isSectionColour('teal')).toBe(true);
    for (const v of ['pink', 'rose', 'Olive', '', null]) expect(isSectionColour(v)).toBe(false);
  });
  it('each have the same eight values, and Olive is today’s theme', () => {
    for (const c of SECTION_COLOURS) {
      expect(Object.keys(THEMES[c]).sort()).toEqual(['accent', 'accentDark', 'appBg', 'border', 'hover', 'muted', 'soft', 'text']);
      for (const v of Object.values(THEMES[c])) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(THEMES.olive).toEqual({ accent: '#4d7c0f', accentDark: '#3f6212', soft: '#e4f2c4', appBg: '#f7f9f1', border: '#e0e8cd', hover: '#eef5dc', text: '#1d2610', muted: '#6b7557' });
  });
});
