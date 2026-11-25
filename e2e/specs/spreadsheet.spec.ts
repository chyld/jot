// Spreadsheets MVP (Univer Sheets Core): create, early edit save (before Steady),
// uncommitted cell edit flushed on navigation, font picker, autosave + reload persistence,
// Undo persistence, home card tile & preview, read-only lock blocking grid edits, and lazy chunk split.
import { expect, test } from '@playwright/test';
import { goHome, login, newNote, uniq, waitSaved } from './helpers';

test('create a spreadsheet, verify Univer mounts cleanly under strict CSP, persist edits, and lock read-only', async ({ page }) => {
  const cspOrPageErrors: string[] = [];
  const sheetChunkRequests: string[] = [];
  page.on('pageerror', (err) => cspOrPageErrors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /content security policy|eval|unsafe/i.test(msg.text())) {
      cspOrPageErrors.push(`console: ${msg.text()}`);
    }
  });
  page.on('request', (req) => {
    if (/SheetEditor-.*\.js/.test(req.url())) sheetChunkRequests.push(req.url());
  });

  await login(page, 'alice');

  // Opening a regular document must never download the lazy SheetEditor chunk.
  await newNote(page, `PlainDoc ${uniq()}`);
  expect(sheetChunkRequests).toEqual([]);
  await goHome(page);

  await page.getByRole('button', { name: 'New spreadsheet' }).first().click();
  await expect(page).toHaveURL(/\/n\/[A-Za-z0-9_-]+$/);

  const article = page.locator('article[data-note-kind="sheet"]');
  await expect(article).toBeVisible();
  const host = page.getByTestId('sheet-editor');
  await expect(host).toBeVisible();
  // Univer mounts its canvas grid and marks ready at Rendered (well before the 3.3s Steady timer).
  await expect(host).toHaveAttribute('data-sheet-ready', 'true', { timeout: 15000 });
  await expect(host.locator('canvas').first()).toBeVisible();
  expect(sheetChunkRequests.length).toBeGreaterThan(0);

  // Immediately edit a cell right after mount (tests H1: early edit must NOT be lost before Steady).
  const id = new URL(page.url()).pathname.split('/').pop()!;
  const initialBox = (await host.boundingBox())!;
  await page.mouse.click(initialBox.x + initialBox.width * 0.4, initialBox.y + initialBox.height * 0.45);
  await page.mouse.dblclick(initialBox.x + initialBox.width * 0.4, initialBox.y + initialBox.height * 0.45);
  await page.keyboard.type('EarlyEdit');
  await page.keyboard.press('Enter');
  await waitSaved(page);
  const afterEarly = (await (await page.request.get(`/api/notes/${id}`)).json()).note;
  expect(JSON.stringify(afterEarly.content)).toContain('EarlyEdit');

  // Font picker should default to Inter and list Jot's fonts (not Univer's built-in Chinese/macOS fonts).
  await expect(host.getByRole('textbox', { name: 'Font', exact: true })).toHaveValue('Inter');
  await host.getByRole('button', { name: 'Font', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Inter', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lora', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '宋体' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  const sheetTitle = `Budget ${uniq()}`;
  const titleInput = article.getByRole('textbox', { name: 'Title' });
  await titleInput.fill(sheetTitle);
  await waitSaved(page);

  // Persist cell data & formula via API-backed reload and verify Univer renders & keeps it.
  const current = (await (await page.request.get(`/api/notes/${id}`)).json()).note.content;
  current.workbook.sheets['sheet-1'].cellData = {
    '0': { '0': { v: 'Apples' }, '1': { v: 10 } },
    '1': { '0': { v: 'Oranges' }, '1': { v: 25 } },
    '2': { '0': { v: 'Total' }, '1': { v: 35, f: '=SUM(B1:B2)' } },
  };
  expect((await page.request.patch(`/api/notes/${id}`, { data: { content: current } })).status()).toBe(200);
  await page.reload();
  await expect(host).toHaveAttribute('data-sheet-ready', 'true', { timeout: 15000 });
  await expect(titleInput).toHaveValue(sheetTitle);

  // Double-click into the main grid area, type a value WITHOUT pressing Enter, and click Back to notes.
  // Verifies M2: active cell edit is committed and flushed before navigating away.
  const box = (await host.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.keyboard.type('EditedOnLeave');
  await article.getByRole('link', { name: 'Back to notes' }).click();
  await expect(page).toHaveURL(/\/$/);

  await expect
    .poll(async () => JSON.stringify((await (await page.request.get(`/api/notes/${id}`)).json()).note.content))
    .toContain('EditedOnLeave');

  // Verify it appears on the home list with a Spreadsheet tile and cell preview.
  const card = page.locator(`article[data-note-id="${id}"]`);
  await expect(card).toBeVisible();
  await expect(card.getByLabel('Spreadsheet')).toBeVisible();
  await expect(card).toContainText('Apples 10');

  // Reopen, lock read-only, and verify grid edits are blocked and server content stays unchanged.
  await card.getByRole('link', { name: sheetTitle }).click();
  await expect(host).toHaveAttribute('data-sheet-ready', 'true', { timeout: 15000 });
  await page.getByRole('button', { name: 'Make read-only' }).click();
  await page.getByRole('group', { name: 'Confirm read-only' }).getByRole('button', { name: 'Make read-only' }).click();
  await expect(page.getByTestId('read-only-indicator')).toBeVisible();
  await expect(titleInput).toHaveAttribute('readonly', '');

  const beforeLock = JSON.stringify((await (await page.request.get(`/api/notes/${id}`)).json()).note.content);
  const lockedBox = (await host.boundingBox())!;
  await page.mouse.dblclick(lockedBox.x + lockedBox.width * 0.6, lockedBox.y + lockedBox.height * 0.5);
  await page.keyboard.type('ShouldNotSave');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const afterLock = JSON.stringify((await (await page.request.get(`/api/notes/${id}`)).json()).note.content);
  expect(afterLock).toBe(beforeLock);
  expect(afterLock).not.toContain('ShouldNotSave');

  expect(cspOrPageErrors).toEqual([]);
});
