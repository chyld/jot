// A new note opens with the caret in the note body: after '+' (left bar) or '+ New'
// (home page) the owner can type at once, without clicking. Opening an existing note
// does not move the focus into the body.
import { expect, test, type Page } from '@playwright/test';
import { body, goHome, login, uniq, waitSaved } from './helpers';

async function typeWithoutClicking(page: Page, open: () => Promise<void>) {
  const before = page.url();
  await open();
  await expect(page).toHaveURL(/\/n\/[A-Za-z0-9_-]+$/);
  await expect(page).not.toHaveURL(before);
  const id = new URL(page.url()).pathname.split('/').pop()!;
  const note = page.locator(`article[data-note-id="${id}"]`);
  await expect(note.locator('.note-body')).toBeVisible();
  // No click: the keyboard goes wherever the focus already is.
  const words = `typed straight away ${uniq()}`;
  await page.keyboard.type(words);
  await expect(note.locator('.note-body')).toContainText(words);
  await expect(note.getByRole('textbox', { name: 'Title' })).toHaveValue('');
  await expect(note.getByRole('textbox', { name: 'Add tag' })).toHaveValue('');
  await waitSaved(page);
  await page.reload();
  await expect(body(page)).toContainText(words);
  // Typed with the default Body formatting: plain text in a plain paragraph.
  const saved = (await (await page.request.get(`/api/notes/${id}`)).json()).note.content;
  expect(saved).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }] });
  return id;
}

test('a note made with the + button in the left bar opens ready to type', async ({ page }) => {
  await login(page, 'alice');
  await typeWithoutClicking(page, () => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'New note' }).click());
});

test('a note made with + New on the home page opens ready to type', async ({ page }) => {
  await login(page, 'alice');
  await goHome(page);
  await typeWithoutClicking(page, () => page.getByRole('button', { name: 'New', exact: true }).click());
});

test('opening an existing note does not put the caret in the body', async ({ page }) => {
  await login(page, 'alice');
  const id = await typeWithoutClicking(page, () => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'New note' }).click());
  await goHome(page);
  await page.goto(`/n/${id}`);
  await expect(body(page)).toBeVisible();
  await expect(page.locator('.note-body')).not.toBeFocused();
  await page.reload();
  await expect(body(page)).toBeVisible();
  await expect(page.locator('.note-body')).not.toBeFocused();
});
