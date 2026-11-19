// Type 3 (unit): Google Fonts request building and response parsing, plus relative time.
import { describe, expect, it } from 'vitest';
import { css2FamilyParam, parseGoogleCss, isValidFamilyName } from '../../src/server/fonts';
import { relativeTime } from '../../src/shared/time';

describe('css2FamilyParam (which faces to download)', () => {
  it('asks for regular and bold, upright and italic, when available', () => {
    expect(css2FamilyParam('Merriweather', ['300', '400', '400i', '700', '700i', '900'])).toBe(
      'Merriweather:ital,wght@0,400;0,700;1,400;1,700',
    );
  });

  it('asks only for weights the family has', () => {
    expect(css2FamilyParam('Roboto Slab', ['400', '700'])).toBe('Roboto Slab:wght@400;700');
    expect(css2FamilyParam('Bebas Neue', ['400'])).toBe('Bebas Neue:wght@400');
  });

  it('falls back to the weight closest to 400 when 400 is missing', () => {
    expect(css2FamilyParam('Thin Only', ['100', '300'])).toBe('Thin Only:wght@300');
    expect(css2FamilyParam('Heavy', ['800', '900'])).toBe('Heavy:wght@800');
  });

  it('handles italic-only families', () => {
    expect(css2FamilyParam('Slanty', ['400i'])).toBe('Slanty:ital,wght@1,400');
  });
});

describe('parseGoogleCss', () => {
  const css = `/* latin-ext */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v20/a.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+1E00-1E9F;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: italic;
  font-weight: 700;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v20/b.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}`;

  it('extracts each face', () => {
    expect(parseGoogleCss(css)).toEqual([
      { style: 'normal', weight: '400', url: 'https://fonts.gstatic.com/s/inter/v20/a.woff2', unicodeRange: 'U+0100-02BA, U+1E00-1E9F' },
      { style: 'italic', weight: '700', url: 'https://fonts.gstatic.com/s/inter/v20/b.woff2', unicodeRange: 'U+0000-00FF, U+0131' },
    ]);
  });

  it('drops faces with suspicious values', () => {
    const evil = css
      .replace("font-style: normal", 'font-style: normal}body{color:red')
      .replace('U+0000-00FF, U+0131', 'U+0000-00FF, expression(alert(1))');
    expect(parseGoogleCss(evil)).toEqual([]);
  });
});

describe('isValidFamilyName', () => {
  it('accepts Google-style names', () => {
    expect(isValidFamilyName('Playfair Display')).toBe(true);
    expect(isValidFamilyName('M PLUS 1p')).toBe(true);
  });
  it('rejects anything that could escape CSS or a path', () => {
    for (const bad of ['', '../etc', 'a"b', "a'b", 'a;b', 'a}b', 'a/b', 'x'.repeat(101), ' Leading']) {
      expect(isValidFamilyName(bad)).toBe(false);
    }
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-11-18T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it('formats recent times', () => {
    expect(relativeTime(ago(5_000), now)).toBe('just now');
    expect(relativeTime(ago(60_000), now)).toBe('1 min ago');
    expect(relativeTime(ago(3 * 60_000), now)).toBe('3 min ago');
    expect(relativeTime(ago(60 * 60_000), now)).toBe('1 hour ago');
    expect(relativeTime(ago(5 * 60 * 60_000), now)).toBe('5 hours ago');
    expect(relativeTime(ago(24 * 60 * 60_000), now)).toBe('1 day ago');
    expect(relativeTime(ago(3 * 24 * 60 * 60_000), now)).toBe('3 days ago');
  });
  it('uses a date for old times', () => {
    expect(relativeTime('2026-01-02T12:00:00Z', now)).toBe('Jan 2, 2026');
  });
  it('treats future times as just now', () => {
    expect(relativeTime(ago(-10_000), now)).toBe('just now');
  });
});
