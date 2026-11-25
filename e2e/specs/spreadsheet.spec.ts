// Spreadsheets MVP (Univer Sheets Core): create, edit title and cells/formulas under
// Jot's strict CSP, autosave + reload persistence, home card & search, and read-only lock.
import { expect, test } from '@playwright/test';
import { goHome, login, uniq, waitSaved } from './helpers';

test('create a spreadsheet, verify Univer mounts cleanly under strict CSP, persist edits, and lock read-only', async ({ page }) => {
  const cspOrPageErrors: string[] = [];
  page.on('pageerror', (err) => cspOrPageErrors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /content security policy|eval|unsafe/i.test(msg.text())) {
      cspOrPageErrors.push(`console: ${msg.text()}`);
    }
  });

  await login(page, 'alice');
  await page.getByRole('button', { name: 'New spreadsheet' }).first().click();
  await expect(page).toHaveURL(/\/n\/[A-Za-z0-9_-]+$/);

  const article = page.locator('article[data-note-kind="sheet"]');
  await expect(article).toBeVisible();
  const host = page.getByTestId('sheet-editor');
  await expect(host).toBeVisible();
  // Univer mounts its canvas grid and reaches LifecycleStages.Steady inside the host container.
  await expect(host).toHaveAttribute('data-sheet-ready', 'true', { timeout: 15000 });
  await expect(host.locator('canvas').first()).toBeVisible();

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
  const id = new URL(page.url()).pathname.split('/').pop()!;
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

  // Double-click into the main grid area and type a value to confirm interactive editing & autosave.
  const box = (await host.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.keyboard.type('EditedCell');
  await page.keyboard.press('Enter');
  await waitSaved(page);
  const afterEdit = (await (await page.request.get(`/api/notes/${id}`)).json()).note;
  expect(JSON.stringify(afterEdit.content)).toContain('EditedCell');

  // Verify it appears on the home list with a Spreadsheet icon and cell preview, and is searchable.
  await goHome(page);
  const card = page.locator(`article[data-note-id="${id}"]`);
  await expect(card).toBeVisible();
  await expect(card.getByLabel('Spreadsheet')).toBeVisible();
  await expect(card).toContainText('Apples 10');

  // Reopen and test read-only lock.
  await card.getByRole('link', { name: sheetTitle }).click();
  await expect(host).toHaveAttribute('data-sheet-ready', 'true', { timeout: 15000 });
  await page.getByRole('button', { name: 'Make read-only' }).click();
  await page.getByRole('group', { name: 'Confirm read-only' }).getByRole('button', { name: 'Make read-only' }).click();
  await expect(page.getByTestId('read-only-indicator')).toBeVisible();
  await expect(titleInput).toHaveAttribute('readonly', '');

  expect(cspOrPageErrors).toEqual([]);
});
