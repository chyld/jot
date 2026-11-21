// Trash a note, restore it, then delete it permanently.
import { expect, test } from '@playwright/test';
import { goHome, login, newNote, openTrash, uniq } from './helpers';

test('trash, restore, delete permanently', async ({ page }) => {
  await login(page, 'alice');
  const title = `Trash me ${uniq()}`;
  const url = await newNote(page, title);
  const list = page.getByTestId('notes-list');

  await page.getByRole('button', { name: 'Move to trash' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(list.getByText(title)).toHaveCount(0);

  await openTrash(page);
  const item = page.getByRole('listitem', { name: title });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: 'Restore' }).click();
  await expect(item).toHaveCount(0);
  await goHome(page);
  await expect(list.getByText(title)).toBeVisible();

  await page.goto(url);
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await openTrash(page);
  await page.getByRole('listitem', { name: title }).getByRole('button', { name: 'Delete permanently' }).click();
  await page.getByRole('listitem', { name: title }).getByRole('button', { name: /Confirm/ }).click();
  await expect(page.getByRole('listitem', { name: title })).toHaveCount(0);

  await page.goto(url);
  await expect(page.getByText('This note does not exist.')).toBeVisible();
});
