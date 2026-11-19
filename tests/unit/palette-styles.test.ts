// Type 3 (unit): the fixed "Vivid" palette and style validation.
import { describe, expect, it } from 'vitest';
import {
  PALETTE,
  findPalette,
  normalizeTextColor,
  normalizeHighlightColor,
  borderColorHex,
} from '../../src/shared/palette';
import { validateStyleInput } from '../../src/shared/styles';
import { MIN_FONT_SIZE, MAX_FONT_SIZE } from '../../src/shared/constants';

describe('palette', () => {
  it('has the ten Vivid colours exactly as specified', () => {
    expect(PALETTE.map((p) => [p.name, p.text, p.highlight, p.border])).toEqual([
      ['Jet', '#141414', '#C7C7C7', '#292929'],
      ['Crimson', '#E00631', '#FF8FA5', '#F9103F'],
      ['Tangerine', '#F55A00', '#FFB88F', '#FF640A'],
      ['Sunflower', '#CC9C00', '#FFE58F', '#FFC60A'],
      ['Lime', '#5B9C11', '#CBFF8F', '#8BE723'],
      ['Jade', '#089163', '#8FFFDA', '#16F3A9'],
      ['Cyan', '#0099B8', '#8FECFF', '#0AD6FF'],
      ['Electric', '#0A47FF', '#8FABFF', '#0A47FF'],
      ['Violet', '#8F2AF4', '#C78FFF', '#8516F3'],
      ['Magenta', '#E90CA6', '#FF8FDD', '#F316B1'],
    ]);
  });

  it('finds a colour by name, case-insensitively', () => {
    expect(findPalette('Violet')?.text).toBe('#8F2AF4');
    expect(findPalette('violet')?.name).toBe('Violet');
    expect(findPalette('Red')).toBeUndefined();
    expect(findPalette('')).toBeUndefined();
  });

  it('accepts only palette text colours, returning the canonical hex', () => {
    expect(normalizeTextColor('#E00631')).toBe('#E00631');
    expect(normalizeTextColor('#e00631')).toBe('#E00631');
    expect(normalizeTextColor('rgb(224, 6, 49)')).toBe('#E00631');
    expect(normalizeTextColor('#FF8FA5')).toBeNull(); // a highlight colour, not a text colour
    expect(normalizeTextColor('#123456')).toBeNull();
    expect(normalizeTextColor('red')).toBeNull();
    expect(normalizeTextColor('#E00631; background: url(x)')).toBeNull();
    expect(normalizeTextColor(null as any)).toBeNull();
  });

  it('accepts only palette highlight colours', () => {
    expect(normalizeHighlightColor('#FFE58F')).toBe('#FFE58F');
    expect(normalizeHighlightColor('#ffe58f')).toBe('#FFE58F');
    expect(normalizeHighlightColor('#CC9C00')).toBeNull();
    expect(normalizeHighlightColor('yellow')).toBeNull();
  });

  it('maps border colour names to the border column', () => {
    expect(borderColorHex('Lime')).toBe('#8BE723');
    expect(borderColorHex('Nope')).toBeNull();
  });
});

describe('validateStyleInput', () => {
  const base = { name: 'Body', fontId: 'f1', size: 16 };

  it('accepts a minimal style and fills optional parts', () => {
    expect(validateStyleInput(base)).toEqual({
      ok: true,
      value: {
        name: 'Body',
        fontId: 'f1',
        size: 16,
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        textColor: null,
        highlight: null,
      },
    });
  });

  it('accepts every optional part and canonicalises colour names', () => {
    const r = validateStyleInput({
      ...base,
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      textColor: 'violet',
      highlight: 'Sunflower',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.textColor).toBe('Violet');
      expect(r.value.highlight).toBe('Sunflower');
      expect(r.value.bold && r.value.italic && r.value.underline && r.value.strike).toBe(true);
    }
  });

  it('trims the name', () => {
    const r = validateStyleInput({ ...base, name: '  Quote  ' });
    expect(r.ok && r.value.name).toBe('Quote');
  });

  it.each([
    ['missing name', { fontId: 'f1', size: 16 }],
    ['blank name', { ...base, name: '   ' }],
    ['name too long', { ...base, name: 'x'.repeat(61) }],
    ['missing font', { name: 'A', size: 16 }],
    ['empty font', { ...base, fontId: '' }],
    ['missing size', { name: 'A', fontId: 'f1' }],
    ['size too small', { ...base, size: MIN_FONT_SIZE - 1 }],
    ['size too large', { ...base, size: MAX_FONT_SIZE + 1 }],
    ['fractional size', { ...base, size: 16.5 }],
    ['size as string', { ...base, size: '16' }],
    ['free text colour', { ...base, textColor: '#123456' }],
    ['unknown colour name', { ...base, textColor: 'Red' }],
    ['free highlight', { ...base, highlight: 'yellow' }],
    ['non-boolean bold', { ...base, bold: 'yes' }],
    ['not an object', 'Body'],
    ['null', null],
  ])('rejects %s', (_label, input) => {
    const r = validateStyleInput(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it('accepts the size limits themselves', () => {
    expect(validateStyleInput({ ...base, size: MIN_FONT_SIZE }).ok).toBe(true);
    expect(validateStyleInput({ ...base, size: MAX_FONT_SIZE }).ok).toBe(true);
  });

  it('treats null colours as "none"', () => {
    const r = validateStyleInput({ ...base, textColor: null, highlight: null });
    expect(r.ok && r.value.textColor === null && r.value.highlight === null).toBe(true);
  });
});
