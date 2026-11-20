// Unsaved edits (backup-spec.md §5, third fix): an edit survives a failed save and a
// reload, is retried automatically, and is never shown to another user.
import { expect, test } from '@playwright/test';
import { body, login, logout, newNote, typeInBody, uniq, waitSaved } from './helpers';

test('an edit survives a failed save and a reload, then saves by itself', async ({ page }) => {
  await login(page, 'carol');
  const word = uniq('draft');
  await newNote(page, `Unsaved ${word}`);
  const url = page.url();

  // The server cannot be reached for saves.
  await page.route('**/api/notes/*', (route) => (route.request().method() === 'PATCH' ? route.abort('connectionfailed') : route.continue()));
  await typeInBody(page, `typed while offline ${word}`);
  await expect(page.getByTestId('save-status')).toHaveText('Not saved', { timeout: 20_000 });
  await expect(page.getByTestId('save-error')).toContainText(/kept in this browser/i);

  await page.reload();
  await expect(body(page)).toContainText(`typed while offline ${word}`);
  await expect(page.getByTestId('save-status')).toHaveText('Not saved', { timeout: 20_000 });

  // The server comes back: the retry saves it without the user doing anything.
  await page.unroute('**/api/notes/*');
  await waitSaved(page);
  await page.goto(url);
  await expect(body(page)).toContainText(`typed while offline ${word}`);
  const kept = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('jot.unsaved.')));
  expect(kept).toEqual([]);
});

test('one user’s unsaved text is never shown to another', async ({ page }) => {
  await login(page, 'carol');
  const word = uniq('secret');
  await newNote(page, `Private ${word}`);
  await page.route('**/api/notes/*', (route) => (route.request().method() === 'PATCH' ? route.abort('connectionfailed') : route.continue()));
  await typeInBody(page, `carol only ${word}`);
  await expect(page.getByTestId('save-status')).toHaveText('Not saved', { timeout: 20_000 });
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('jot.unsaved.')))).toBe(true);

  // Logging out clears it from this browser (even though the last save attempt also fails).
  await logout(page);
  await expect(page.getByLabel('Username')).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('jot.unsaved.')))).toEqual([]);

  await page.unroute('**/api/notes/*');
  await login(page, 'bob');
  await expect(page.getByTestId('notes-list')).not.toContainText(word);
  const html = await page.content();
  expect(html).not.toContain(`carol only ${word}`);
});
