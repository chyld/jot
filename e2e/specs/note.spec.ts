// Write a note with a table and a photo; reload and confirm it is saved.
import { expect, test } from '@playwright/test';
import { body, goHome, insertPhoto, login, newNote, openMenu, typeInBody, uniq, waitSaved } from './helpers';

test('a note with a table and a photo survives a reload', async ({ page }) => {
  await login(page, 'alice');
  const title = `Harbour menu ${uniq()}`;
  const url = await newNote(page, title);
  await typeInBody(page, 'Tonight at the lighthouse');

  const insert = await openMenu(page, 'Insert');
  await insert.getByRole('menuitem', { name: 'Table' }).click();
  await expect(page.getByRole('toolbar', { name: 'Table' })).toBeVisible();
  await page.keyboard.type('Dish');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Price');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Chowder');
  await page.keyboard.press('Tab');
  await page.keyboard.type('9');

  await page.keyboard.press('ControlOrMeta+End');
  await expect(page.getByRole('toolbar', { name: 'Table' })).toHaveCount(0);
  await insertPhoto(page);
  await waitSaved(page);

  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(title);
  await expect(body(page)).toContainText('Tonight at the lighthouse');
  const table = body(page).locator('table');
  await expect(table.locator('th').first()).toHaveText('Dish');
  await expect(table.locator('th').nth(1)).toHaveText('Price');
  await expect(table.locator('td').first()).toHaveText('Chowder');
  await expect(table.locator('td').nth(1)).toHaveText('9');
  const img = body(page).locator('.jot-photo img');
  await expect(img).toHaveAttribute('src', /^\/api\/photos\/[A-Za-z0-9_-]+$/);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);

  // It is listed on the home page with its preview text.
  await goHome(page);
  const card = page.getByTestId('notes-list').locator('.note-card', { hasText: title });
  await expect(card).toContainText('Tonight at the lighthouse');
});
