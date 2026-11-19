// Tab in the Add tag box: with text it adds the tag exactly as Enter does and keeps the
// cursor in the box for the next one; on an empty box it moves on as usual.
import { expect, test } from '@playwright/test';
import { login, newNote, uniq, waitSaved } from './helpers';

test('three tags separated by Tab are all saved; the box stays focused and empty', async ({ page }) => {
  await login(page, 'alice');
  await newNote(page, `Tab tags ${uniq()}`);
  const input = page.getByRole('textbox', { name: 'Add tag' });
  const tags = [uniq('one'), uniq('two'), uniq('three')];
  await input.click();
  await page.keyboard.type(tags[0].toUpperCase());
  await page.keyboard.press('Tab');
  await page.keyboard.type(tags[1]);
  await page.keyboard.press('Tab');
  await page.keyboard.type(tags[2]);
  await page.keyboard.press('Tab');
  const list = page.getByRole('list', { name: 'Tags' });
  for (const t of tags) await expect(list.getByText(`#${t}`, { exact: true })).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await waitSaved(page).catch(() => {});
  await page.reload();
  for (const t of tags) await expect(page.getByRole('list', { name: 'Tags' }).getByText(`#${t}`, { exact: true })).toBeVisible();
});

test('Tab on an empty box moves focus on; an invalid tag + Tab shows the message and keeps the text', async ({ page }) => {
  await login(page, 'alice');
  await newNote(page, `Tab empty ${uniq()}`);
  const input = page.getByRole('textbox', { name: 'Add tag' });
  await input.click();
  await page.keyboard.press('Tab');
  await expect(input).not.toBeFocused();

  await input.click();
  await page.keyboard.type('to-do');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('alert')).toContainText(/letters/);
  await expect(input).toHaveValue('to-do');
  await expect(input).toBeFocused();
  await expect(page.getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveCount(0);

  // Shift+Tab is never intercepted.
  await page.keyboard.press('Shift+Tab');
  await expect(input).not.toBeFocused();
  await expect(input).toHaveValue('to-do');
});
