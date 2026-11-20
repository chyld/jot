// The status line at the bottom of the note screen: one thin row under the writing area
// with the save status, word and character counts and the dates (in the viewer's time
// zone). It stays put while the note scrolls, never wraps, and is not printed.
import { expect, test } from '@playwright/test';
import { body, goHome, login, newNote, typeInBody, uniq, waitSaved } from './helpers';

test.use({ timezoneId: 'America/Los_Angeles' });

test('the status line counts as you type, stays at the bottom and keeps to one row', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await login(page, 'alice');
  await newNote(page, `Status ${uniq()}`);
  const bar = page.locator('footer[aria-label="Note status"]');
  await expect(bar).toBeVisible();
  const header = page.locator('.note-header');
  for (const id of ['save-status', 'note-dates', 'word-count', 'char-count']) {
    await expect(bar.getByTestId(id)).toHaveCount(1);
    await expect(header.getByTestId(id)).toHaveCount(0);
  }

  // Dates in the browser's own zone (Los Angeles here), not UTC.
  const today = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date());
  await expect(bar.getByTestId('note-dates')).toHaveText(`Created ${today} · Updated just now`);

  // The counts come first: no empty space before them, whatever the save status says.
  const left = async () => (await bar.getByTestId('word-count').boundingBox())!.x - (await bar.boundingBox())!.x;
  expect(await left()).toBeLessThanOrEqual(21);
  await typeInBody(page, 'One two three');
  await expect(bar.getByTestId('word-count')).toHaveText('3 words');
  await expect(bar.getByTestId('char-count')).toHaveText('13 characters');
  await waitSaved(page);
  expect(await left()).toBeLessThanOrEqual(21);
  const counts = (await bar.getByTestId('char-count').boundingBox())!;
  expect((await bar.getByTestId('save-status').boundingBox())!.x).toBeGreaterThan(counts.x + counts.width);

  // A long note scrolls inside the writing area; the bar stays at the bottom of the window.
  for (let i = 0; i < 40; i++) await page.keyboard.press('Enter');
  await page.keyboard.type('the end');
  await waitSaved(page);
  await page.locator('.note-scroll').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const box = (await bar.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(30);
  expect(Math.round(box.y + box.height)).toBe(700);
  const writing = (await page.locator('.note-page').boundingBox())!;
  expect(writing.y + writing.height).toBeLessThanOrEqual(box.y + 0.5);
  await expect(bar.getByTestId('word-count')).toHaveText('5 words');

  // Narrow: still one row; "Created …" goes before anything wraps, the updated time stays.
  await page.setViewportSize({ width: 520, height: 700 });
  expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(30);
  await expect(bar.locator('.note-created')).toBeHidden();
  await expect(bar.getByText(/^Updated /)).toBeVisible();
  await expect(body(page)).toContainText('the end');

  // Not printed.
  await page.emulateMedia({ media: 'print' });
  await expect(bar).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await expect(bar).toBeVisible();
});

test('read-only notes show the status line with the read-only label', async ({ page }) => {
  await login(page, 'alice');
  await goHome(page);
  // The User manual is read-only for every user.
  await page.getByRole('group', { name: 'Filter by tag' }).getByRole('button', { name: '#manual' }).click();
  await page.getByTestId('notes-list').getByRole('article', { name: 'User manual' }).getByRole('link', { name: 'User manual' }).click();
  const bar = page.locator('footer[aria-label="Note status"]');
  await expect(bar.getByTestId('read-only-indicator')).toBeVisible();
  await expect(page.locator('.note-header').getByTestId('read-only-indicator')).toHaveCount(0);
  await expect(bar.getByTestId('word-count')).toHaveText(/^\d+ words?$/);
});
