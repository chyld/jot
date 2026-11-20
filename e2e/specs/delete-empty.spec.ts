// The home page's "Delete N empty" button: shown only when there are empty notes, asks
// once more in the page, then moves every empty note to the trash.
import { expect, test, type Page } from '@playwright/test';
import { goHome, login, newNote, uniq } from './helpers';

const ids = async (page: Page, url: string) => ((await (await page.request.get(url)).json()).notes as Array<{ id: string }>).map((n) => n.id);
const emptyBtn = (page: Page) => page.getByRole('button', { name: /^Delete \d+ empty notes?$/ });

test('delete empty notes, with a confirmation', async ({ page }) => {
  await login(page, 'bob');
  await page.request.delete('/api/empty-notes'); // start clean
  const title = uniq('kept');
  await newNote(page, title);
  const made: string[] = [];
  for (let i = 0; i < 3; i++) made.push((await (await page.request.post('/api/notes', { data: {} })).json()).note.id);
  await goHome(page);

  await expect(emptyBtn(page)).toHaveText(/Delete 3 empty/);
  await emptyBtn(page).click();
  const confirm = page.getByRole('group', { name: 'Delete empty notes' });
  await expect(confirm).toContainText('3 empty notes will move to the trash.');

  // Cancel changes nothing.
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  for (const id of made) expect(await ids(page, '/api/notes')).toContain(id);

  await emptyBtn(page).click();
  await confirm.getByRole('button', { name: 'Confirm: delete empty' }).click();
  await expect(page.getByTestId('empty-deleted')).toContainText('Moved 3 empty notes to the trash.');
  await expect(emptyBtn(page)).toBeHidden();
  await expect(page.getByTestId('notes-list')).toContainText(title);
  const live = await ids(page, '/api/notes');
  const trash = await ids(page, '/api/trash');
  for (const id of made) {
    expect(live).not.toContain(id);
    expect(trash).toContain(id);
  }
});
