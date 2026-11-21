// Previous / Next in the note editor: in a section of three notes, Next walks the home
// page list top to bottom and wraps to the top; Previous walks it the other way and wraps
// to the bottom.
import { expect, test, type Page } from '@playwright/test';
import { goHome, login, newNote, uniq } from './helpers';

const titleOf = (page: Page) => page.getByRole('textbox', { name: 'Title' });

test('Previous and Next walk the section in home page order and wrap', async ({ page }) => {
  await login(page, 'bob');
  // A section of its own, so it holds exactly these three notes.
  const id = uniq('nav');
  const name = `Nav ${id}`;
  expect((await page.request.post('/api/sections', { data: { id, name, colour: 'teal' } })).status()).toBe(201);
  await page.goto('/sections');
  await page.getByRole('listitem', { name }).getByRole('button', { name: `Open ${name}` }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

  for (const t of ['First made', 'Second made', 'Third made']) await newNote(page, `${t} ${id}`);

  // The home page order: most recently updated first.
  await goHome(page);
  const list = page.getByTestId('notes-list');
  const expected = [`Third made ${id}`, `Second made ${id}`, `First made ${id}`];
  await expect(list.locator('a.note-card-title')).toHaveCount(3);
  for (const [i, t] of expected.entries()) await expect(list.locator('a.note-card-title').nth(i)).toContainText(t);

  // Open the top note; Next goes down the list and wraps back to the top.
  await list.getByText(expected[0]).click();
  await expect(titleOf(page)).toHaveValue(expected[0]);
  const next = page.getByRole('button', { name: 'Next note' });
  const previous = page.getByRole('button', { name: 'Previous note' });
  for (const t of [expected[1], expected[2], expected[0]]) {
    await next.click();
    await expect(titleOf(page)).toHaveValue(t);
  }

  // Previous from the top wraps to the bottom, then goes up the list.
  for (const t of [expected[2], expected[1], expected[0]]) {
    await previous.click();
    await expect(titleOf(page)).toHaveValue(t);
  }
});
