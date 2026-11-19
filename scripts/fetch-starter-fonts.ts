// Downloads the five starter fonts from Google Fonts into assets/starter-fonts, using
// the same download code as the app. Run once (inside Docker); the result ships with Jot
// so creating a user never needs the network.
//   docker compose --profile test run --rm -v "$PWD/assets:/app/assets" test node --import tsx scripts/fetch-starter-fonts.ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_STARTER_FONTS_DIR } from '../src/server/context';
import { downloadFamily, getCatalog, GOOGLE_FONTS } from '../src/server/fonts';
import { STARTER_FONTS, starterSlug, type StarterFont } from '../src/server/starter';

const out = DEFAULT_STARTER_FONTS_DIR;
mkdirSync(out, { recursive: true });
const { byFamily } = await getCatalog(GOOGLE_FONTS);
const manifest: StarterFont[] = [];
for (const family of STARTER_FONTS) {
  const entry = byFamily.get(family);
  if (!entry) throw new Error(`${family} is not in the catalogue`);
  const dir = starterSlug(family);
  rmSync(join(out, dir), { recursive: true, force: true });
  const faces = await downloadFamily(GOOGLE_FONTS, family, entry.variants, join(out, dir));
  manifest.push({ family, category: entry.category, dir, faces });
  console.log(`${family}: ${faces.length} files`);
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('wrote', join(out, 'manifest.json'));
