// Search by note text and by tag.
import { expect, test } from '@playwright/test';
import { goHome, login, newNote, typeInBody, uniq, waitSaved } from './helpers';

test('search by text and by tag', async ({ page }) => {
  await login(page, 'alice');
  const word = uniq('pelican');
  const tag = uniq('searchtag');
  await newNote(page, 'Searchable note');
  await typeInBody(page, `A ${word} sat on the pier`);
  await waitSaved(page);
  await page.getByRole('textbox', { name: 'Add tag' }).fill(tag);
  await page.getByRole('textbox', { name: 'Add tag' }).press('Enter');
  await expect(page.getByRole('list', { name: 'Tags' }).getByText(`#${tag}`)).toBeVisible();
  await newNote(page, 'Other note');
  await goHome(page);

  const search = page.getByRole('searchbox', { name: 'Search notes' });
  const list = page.getByTestId('notes-list');

  await search.fill(word);
  await expect(list.getByText('Searchable note')).toBeVisible();
  await expect(list.getByText('Other note')).toHaveCount(0);

  await search.fill(`#${tag}`);
  await expect(list.getByText('Searchable note')).toBeVisible();
  await expect(list.getByText('Other note')).toHaveCount(0);

  await search.fill(tag);
  await expect(list.getByText('Searchable note')).toBeVisible();

  await search.fill(uniq('nothing'));
  await expect(list.getByText('No notes match.')).toBeVisible();

  await search.fill('');
  await expect(list.getByText('Other note')).toBeVisible();
});
