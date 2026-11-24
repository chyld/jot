// The browser tab is named after the open note ("<title> · Jot"), follows the title as it
// is typed, survives a reload, and is plain "Jot" again on the home page.
import { expect, test } from '@playwright/test';
import { goHome, login, newNote, uniq } from './helpers';

test('the tab shows the open note title and goes back to Jot on the home page', async ({ page }) => {
  await login(page, 'alice');
  await expect(page).toHaveTitle('Jot');

  const title = `Tab ${uniq()}`;
  await newNote(page, title);
  await expect(page).toHaveTitle(`${title} · Jot`);

  // It follows the title as it is typed.
  await page.getByRole('textbox', { name: 'Title' }).fill(`${title} two`);
  await expect(page).toHaveTitle(`${title} two · Jot`);

  // An empty title reads Untitled.
  await page.getByRole('textbox', { name: 'Title' }).fill('');
  await expect(page).toHaveTitle('Untitled · Jot');

  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 20_000 });
  await page.reload();
  await expect(page).toHaveTitle(`${title} · Jot`);

  await goHome(page);
  await expect(page).toHaveTitle('Jot');
});
