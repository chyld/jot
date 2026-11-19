// Add valid tags; uppercase is lowercased and invalid tags are rejected.
import { expect, test } from '@playwright/test';
import { login, newNote, uniq } from './helpers';

test('tags: valid, lowercased, and invalid ones rejected', async ({ page }) => {
  await login(page, 'alice');
  const url = await newNote(page, 'Tag test');
  const input = page.getByRole('textbox', { name: 'Add tag' });
  const tags = page.getByRole('list', { name: 'Tags' });

  const tag = uniq('kitchen');
  await input.fill(tag.toUpperCase());
  await input.press('Enter');
  await expect(tags.getByText(`#${tag}`, { exact: true })).toBeVisible();
  await expect(input).toHaveValue('');

  for (const bad of ['to-do', 'demo1', 'two words', 'café', 'a'.repeat(31)]) {
    await input.fill(bad);
    await input.press('Enter');
    await expect(page.getByRole('alert')).toContainText(/letters|30/);
    await expect(tags.getByRole('listitem')).toHaveCount(1);
  }

  await input.fill('harbour');
  await input.press('Enter');
  await expect(tags.getByRole('listitem')).toHaveCount(2);

  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(page.getByRole('list', { name: 'Tags' }).getByText(`#${tag}`, { exact: true })).toBeVisible();

  // Browsing by tag: clicking a tag's name on the note opens the home page filtered by it.
  await page.getByRole('list', { name: 'Tags' }).getByRole('button', { name: `#${tag}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/\\?tag=${tag}$`));
  const filter = page.getByRole('group', { name: 'Filter by tag' });
  await expect(filter.getByRole('button', { name: `#${tag}` })).toHaveAttribute('aria-pressed', 'true');
  const list = page.getByTestId('notes-list');
  await expect(list.locator('.note-card')).toHaveCount(1);
  await expect(list.getByText('Tag test')).toBeVisible();

  // The same from a tag name on a note card.
  await filter.getByRole('button', { name: 'All' }).click();
  await expect(page).toHaveURL(/\/$/);
  await list.locator('.note-card', { hasText: 'Tag test' }).getByRole('link', { name: '#harbour' }).click();
  await expect(page).toHaveURL(/\/\?tag=harbour$/);
  await expect(filter.getByRole('button', { name: '#harbour' })).toHaveAttribute('aria-pressed', 'true');
  await expect(list.getByText('Tag test')).toBeVisible();
});
