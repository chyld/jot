// Default fonts cannot be archived (no Archive action, server refuses); Empty trash
// deletes every trashed note after an in-page confirmation, and nothing else.
import { expect, test } from '@playwright/test';
import { goHome, login, newNote, uniq } from './helpers';

test('default fonts have no Archive action, and the server refuses to archive them', async ({ page }) => {
  await login(page, 'carol');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Fonts' }).click();
  const mine = page.getByRole('region', { name: 'Your fonts' });
  for (const family of ['Inter', 'Lora', 'Playfair Display', 'Caveat', 'Fira Code']) {
    await expect(mine.getByRole('button', { name: `Archive ${family}` })).toHaveCount(0);
    await expect(mine.getByRole('listitem').filter({ hasText: family })).toContainText(/default font/i);
  }
  const fonts = (await (await page.request.get('/api/fonts')).json()).fonts;
  const inter = fonts.find((f: any) => f.family === 'Inter');
  const res = await page.request.post(`/api/fonts/${inter.id}/archive`, { data: {} });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toMatch(/default font/i);
  await page.screenshot({ path: 'test-results/screens/fonts-defaults.png' });
});

test('Empty trash deletes every trashed note after a second click, and nothing else', async ({ page }) => {
  await login(page, 'carol');
  const word = uniq('bin');
  const keep = `Keep ${word}`;
  const gone = [`Gone one ${word}`, `Gone two ${word}`];
  await newNote(page, keep);
  const ids: string[] = [];
  for (const t of gone) {
    await newNote(page, t);
    ids.push(new URL(page.url()).pathname.split('/').pop()!);
    await page.getByRole('button', { name: 'Move to trash' }).click();
    await expect(page).toHaveURL(/\/$/);
  }
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Trash' }).click();
  const list = page.locator('.trash-list');
  for (const t of gone) await expect(list).toContainText(t);
  const count = await list.locator('li').count();

  await page.getByRole('button', { name: 'Empty trash' }).click();
  await expect(page.getByText(new RegExp(`${count} notes? will be deleted forever`))).toBeVisible();
  await expect(page.getByText(/cannot be undone/)).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/trash-empty-confirm.png' });
  await page.getByRole('button', { name: 'Confirm: empty trash' }).click();
  await expect(page.getByText('The trash is empty.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Empty trash' })).toHaveCount(0);
  for (const id of ids) expect((await page.request.get(`/api/notes/${id}`)).status()).toBe(404);
  await goHome(page);
  await expect(page.getByTestId('notes-list')).toContainText(keep);
});
