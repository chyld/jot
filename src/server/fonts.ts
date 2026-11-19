// Private Google Fonts. When a user adds a font, Jot downloads its woff2 files into
// that user's folder and serves them from there, so notes never contact Google and
// archived fonts keep working (the files stay on disk).
import { mkdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { syncDir, syncFile } from './durable';

export interface FontSourceConfig {
  /** Google's family metadata (the catalogue). */
  metadataUrl: string;
  /** Google's CSS2 API. */
  cssUrl: string;
  /** Origins font files may be downloaded from. */
  allowedFileOrigins: string[];
}

export const GOOGLE_FONTS: FontSourceConfig = {
  metadataUrl: 'https://fonts.google.com/metadata/fonts',
  cssUrl: 'https://fonts.googleapis.com/css2',
  allowedFileOrigins: ['https://fonts.gstatic.com'],
};

/** A modern browser user agent, so the CSS2 API answers with woff2 files. */
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export class FontError extends Error {
  constructor(
    message: string,
    public status: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export interface FontFace {
  style: 'normal' | 'italic';
  weight: string;
  unicodeRange: string | null;
  file: string;
}

const FAMILY_NAME = /^[A-Za-z0-9][A-Za-z0-9 ]{0,99}$/;

/** Google family names are letters, digits and spaces; anything else is refused. */
export function isValidFamilyName(name: unknown): name is string {
  return typeof name === 'string' && FAMILY_NAME.test(name);
}

// ---------------------------------------------------------------- catalogue

export interface CatalogEntry {
  family: string;
  category: string;
  variants: string[];
}

const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const catalogCache = new Map<string, { at: number; list: CatalogEntry[]; byFamily: Map<string, CatalogEntry> }>();

export async function getCatalog(cfg: FontSourceConfig): Promise<{ list: CatalogEntry[]; byFamily: Map<string, CatalogEntry> }> {
  const cached = catalogCache.get(cfg.metadataUrl);
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached;
  try {
    const res = await fetch(cfg.metadataUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`catalogue answered ${res.status}`);
    const text = await res.text();
    const data = JSON.parse(text.replace(/^\)\]\}'\s*/, ''));
    const list: CatalogEntry[] = [];
    for (const f of data.familyMetadataList ?? []) {
      if (!isValidFamilyName(f?.family)) continue;
      list.push({
        family: f.family,
        category: typeof f.category === 'string' ? f.category : '',
        variants: Object.keys(f.fonts ?? {}),
      });
    }
    list.sort((a, b) => a.family.localeCompare(b.family));
    const entry = { at: Date.now(), list, byFamily: new Map(list.map((e) => [e.family, e])) };
    catalogCache.set(cfg.metadataUrl, entry);
    return entry;
  } catch (err) {
    if (cached) return cached; // stale is better than nothing
    throw new FontError('Could not load the Google Fonts catalogue.', 502);
  }
}

// ---------------------------------------------------------------- which faces

function pickWeights(weights: number[]): number[] {
  if (weights.length === 0) return [];
  const regular = weights.includes(400)
    ? 400
    : [...weights].sort((a, b) => Math.abs(a - 400) - Math.abs(b - 400) || a - b)[0];
  const out = new Set([regular]);
  if (weights.includes(700)) out.add(700);
  return [...out].sort((a, b) => a - b);
}

/**
 * The CSS2 "family" parameter: regular and bold, upright and italic, as far as the
 * family has them (other weights are synthesised by the browser).
 */
export function css2FamilyParam(family: string, variants: string[]): string {
  const upright: number[] = [];
  const italic: number[] = [];
  for (const v of variants) {
    const m = /^(\d{1,4})(i?)$/.exec(v);
    if (!m) continue;
    const w = Number(m[1]);
    if (w < 100 || w > 900) continue;
    (m[2] ? italic : upright).push(w);
  }
  const up = pickWeights(upright);
  const it = pickWeights(italic);
  if (up.length === 0 && it.length === 0) return family;
  if (it.length === 0) return `${family}:wght@${up.join(';')}`;
  return `${family}:ital,wght@${[...up.map((w) => `0,${w}`), ...it.map((w) => `1,${w}`)].join(';')}`;
}

// ---------------------------------------------------------------- CSS parsing

export interface ParsedFace {
  style: 'normal' | 'italic';
  weight: string;
  url: string;
  unicodeRange: string | null;
}

/** Extracts the @font-face blocks from a CSS2 response, keeping only well-formed values. */
export function parseGoogleCss(css: string): ParsedFace[] {
  const out: ParsedFace[] = [];
  for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = block[1];
    const decl = (name: string) => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]*?)\\s*(?:;|$)`).exec(body)?.[1];
    const style = decl('font-style');
    const weight = decl('font-weight');
    const src = decl('src');
    const range = decl('unicode-range');
    if (style !== 'normal' && style !== 'italic') continue;
    if (!weight || !/^\d{1,4}( \d{1,4})?$/.test(weight)) continue;
    const url = src ? /^url\((https?:\/\/[^\s'"()]+)\)\s*format\(['"]woff2['"]\)$/.exec(src)?.[1] : undefined;
    if (!url) continue;
    if (range !== undefined && !/^[Uu]\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?(,\s*[Uu]\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?)*$/.test(range)) continue;
    out.push({ style, weight, url, unicodeRange: range ?? null });
  }
  return out;
}

// ---------------------------------------------------------------- download

const WOFF2_MAGIC = Buffer.from('wOF2');

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Downloads a family's woff2 files into destDir (created here, removed again on failure)
 * and returns the faces to record. Files are named 0.woff2, 1.woff2, ...
 */
export async function downloadFamily(cfg: FontSourceConfig, family: string, variants: string[], destDir: string): Promise<FontFace[]> {
  if (!isValidFamilyName(family)) throw new FontError('Invalid font family name.', 400);
  const url = `${cfg.cssUrl}?family=${encodeURIComponent(css2FamilyParam(family, variants))}&display=swap`;
  mkdirSync(destDir, { recursive: true });
  try {
    const res = await fetch(url, { headers: { 'user-agent': BROWSER_UA }, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new FontError(`Google Fonts refused "${family}" (${res.status}).`, 502, { cause: new Error(`${url} answered ${res.status}`) });
    const faces = parseGoogleCss(await res.text());
    if (faces.length === 0) throw new FontError(`Google Fonts returned no usable files for "${family}".`, 502);
    const result = await mapLimit(faces, 8, async (face, i) => {
      const fileUrl = new URL(face.url);
      if (!cfg.allowedFileOrigins.includes(fileUrl.origin)) throw new FontError('Font file came from an unexpected host.', 502);
      const fetchFile = async () => {
        const r = await fetch(fileUrl, { redirect: 'error', signal: AbortSignal.timeout(60000) });
        if (!r.ok) throw new Error(`${fileUrl.href} answered ${r.status} ${r.statusText}`);
        const bytes = Buffer.from(await r.arrayBuffer());
        if (!bytes.subarray(0, 4).equals(WOFF2_MAGIC)) throw new Error(`${fileUrl.href} is not a woff2 font`);
        return bytes;
      };
      let bytes: Buffer;
      try {
        bytes = await fetchFile();
      } catch {
        // One retry: Google occasionally fails a single file request.
        try {
          bytes = await fetchFile();
        } catch (err) {
          throw new FontError(`Could not download "${family}" from Google Fonts.`, 502, { cause: err });
        }
      }
      const file = `${i}.woff2`;
      await writeFile(join(destDir, file), bytes, { flag: 'wx' });
      await syncFile(join(destDir, file));
      return { style: face.style, weight: face.weight, unicodeRange: face.unicodeRange, file };
    });
    // On disk, with their names, before the caller saves the font's record.
    await syncDir(destDir);
    await syncDir(dirname(destDir));
    return result;
  } catch (err) {
    rmSync(destDir, { recursive: true, force: true });
    if (err instanceof FontError) throw err;
    throw new FontError(`Could not download "${family}" from Google Fonts.`, 502, { cause: err });
  }
}

// ---------------------------------------------------------------- serving

/** File names Jot writes for fonts; checked before any font file is read. */
export const FONT_FILE = /^\d{1,4}\.woff2$/;

/** @font-face rules for a user's fonts, pointing at Jot's own font route. */
export function fontFaceCss(fonts: Array<{ id: string; family: string; faces: FontFace[] }>): string {
  let css = '';
  for (const f of fonts) {
    if (!isValidFamilyName(f.family)) continue;
    for (const face of f.faces) {
      if (!FONT_FILE.test(face.file)) continue;
      css +=
        `@font-face {\n  font-family: "${f.family}";\n  font-style: ${face.style === 'italic' ? 'italic' : 'normal'};\n` +
        `  font-weight: ${/^\d{1,4}( \d{1,4})?$/.test(face.weight) ? face.weight : '400'};\n  font-display: swap;\n` +
        `  src: url(/api/fonts/${f.id}/files/${face.file}) format("woff2");\n` +
        (face.unicodeRange && /^[Uu+0-9A-Fa-f?,\s-]+$/.test(face.unicodeRange) ? `  unicode-range: ${face.unicodeRange};\n` : '') +
        `}\n`;
    }
  }
  return css;
}
