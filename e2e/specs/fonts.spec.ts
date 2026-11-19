// Add a font from the catalogue and use it in a note.
import { expect, test } from '@playwright/test';
import { body, login, newNote, openMenu, selectParagraph, typeInBody, waitSaved } from './helpers';

test('add a font from the catalogue and use it in a note', async ({ page }) => {
  await login(page, 'alice');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Fonts' }).click();
  await page.getByRole('searchbox', { name: 'Search fonts' }).fill('Roboto Slab');
  const card = page.getByRole('article', { name: 'Roboto Slab', exact: true });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Add' }).click();
  await expect(card.getByRole('button', { name: 'Archive' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('region', { name: 'Your fonts' }).getByText('Roboto Slab')).toBeVisible();

  const url = await newNote(page, 'Slab note');
  await typeInBody(page, 'Set in Roboto Slab');
  await selectParagraph(page, 'Set in Roboto Slab');
  const menu = await openMenu(page, 'Font');
  await menu.getByRole('menuitem', { name: 'Roboto Slab' }).click();
  const span = body(page).getByText('Set in Roboto Slab', { exact: true });
  await expect(span).toHaveCSS('font-family', /Roboto Slab/);
  await waitSaved(page);

  // Reload: the font comes from Jot, never from Google.
  const googleRequests: string[] = [];
  page.on('request', (r) => /fonts\.(googleapis|gstatic)\.com/.test(r.url()) && googleRequests.push(r.url()));
  await page.goto(url);
  await expect(body(page).getByText('Set in Roboto Slab', { exact: true })).toHaveCSS('font-family', /Roboto Slab/);
  const loaded = await page.evaluate(async () => {
    await document.fonts.load('16px "Roboto Slab"', 'Set in');
    return document.fonts.check('16px "Roboto Slab"', 'Set in');
  });
  expect(loaded).toBe(true);
  expect(googleRequests).toEqual([]);
  // The caret is in the Roboto Slab text, so the font picker shows it.
  await body(page).getByText('Set in Roboto Slab', { exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Font', exact: true })).toHaveText('Roboto Slab');
});
