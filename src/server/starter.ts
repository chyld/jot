// The starter pack: 5 fonts and 5 styles every new user receives as their own copy.
// The font files ship with Jot (assets/starter-fonts), so creating a user never needs
// the network. They are ordinary fonts and styles once copied.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FontFace } from './fonts';

export const STARTER_FONTS = ['Inter', 'Lora', 'Playfair Display', 'Caveat', 'Fira Code'] as const;

export const STARTER_STYLES = [
  { name: 'Body', font: 'Inter', size: 16, bold: false, italic: false, textColor: 'Jet' },
  { name: 'Title', font: 'Playfair Display', size: 40, bold: true, italic: false, textColor: 'Jet' },
  { name: 'Quote', font: 'Lora', size: 20, bold: false, italic: true, textColor: 'Violet' },
  { name: 'Aside', font: 'Caveat', size: 24, bold: false, italic: false, textColor: 'Electric' },
  { name: 'Code', font: 'Fira Code', size: 14, bold: false, italic: false, textColor: 'Jade' },
] as const;

export interface StarterFont {
  family: string;
  category: string;
  /** Folder under the starter fonts directory holding the face files. */
  dir: string;
  faces: FontFace[];
}

export function starterSlug(family: string): string {
  return family.toLowerCase().replace(/ /g, '-');
}

export function loadStarterManifest(starterFontsDir: string): StarterFont[] {
  const file = join(starterFontsDir, 'manifest.json');
  let manifest: StarterFont[];
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`Starter fonts are missing (${file}). Run scripts/fetch-starter-fonts.ts.`);
  }
  for (const fam of STARTER_FONTS) {
    if (!manifest.some((m) => m.family === fam)) throw new Error(`Starter font "${fam}" is missing from ${file}.`);
  }
  return manifest;
}
