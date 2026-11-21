// The interface colours (sections-spec.md §5). Each of the six section colours is one set
// of the same eight values, set as CSS variables; styles.css builds every chrome colour
// from these eight, so components use only the variables. Olive is also the stylesheet's
// own default, which the login page keeps.
import type { SectionColour } from '../shared/sections';

export interface ThemeValues {
  accent: string;
  accentDark: string;
  soft: string;
  appBg: string;
  border: string;
  hover: string;
  text: string;
  muted: string;
}

export const THEMES: Record<SectionColour, ThemeValues> = {
  olive: { accent: '#4d7c0f', accentDark: '#3f6212', soft: '#e4f2c4', appBg: '#f7f9f1', border: '#e0e8cd', hover: '#eef5dc', text: '#1d2610', muted: '#6b7557' },
  blue: { accent: '#1d4ed8', accentDark: '#1e3a8a', soft: '#dbe7ff', appBg: '#f3f6fd', border: '#d3def5', hover: '#e8effc', text: '#111a33', muted: '#5a6685' },
  violet: { accent: '#7c3aed', accentDark: '#5b21b6', soft: '#eadfff', appBg: '#f8f5fe', border: '#e2d8f7', hover: '#f0e9fd', text: '#1f1433', muted: '#6c6085' },
  amber: { accent: '#b45309', accentDark: '#8a3f06', soft: '#fde8c8', appBg: '#fdf8f0', border: '#f0e0c6', hover: '#faefdc', text: '#2b1c0a', muted: '#7a6a55' },
  teal: { accent: '#0f766e', accentDark: '#115e59', soft: '#ccf2ec', appBg: '#f2f9f8', border: '#cfe6e2', hover: '#e3f3f0', text: '#0d2422', muted: '#55706c' },
  slate: { accent: '#475569', accentDark: '#334155', soft: '#e2e8f0', appBg: '#f6f7f9', border: '#dde2ea', hover: '#eceff4', text: '#151a22', muted: '#5b6472' },
};

/** Display names, in the order the colour picker shows them. */
export const COLOUR_NAMES: Record<SectionColour, string> = { olive: 'Olive', blue: 'Blue', violet: 'Violet', amber: 'Amber', teal: 'Teal', slate: 'Slate' };

/** The eight CSS variables for a colour; usable as an element's inline style, so a part of the page can take another section's colours. */
export function themeVars(colour: SectionColour): Record<string, string> {
  const t = THEMES[colour] ?? THEMES.olive;
  return {
    '--accent': t.accent,
    '--accent-dark': t.accentDark,
    '--accent-soft': t.soft,
    '--app-bg': t.appBg,
    '--border': t.border,
    '--hover': t.hover,
    '--text': t.text,
    '--muted': t.muted,
  };
}

/** Colours the whole interface. */
export function applyTheme(colour: SectionColour) {
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(themeVars(colour))) root.setProperty(k, v);
}

/** Back to the stylesheet's Olive (logging out). */
export function clearTheme() {
  const root = document.documentElement.style;
  for (const k of Object.keys(themeVars('olive'))) root.removeProperty(k);
}
