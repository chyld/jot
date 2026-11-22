// Save as PDF: the toolbar button opens the browser's print dialog (stubbed here), and
// the print rules leave only the note's title and body, unclipped, so a long note runs
// over several pages.
import { expect, test, type Page } from '@playwright/test';
import { body, login, newNote, uniq } from './helpers';

const noteId = (page: Page) => new URL(page.url()).pathname.split('/').pop()!;
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

test('Save as PDF prints only the note, over as many pages as it needs', async ({ page }) => {
  await login(page, 'alice');
  const title = `PDF ${uniq()}`;
  await newNote(page, title);
  const long = Array.from({ length: 120 }, (_, i) => p(`Line ${i + 1} of a long note that runs over several printed pages.`));
  expect((await page.request.patch(`/api/notes/${noteId(page)}`, { data: { content: { type: 'doc', content: long } } })).status()).toBe(200);
  await page.reload();
  await expect(body(page).getByText('Line 120 of')).toBeAttached();

  // The browser's print dialog cannot be driven from a test: record the call instead.
  await page.evaluate(() => {
    (window as any).__printed = [];
    window.print = () => (window as any).__printed.push(document.title);
  });
  const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
  await toolbar.getByRole('button', { name: 'Save as PDF' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__printed)).toEqual([title]);
  expect(await page.title()).not.toBe(title); // put back after the dialog

  await page.emulateMedia({ media: 'print' });
  await expect(toolbar).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await expect(page.getByLabel('Note status')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Move to trash' })).toBeHidden();
  await expect(page.getByLabel('Title', { exact: true })).toBeVisible();
  await expect(body(page)).toBeVisible();
  // The scroll container no longer clips: it is as tall as the whole note.
  const scroll = await page.locator('.note-scroll').evaluate((el) => ({ overflow: getComputedStyle(el).overflowY, client: el.clientHeight, full: el.scrollHeight }));
  expect(scroll.overflow).toBe('visible');
  expect(scroll.client).toBeGreaterThanOrEqual(scroll.full);
  expect(scroll.full).toBeGreaterThan(900);

  // And the printed PDF has more than one page.
  const pdf = (await page.pdf({ format: 'A4' })).toString('latin1');
  expect((pdf.match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThan(1);
});
