// The trash button on a note card (with Undo), and the Tags page: counts, and deleting
// a tag after a confirmation, which keeps the notes.
import { expect, test } from '@playwright/test';
import { goHome, login, newNote, uniq } from './helpers';

async function addTag(page: import('@playwright/test').Page, tag: string) {
  const input = page.getByRole('textbox', { name: 'Add tag' });
  await input.fill(tag);
  await input.press('Enter');
  await expect(page.getByRole('list', { name: 'Tags' }).getByText(`#${tag}`, { exact: true })).toBeVisible();
}

test('a note card’s trash button moves the note to the trash, and Undo brings it back', async ({ page }) => {
  await login(page, 'alice');
  const title = `Card trash ${uniq()}`;
  await newNote(page, title);
  await goHome(page);
  const list = page.getByTestId('notes-list');
  const card = list.getByRole('article', { name: title });
  await expect(card).toBeVisible();

  await card.getByRole('button', { name: `Move ${title} to the trash` }).click();
  await expect(page).toHaveURL(/\/$/); // the click did not open the note
  await expect(card).toHaveCount(0);
  const undo = page.getByTestId('trash-undo');
  await expect(undo).toContainText(title);

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Trash' }).click();
  await page.getByRole('listitem', { name: title }).getByRole('button', { name: 'Restore' }).click();
  await goHome(page);
  await expect(page.getByTestId('trash-undo')).toHaveCount(0);

  // Trash it again and undo.
  await list.getByRole('article', { name: title }).getByRole('button', { name: /to the trash/ }).click();
  await expect(list.getByRole('article', { name: title })).toHaveCount(0);
  await page.getByTestId('trash-undo').getByRole('button', { name: 'Undo' }).click();
  await expect(list.getByRole('article', { name: title })).toBeVisible();
  await expect(page.getByTestId('trash-undo')).toHaveCount(0);

  // The read-only User manual has no trash button.
  const manual = list.getByRole('article', { name: 'User manual' });
  await expect(manual).toBeVisible();
  await expect(manual.getByRole('button')).toHaveCount(0);
});

test('the Tags page counts notes per tag and deletes a tag after a confirmation', async ({ page }) => {
  await login(page, 'bob');
  const tag = uniq('pagetag');
  const first = `Tagged one ${uniq()}`;
  const second = `Tagged two ${uniq()}`;
  await newNote(page, first);
  await addTag(page, tag);
  await newNote(page, second);
  await addTag(page, tag);

  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Tags' }).click();
  await expect(page).toHaveURL(/\/tags$/);
  await expect(page.getByRole('heading', { name: 'Tags', level: 1 })).toBeVisible();
  const item = page.getByRole('listitem', { name: `#${tag}` });
  await expect(item.getByTestId('tag-count')).toHaveText('2 notes');

  // The manual's tag cannot be deleted: its note is read-only.
  const manual = page.getByRole('listitem', { name: '#manual' });
  await manual.getByRole('button', { name: 'Delete tag manual' }).click();
  await manual.getByRole('button', { name: 'Confirm: delete tag' }).click();
  await expect(manual.getByRole('alert')).toContainText(/read-only/);
  await manual.getByRole('button', { name: 'Cancel' }).click();

  // Cancel keeps the tag; Confirm deletes it.
  await item.getByRole('button', { name: `Delete tag ${tag}` }).click();
  await expect(item.getByRole('group', { name: `Delete tag ${tag}` })).toContainText('The notes are kept');
  await item.getByRole('button', { name: 'Cancel' }).click();
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: `Delete tag ${tag}` }).click();
  await item.getByRole('button', { name: 'Confirm: delete tag' }).click();
  await expect(item).toHaveCount(0);
  await expect(manual).toBeVisible();

  // Both notes are still there, without the tag, and the home page filter lost its chip.
  await goHome(page);
  const list = page.getByTestId('notes-list');
  await expect(list.getByRole('article', { name: first })).toBeVisible();
  await expect(list.getByRole('article', { name: second })).toBeVisible();
  await expect(list.getByText(`#${tag}`)).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Filter by tag' }).getByRole('button', { name: `#${tag}` })).toHaveCount(0);
});
