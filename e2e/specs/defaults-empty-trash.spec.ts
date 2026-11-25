// Default fonts cannot be archived (no Archive action, server refuses); Empty trash
// deletes every trashed note after an in-page confirmation, and nothing else.
import { expect, test } from '@playwright/test';
import { goHome, login, newNote, openTrash, uniq } from './helpers';

test('default fonts have no Archive action, and the server refuses to archive them', async ({ page }) => {
  await login(page, 'carol');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Fonts' }).click();
  const mine = page.getByRole('region', { name: 'Your fonts' });
  const customFonts = page.getByTestId('custom-fonts');
  const defaultFonts = page.getByTestId('default-fonts');
  await expect(customFonts).toContainText(/No custom fonts added yet/i);
  expect((await customFonts.boundingBox())!.y).toBeLessThan((await defaultFonts.boundingBox())!.y);
  for (const family of ['Inter', 'Lora', 'Playfair Display', 'Caveat', 'Fira Code']) {
    await expect(mine.getByRole('button', { name: `Archive ${family}` })).toHaveCount(0);
    await expect(defaultFonts.getByRole('listitem').filter({ hasText: family })).toContainText(/default font/i);
  }
  const fonts = (await (await page.request.get('/api/fonts')).json()).fonts;
  const inter = fonts.find((f: any) => f.family === 'Inter');
  const res = await page.request.post(`/api/fonts/${inter.id}/archive`, { data: {} });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toMatch(/default font/i);
  await page.screenshot({ path: 'test-results/screens/fonts-defaults.png' });
});

test('default styles have no Edit or Delete; a style the user makes, even one called Body, does', async ({ page }) => {
  await login(page, 'carol');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Styles' }).click();
  const customStyles = page.getByTestId('custom-styles');
  const defaultStyles = page.getByTestId('default-styles');
  await expect(customStyles).toContainText(/No custom styles yet/i);
  expect((await customStyles.boundingBox())!.y).toBeLessThan((await defaultStyles.boundingBox())!.y);
  for (const name of ['Body', 'Title', 'Quote', 'Aside', 'Code']) {
    const card = defaultStyles.getByTestId('style-card').filter({ hasText: 'Default style' }).and(page.getByRole('article', { name: `Style ${name}`, exact: true }));
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('button', { name: /Edit|Delete/ })).toHaveCount(0);
  }
  const styles = (await (await page.request.get('/api/styles')).json()).styles;
  const body = styles.find((s: any) => s.name === 'Body' && s.isDefault);
  const res = await page.request.delete(`/api/styles/${body.id}`);
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toMatch(/default style/i);
  const name = `Body`;
  await page.getByRole('button', { name: 'New style' }).click();
  const dialog = page.getByRole('dialog', { name: 'New style' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Size (px)').fill('27');
  await dialog.getByRole('button', { name: 'Save style' }).click();
  const mine = customStyles.getByTestId('style-card').and(page.getByRole('article', { name: 'Style Body', exact: true }));
  await expect(mine).toHaveCount(1);
  await expect(mine.getByRole('button', { name: 'Edit' })).toBeVisible();
  expect((await mine.boundingBox())!.y).toBeLessThan((await defaultStyles.boundingBox())!.y);
  await page.screenshot({ path: 'test-results/screens/styles-defaults.png' });
  await mine.getByRole('button', { name: /Delete/ }).click();
  await mine.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(mine).toHaveCount(0);
  await expect(customStyles).toContainText(/No custom styles yet/i);
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
  await openTrash(page);
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
