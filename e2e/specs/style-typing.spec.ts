// A style applied with nothing selected changes only what is typed next (as Bold does):
// text already written keeps its look, and two styles chosen one after the other while
// typing give one phrase in two styles.
import { expect, test, type Page } from '@playwright/test';
import { body, login, newNote, typeInBody, uniq } from './helpers';

async function chooseStyle(page: Page, name: string) {
  const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
  await toolbar.getByRole('button', { name: 'Styles' }).click();
  await page.getByRole('menu', { name: 'Styles' }).getByRole('menuitem', { name }).click();
}

/** The computed look of the text node holding `text`. */
const lookOf = (page: Page, text: string) =>
  body(page).evaluate((root, t) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.textContent!.includes(t)) {
        const s = getComputedStyle(n.parentElement!);
        return { family: s.fontFamily, style: s.fontStyle, size: s.fontSize, colour: s.color };
      }
    }
    return null;
  }, text);

test('a style chosen with nothing selected applies to what is typed next, not the sentence before', async ({ page }) => {
  await login(page, 'alice');
  await newNote(page, `Typing ${uniq()}`);
  await typeInBody(page, 'Plain start ');
  const plain = (await lookOf(page, 'Plain start'))!;

  // Cursor at the end of the sentence, nothing selected.
  await chooseStyle(page, 'Quote');
  await page.keyboard.type('hello ');
  await chooseStyle(page, 'Aside');
  await page.keyboard.type('world');

  // One paragraph, three looks.
  await expect(body(page).locator(':scope > p')).toHaveCount(1);
  await expect(body(page).locator(':scope > p')).toHaveText('Plain start hello world');
  expect(await lookOf(page, 'Plain start')).toEqual(plain); // the sentence before did not change
  const hello = (await lookOf(page, 'hello'))!;
  expect(hello.family).toMatch(/Lora/);
  expect(hello.style).toBe('italic');
  expect(hello.size).toBe('20px');
  expect(hello.colour).toBe('rgb(143, 42, 244)');
  const world = (await lookOf(page, 'world'))!;
  expect(world.family).toMatch(/Caveat/);
  expect(world.style).toBe('normal');
  expect(world.size).toBe('24px');
  expect(world.colour).toBe('rgb(10, 71, 255)');

  // With text selected, a style still restyles the selection.
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await chooseStyle(page, 'Code');
  for (const t of ['Plain start', 'hello', 'world']) expect((await lookOf(page, t))!.family).toMatch(/Fira Code/);
});
