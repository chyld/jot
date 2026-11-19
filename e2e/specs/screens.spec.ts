// Every screen renders for a logged-in user (screenshots saved for review).
import { expect, test } from '@playwright/test';
import { body, login, newNote, openMenu, typeInBody, waitSaved } from './helpers';

test('every screen renders', async ({ page }) => {
  await login(page, 'alice');
  await newNote(page, 'Screens tour');
  await typeInBody(page, 'A short tour of the screens.');
  await waitSaved(page);
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/notes.png' });

  await openMenu(page, 'Styles');
  await page.screenshot({ path: 'test-results/screens/styles-menu.png' });
  await page.keyboard.press('Escape');
  await openMenu(page, 'Font');
  await page.screenshot({ path: 'test-results/screens/font-menu.png' });
  await page.keyboard.press('Escape');
  await expect(body(page)).toContainText('A short tour');

  for (const [label, heading] of [
    ['Fonts', 'Fonts'],
    ['Styles', 'Styles'],
    ['Backup', 'Backup'],
    ['Trash', 'Trash'],
  ]) {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label }).click();
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    if (label === 'Fonts') await expect(page.getByTestId('catalog-card').first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `test-results/screens/${label.toLowerCase()}.png` });
  }
  // There is no separate Tags page any more.
  await page.goto('/tags');
  await expect(page.getByRole('heading', { name: 'Not found', level: 1 })).toBeVisible();
});
