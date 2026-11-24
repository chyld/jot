// Inline code chip: violet chip in note content, code blocks unchanged, explicit text
// colour and highlight still win, prints the same chip, and code outside notes is untouched.
import { expect, test, type Page } from '@playwright/test';
import { body, login, newNote, uniq } from './helpers';

const noteId = (page: Page) => new URL(page.url()).pathname.split('/').pop()!;

const chipStyles = (el: Element) => {
  const s = getComputedStyle(el);
  return {
    bg: s.backgroundColor,
    color: s.color,
    borderWidth: s.borderTopWidth,
    borderStyle: s.borderTopStyle,
    borderColor: s.borderTopColor,
    radius: s.borderRadius,
    paddingTop: s.paddingTop,
    paddingLeft: s.paddingLeft,
    fontFamily: s.fontFamily,
  };
};

test('inline code renders as a violet chip while code blocks, user colours, highlights, printing and chrome code behave as specified', async ({ page }) => {
  await login(page, 'alice');
  await newNote(page, `Inline code ${uniq()}`);
  const content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Run ' },
          { type: 'text', text: 'npm test', marks: [{ type: 'code' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'crimson-code', marks: [{ type: 'code' }, { type: 'textStyle', attrs: { color: '#E00631' } }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'font-only-code', marks: [{ type: 'code' }, { type: 'textStyle', attrs: { fontFamily: '"Lora"' } }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'highlighted-code', marks: [{ type: 'code' }, { type: 'highlight', attrs: { color: '#FFE58F' } }] },
        ],
      },
      { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1;' }] },
    ],
  };
  expect((await page.request.patch(`/api/notes/${noteId(page)}`, { data: { content } })).status()).toBe(200);
  await page.reload();
  await expect(body(page).locator('p code', { hasText: 'npm test' })).toBeVisible();

  // Plain inline code: violet chip.
  const plain = await body(page).locator('p code', { hasText: 'npm test' }).evaluate(chipStyles);
  expect(plain.bg).toBe('rgb(243, 233, 255)');
  expect(plain.color).toBe('rgb(122, 31, 214)');
  expect(plain.borderWidth).toBe('1px');
  expect(plain.borderStyle).toBe('solid');
  expect(plain.borderColor).toBe('rgb(220, 194, 251)');
  expect(plain.radius).toBe('5px');
  expect(plain.fontFamily).toMatch(/Fira Code/);

  // Explicit text colour wins over the default violet.
  const crimson = await body(page).locator('p code', { hasText: 'crimson-code' }).evaluate(chipStyles);
  expect(crimson.color).toBe('rgb(224, 6, 49)');
  expect(crimson.bg).toBe('rgb(243, 233, 255)');
  expect(crimson.borderColor).toBe('rgb(220, 194, 251)');

  // A textStyle without colour (font family only) keeps the default violet.
  const fontOnly = await body(page).locator('p code', { hasText: 'font-only-code' }).evaluate(chipStyles);
  expect(fontOnly.color).toBe('rgb(122, 31, 214)');

  // Highlight (<mark> inside <code>) wins over the chip background and inherits violet text.
  const mark = await body(page)
    .locator('p code', { hasText: 'highlighted-code' })
    .locator('mark')
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color };
    });
  expect(mark.bg).toBe('rgb(255, 229, 143)');
  expect(mark.color).toBe('rgb(122, 31, 214)');

  // Code block's <code> keeps its original look: no border, no radius, no chip background or padding.
  const blockCode = await body(page).locator('pre code').evaluate(chipStyles);
  expect(blockCode.bg).toBe('rgba(0, 0, 0, 0)');
  expect(blockCode.color).toBe('rgb(238, 241, 245)');
  expect(blockCode.borderStyle).toBe('none');
  expect(blockCode.borderWidth).toBe('0px');
  expect(blockCode.radius).toBe('0px');
  expect(blockCode.paddingTop).toBe('0px');
  expect(blockCode.paddingLeft).toBe('0px');

  // Printing (Save as PDF) shows the same violet chip.
  await page.emulateMedia({ media: 'print' });
  const printed = await body(page).locator('p code', { hasText: 'npm test' }).evaluate(chipStyles);
  expect(printed.bg).toBe('rgb(243, 233, 255)');
  expect(printed.color).toBe('rgb(122, 31, 214)');
  expect(printed.borderWidth).toBe('1px');
  expect(printed.borderStyle).toBe('solid');
  expect(printed.borderColor).toBe('rgb(220, 194, 251)');
  expect(printed.radius).toBe('5px');
  await page.emulateMedia({ media: 'screen' });

  // <code> outside note content (Account page bot address) is untouched.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Account' }).click();
  const botCodeEl = page.locator('.bot-address code');
  await expect(botCodeEl).toBeVisible();
  const botCode = await botCodeEl.evaluate(chipStyles);
  expect(botCode.bg).toBe('rgba(0, 0, 0, 0)');
  expect(botCode.borderStyle).toBe('none');
  expect(botCode.color).not.toBe('rgb(122, 31, 214)');
});
