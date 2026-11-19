// Log in and log out; wrong password is refused.
import { expect, test } from '@playwright/test';
import { login, PASSWORD } from './helpers';

test('log in and log out; a wrong password is refused', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Username').fill('alice');
  await page.getByLabel('Password').fill('not the password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong username or password.');
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  expect((await page.request.get('/api/notes')).status()).toBe(401);

  await login(page, 'alice', PASSWORD);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  const session = (await page.context().cookies()).find((c) => c.name === 'jot_session');
  expect(session?.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('jot_session');

  await page.getByRole('button', { name: /^Log out/ }).click();
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get('/api/notes')).status()).toBe(401);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
});
