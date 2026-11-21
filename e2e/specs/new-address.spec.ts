// The bookmarkable /new address: it makes one new note and opens it ready to type, and
// the address /new is replaced by the note's own, so Back and Refresh never make another.
// Logged out, /new is kept through the login page. A failed create offers Try again.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { body, login, PASSWORD } from './helpers';

const USER = 'bob';
const count = async (r: APIRequestContext) => ((await (await r.get('/api/notes')).json()).notes as unknown[]).length;
const NOTE_URL = /\/n\/[A-Za-z0-9_-]+$/;
const opened = async (page: Page) => {
  await expect(page).toHaveURL(NOTE_URL);
  await expect(body(page)).toBeFocused();
};

test('/new makes exactly one note and opens it; Back, Forward and Refresh make no other', async ({ page }) => {
  await login(page, USER);
  const before = await count(page.request);
  await page.goto('/new');
  await opened(page);
  const noteUrl = page.url();
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('');
  await page.waitForTimeout(800);
  expect(await count(page.request)).toBe(before + 1);

  await page.goBack(); // to the home page we came from, not to /new
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await expect(page).toHaveURL(noteUrl);
  await page.reload();
  await expect(page).toHaveURL(noteUrl);
  await expect(page.getByRole('textbox', { name: 'Title' })).toBeVisible();
  await page.waitForTimeout(800);
  expect(await count(page.request)).toBe(before + 1);
});

test('logged out, /new goes through the login page and makes the note after logging in', async ({ page, request }) => {
  await request.post('/api/login', { data: { username: USER, password: PASSWORD } }); // its own cookies, not the page's
  const before = await count(request);

  await page.goto('/new');
  await expect(page).toHaveURL(/\/login\?next=%2Fnew$/);
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  expect(await count(request)).toBe(before);

  await page.getByLabel('Username').fill(USER);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await opened(page);
  await page.waitForTimeout(800);
  expect(await count(request)).toBe(before + 1);

  await page.goBack(); // /login and /new were both replaced: nothing left to go back to in the app
  await page.waitForTimeout(800);
  expect(await count(request)).toBe(before + 1);
});

test('after logging in, a next address other than /new is ignored', async ({ page }) => {
  await page.goto('/login?next=' + encodeURIComponent('//example.com/new'));
  await page.getByLabel('Username').fill(USER);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/^http:\/\/[^/]+\/$/);
  await expect(page.getByTestId('notes-list')).toBeVisible();
});

test('a failed create shows the error and Try again makes the note', async ({ page }) => {
  await login(page, USER);
  const before = await count(page.request);
  let fail = true;
  await page.route(/\/api\/notes(\?|$)/, (route) => {
    if (route.request().method() === 'POST' && fail) {
      fail = false;
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'The server is out of space.' }) });
    }
    return route.continue();
  });
  await page.goto('/new');
  await expect(page.getByRole('alert')).toHaveText('The server is out of space.');
  await expect(page).toHaveURL(/\/new$/);
  expect(await count(page.request)).toBe(before);

  await page.getByRole('button', { name: 'Try again' }).click();
  await opened(page);
  await page.waitForTimeout(800);
  expect(await count(page.request)).toBe(before + 1);
});
