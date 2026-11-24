// Type 3 (unit): style button slot rules, colours and patch validation.
import { describe, expect, it } from 'vitest';
import {
  buttonColor,
  defaultStyleButtons,
  isButtonSlot,
  parseButtonSlot,
  STYLE_BUTTON_SLOTS,
  validateStyleButtonPatch,
} from '../../src/shared/buttons';
import { PALETTE } from '../../src/shared/palette';

describe('style button slots and colours', () => {
  it('accepts integers 1 to 10 and refuses everything else', () => {
    for (let i = 1; i <= 10; i++) {
      expect(isButtonSlot(i)).toBe(true);
      expect(parseButtonSlot(i)).toBe(i);
      expect(parseButtonSlot(String(i))).toBe(i);
    }
    for (const bad of [0, 11, -1, 1.5, NaN, Infinity, '0', '11', '01', '1 ', ' 1', '1.0', 'abc', '', null, undefined, {}]) {
      expect(isButtonSlot(bad), String(bad)).toBe(false);
      expect(parseButtonSlot(bad), String(bad)).toBeNull();
    }
  });

  it('uses the Vivid palette text colours in spec order', () => {
    expect(STYLE_BUTTON_SLOTS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const slot of STYLE_BUTTON_SLOTS) {
      expect(buttonColor(slot)).toBe(PALETTE[slot - 1].text);
    }
    expect(STYLE_BUTTON_SLOTS.map(buttonColor)).toEqual([
      '#141414',
      '#E00631',
      '#F55A00',
      '#CC9C00',
      '#5B9C11',
      '#089163',
      '#0099B8',
      '#0A47FF',
      '#8F2AF4',
      '#E90CA6',
    ]);
  });

  it('defaults to ten unbound, shown buttons in order', () => {
    expect(defaultStyleButtons()).toEqual(STYLE_BUTTON_SLOTS.map((slot) => ({ slot, styleId: null, hidden: false })));
  });
});

describe('validateStyleButtonPatch', () => {
  it('accepts styleId (string or null), hidden (boolean), or both', () => {
    expect(validateStyleButtonPatch({ styleId: 'abc123' })).toEqual({ ok: true, value: { styleId: 'abc123' } });
    expect(validateStyleButtonPatch({ styleId: null })).toEqual({ ok: true, value: { styleId: null } });
    expect(validateStyleButtonPatch({ hidden: true })).toEqual({ ok: true, value: { hidden: true } });
    expect(validateStyleButtonPatch({ hidden: false })).toEqual({ ok: true, value: { hidden: false } });
    expect(validateStyleButtonPatch({ styleId: 'abc123', hidden: true })).toEqual({ ok: true, value: { styleId: 'abc123', hidden: true } });
  });

  it('refuses non-objects, empty objects, unknown fields and wrong types', () => {
    for (const bad of [
      null,
      undefined,
      'x',
      123,
      [],
      {},
      { extra: 1 },
      { styleId: 'abc', extra: true },
      { styleId: '' },
      { styleId: 42 },
      { styleId: false },
      { styleId: undefined },
      { hidden: 'true' },
      { hidden: 1 },
      { hidden: null },
    ]) {
      const r = validateStyleButtonPatch(bad);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
  });
});
