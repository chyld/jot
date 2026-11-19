// One intent creates one note: while a new note is being created and opened, further
// activations of the left-bar + or the home page's + New are ignored (never queued);
// focus leaves the button at once; keys typed meanwhile end up in the note body.
import { expect, test, type Page } from '@playwright/test';
import { body, goHome, login, waitSaved } from './helpers';

const count = async (page: Page) => ((await (await page.request.get('/api/notes')).json()).notes as unknown[]).length;
const plus = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'New note' });
const settle = async (page: Page) => {
  await expect(page).toHaveURL(/\/n\/[A-Za-z0-9_-]+$/);
  await expect(body(page)).toBeFocused();
  await page.waitForTimeout(800);
};
const noteId = (page: Page) => new URL(page.url()).pathname.split('/').pop()!;

test.beforeEach(async ({ page }) => {
  await login(page, 'carol');
});

test('a double-click on + makes one note', async ({ page }) => {
  const before = await count(page);
  await plus(page).dblclick();
  await settle(page);
  expect(await count(page)).toBe(before + 1);
});

// A completely empty open note is reused: + puts the cursor in its body instead of
// making another note (owner decision). That is what stops bursts the in-flight flag
// alone cannot (the editor is ready before the next click arrives).
test('five clicks on + 150 ms apart make one note', async ({ page }) => {
  const before = await count(page);
  for (let i = 0; i < 5; i++) {
    await plus(page).click();
    await page.waitForTimeout(150);
  }
  await settle(page);
  expect(await count(page)).toBe(before + 1);
});

test('seven clicks on + 170 ms apart make one note', async ({ page }) => {
  const before = await count(page);
  for (let i = 0; i < 7; i++) {
    await plus(page).click();
    await page.waitForTimeout(170);
  }
  await settle(page);
  expect(await count(page)).toBe(before + 1);
});

test('a double-click on the home page’s + New makes one note', async ({ page }) => {
  await goHome(page);
  const before = await count(page);
  await page.getByRole('button', { name: 'New', exact: true }).dblclick();
  await settle(page);
  expect(await count(page)).toBe(before + 1);
});

test('click + then Enter four times quickly makes one note', async ({ page }) => {
  const before = await count(page);
  await plus(page).click();
  for (let i = 0; i < 4; i++) await page.keyboard.press('Enter');
  await settle(page);
  expect(await count(page)).toBe(before + 1);
});

test('typing straight after + keeps every character, in order', async ({ page }) => {
  await plus(page).click();
  await page.keyboard.type('one two three four');
  await settle(page);
  await expect(body(page)).toHaveText('one two three four');
  await waitSaved(page);
  const saved = (await (await page.request.get(`/api/notes/${noteId(page)}`)).json()).note.content;
  expect(JSON.stringify(saved)).toContain('"text":"one two three four"');
});

test('two presses a second apart with nothing typed make one note, with the cursor in its body', async ({ page }) => {
  const before = await count(page);
  await plus(page).click();
  await settle(page);
  const first = noteId(page);
  await page.getByRole('textbox', { name: 'Title' }).focus(); // somewhere else, to see the cursor come back
  await plus(page).click();
  await expect(body(page)).toBeFocused();
  await page.waitForTimeout(800);
  expect(noteId(page)).toBe(first);
  expect(await count(page)).toBe(before + 1);
});

test('press, type a word, press again makes two notes', async ({ page }) => {
  const before = await count(page);
  await plus(page).click();
  await settle(page);
  const first = noteId(page);
  await page.keyboard.type('word');
  await plus(page).click(); // straight away: the editor's current text counts, not a saved copy
  await expect(page).not.toHaveURL(new RegExp(first));
  await settle(page);
  expect(await count(page)).toBe(before + 2);
  await page.goto(`/n/${first}`);
  await expect(body(page)).toHaveText('word');
});

test('press, add only a title, press again makes two notes', async ({ page }) => {
  const before = await count(page);
  await plus(page).click();
  await settle(page);
  const first = noteId(page);
  await page.getByRole('textbox', { name: 'Title' }).fill('Only a title');
  await plus(page).click();
  await expect(page).not.toHaveURL(new RegExp(first));
  await settle(page);
  expect(await count(page)).toBe(before + 2);
});

test('home page + New, then the left-bar + twice, makes one note', async ({ page }) => {
  await goHome(page);
  const before = await count(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await settle(page);
  await plus(page).click();
  await page.waitForTimeout(300);
  await plus(page).click();
  await page.waitForTimeout(800);
  await expect(body(page)).toBeFocused();
  expect(await count(page)).toBe(before + 1);
});
