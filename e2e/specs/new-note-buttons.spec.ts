// The New buttons have no rules: every press of the left-bar + or the home page's + New
// creates a note. Nothing is guarded or reused (owner decision).
import { expect, test, type Page } from '@playwright/test';
import { body, goHome, login } from './helpers';

const count = async (page: Page) => ((await (await page.request.get('/api/notes')).json()).notes as unknown[]).length;
const plus = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'New note' });
const opened = async (page: Page) => {
  await expect(page).toHaveURL(/\/n\/[A-Za-z0-9_-]+$/);
  await expect(body(page)).toBeFocused();
};
const noteId = (page: Page) => new URL(page.url()).pathname.split('/').pop()!;

test.beforeEach(async ({ page }) => {
  await login(page, 'carol');
});

test('a double-click on + makes two notes', async ({ page }) => {
  const before = await count(page);
  await plus(page).dblclick();
  await expect.poll(() => count(page)).toBe(before + 2);
  await opened(page);
});

test('a double-click on the home page’s + New makes two notes', async ({ page }) => {
  await goHome(page);
  const before = await count(page);
  await page.getByRole('button', { name: 'New', exact: true }).dblclick();
  await expect.poll(() => count(page)).toBe(before + 2);
  await opened(page);
});

test('pressing + in an empty note makes another note', async ({ page }) => {
  const before = await count(page);
  await plus(page).click();
  await opened(page);
  const first = noteId(page);
  await plus(page).click();
  await expect(page).not.toHaveURL(new RegExp(`${first}$`));
  await opened(page);
  expect(await count(page)).toBe(before + 2);
});

test('+ works again after a create fails', async ({ page }) => {
  const before = await count(page);
  await page.route('**/api/notes', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 500, body: '{}' }) : route.fallback()));
  await plus(page).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.unroute('**/api/notes');
  await plus(page).click();
  await opened(page);
  expect(await count(page)).toBe(before + 1);
});
