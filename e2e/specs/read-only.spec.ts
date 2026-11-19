// Read-only notes in the browser: the lock toggle with its confirmation; afterwards the
// title, body, tags and trash cannot be changed or used, the toolbar is disabled, text can
// still be selected and copied, and the note stays in the list, the tag filter and search.
// Every account has a read-only User manual.
import { expect, test } from '@playwright/test';
import { body, goHome, login, newNote, typeInBody, uniq, waitSaved } from './helpers';

test('make a note read-only; afterwards nothing about it can change', async ({ page }) => {
  await login(page, 'carol');
  const word = uniq('ro');
  await newNote(page, `Fixed ${word}`);
  await typeInBody(page, `fixed text ${word}`);
  await waitSaved(page);
  const tag = page.getByRole('textbox', { name: 'Add tag' });
  await tag.fill(word);
  await tag.press('Enter');
  await expect(page.getByRole('list', { name: 'Tags' }).getByText(`#${word}`)).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').pop()!;

  const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
  await toolbar.getByRole('button', { name: 'Make read-only' }).click();
  const confirm = page.getByRole('group', { name: 'Make read-only' });
  await expect(confirm).toContainText('cannot be deleted');
  await expect(confirm).toContainText('command line on the server');
  await page.screenshot({ path: 'test-results/screens/read-only-confirm.png' });
  await confirm.getByRole('button', { name: 'Confirm: make read-only' }).click();

  const check = async () => {
    await expect(page.getByTestId('read-only-indicator')).toBeVisible();
    await expect(page.getByTestId('read-only-indicator')).toContainText('Read-only');
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveAttribute('readonly', '');
    await expect(body(page)).toHaveAttribute('contenteditable', 'false');
    await expect(page.getByRole('textbox', { name: 'Add tag' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Remove tag/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Move to trash' })).toHaveCount(0);
    await expect(toolbar.getByRole('button', { name: 'Bold' })).toBeDisabled();
    await expect(toolbar.getByRole('button', { name: 'Read-only' })).toBeDisabled();
  };
  await check();
  await page.screenshot({ path: 'test-results/screens/read-only-note.png' });

  // Typing changes nothing.
  await body(page).click();
  await page.keyboard.type('more words');
  await page.getByRole('textbox', { name: 'Title' }).click();
  await page.keyboard.type('more');
  await expect(body(page)).toHaveText(`fixed text ${word}`);
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(`Fixed ${word}`);

  // Text can still be selected and copied.
  await body(page).locator('p').first().click({ clickCount: 3 });
  expect(await page.evaluate(() => window.getSelection()!.toString())).toContain(`fixed text ${word}`);
  await page.evaluate(() => {
    document.addEventListener('copy', (e) => ((window as any).__copied = e.clipboardData!.getData('text/plain')), { once: true });
  });
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+C');
  expect(await page.waitForFunction(() => (window as any).__copied).then((h) => h.jsonValue())).toContain(`fixed text ${word}`);

  await page.reload();
  await check();

  // Still in the list (marked), the tag filter and search.
  await goHome(page);
  const card = page.getByTestId('notes-list').getByRole('article', { name: `Fixed ${word}` });
  await expect(card.getByLabel('Read-only')).toBeVisible();
  await page.getByRole('group', { name: 'Filter by tag' }).getByRole('button', { name: `#${word}` }).click();
  await expect(page.getByTestId('notes-list')).toContainText(`Fixed ${word}`);
  await page.getByRole('group', { name: 'Filter by tag' }).getByRole('button', { name: 'All' }).click();
  await page.getByRole('searchbox', { name: 'Search notes' }).fill(word);
  await expect(page.getByTestId('notes-list')).toContainText(`Fixed ${word}`);

  // The server refuses changes too.
  expect((await page.request.patch(`/api/notes/${id}`, { data: { title: 'x' } })).status()).toBe(403);
  expect((await page.request.delete(`/api/notes/${id}`)).status()).toBe(403);
});

test('every account has a read-only User manual, tagged manual', async ({ page }) => {
  await login(page, 'bob');
  await goHome(page);
  await page.getByRole('group', { name: 'Filter by tag' }).getByRole('button', { name: '#manual' }).click();
  const card = page.getByTestId('notes-list').getByRole('article', { name: 'User manual' });
  await expect(card).toHaveCount(1);
  await card.getByRole('link', { name: 'User manual' }).click();
  await expect(page.getByTestId('read-only-indicator')).toBeVisible();
  await expect(body(page)).toContainText('Backing up your own data');
  await expect(body(page).locator('pre code').first()).toHaveText('docker compose exec app jot backup');
  await expect(body(page)).toHaveAttribute('contenteditable', 'false');
  await page.screenshot({ path: 'test-results/screens/user-manual.png', fullPage: true });
});
