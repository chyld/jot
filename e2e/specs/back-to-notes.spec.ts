// Back to notes button in the editor header: clicking it straight after typing saves
// pending edits and lands on the notes list without a full page load, works with the
// sidebar collapsed, behaves as a real link, stays on one row on phone widths, and is
// hidden when printing.
import { expect, test } from '@playwright/test';
import { body, login, newNote, typeInBody, uniq } from './helpers';

test('Back to notes saves pending body edits immediately and lands on the notes list', async ({ page }) => {
  await login(page, 'alice');
  const title = `Back ${uniq()}`;
  const noteUrl = await newNote(page, title);
  const id = new URL(noteUrl).pathname.split('/').pop()!;
  const typed = `unsaved line ${uniq()}`;

  // Mark the document so we can confirm plain click navigates in-app without a full reload.
  await page.evaluate(() => ((window as any).__sameDoc = true));

  await typeInBody(page, typed);
  await page.locator('.note-header').getByRole('link', { name: 'Back to notes' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('notes-list')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__sameDoc)).toBe(true);

  // Reopen the note from the list and confirm the typed text is present.
  await page.getByTestId('notes-list').getByText(title).click();
  await expect(page).toHaveURL(noteUrl);
  await expect(body(page)).toContainText(typed);

  // Confirm the edit actually reached the server (not only localStorage).
  await expect.poll(async () => JSON.stringify((await (await page.request.get(`/api/notes/${id}`)).json()).note.content)).toContain(typed);
});

test('Back to notes works with the sidebar collapsed', async ({ page }) => {
  await login(page, 'alice');
  await newNote(page, `Collapsed ${uniq()}`);

  const collapseBtn = page.locator('.note-header').getByRole('button', { name: 'Collapse sidebar' });
  await collapseBtn.click();
  await expect(page.locator('nav.rail')).toHaveClass(/is-collapsed/);
  await expect(page.locator('.note-header').getByRole('button', { name: 'Expand sidebar' })).toBeVisible();

  await page.locator('.note-header').getByRole('link', { name: 'Back to notes' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('notes-list')).toBeVisible();
});

test('Back to notes is a real link, stays on one row on phone widths, and is hidden in print', async ({ page, context }) => {
  await login(page, 'alice');
  await newNote(page, `Header ${uniq()}`);

  const header = page.locator('.note-header');
  const backLink = header.getByRole('link', { name: 'Back to notes' });
  await expect(backLink).toHaveAttribute('href', '/');
  await expect(backLink).toHaveAttribute('title', 'Back to notes');

  // Ctrl+click opens the notes list in a new tab.
  const tabPromise = context.waitForEvent('page');
  await backLink.click({ modifiers: ['Control'] });
  const newTab = await tabPromise;
  await expect(newTab).toHaveURL(/\/$/);
  await newTab.close();

  // Phone viewport: the three header action buttons stay on one row in order.
  await page.setViewportSize({ width: 390, height: 844 });
  const collapseBox = (await header.getByRole('button', { name: 'Collapse sidebar' }).boundingBox())!;
  const newBox = (await header.getByRole('button', { name: 'New note' }).boundingBox())!;
  const backBox = (await backLink.boundingBox())!;
  expect(Math.abs(collapseBox.y - newBox.y)).toBeLessThan(1.5);
  expect(Math.abs(newBox.y - backBox.y)).toBeLessThan(1.5);
  expect(collapseBox.x).toBeLessThan(newBox.x);
  expect(newBox.x).toBeLessThan(backBox.x);

  // Print media: Back to notes is hidden.
  await page.emulateMedia({ media: 'print' });
  await expect(backLink).toBeHidden();
});
