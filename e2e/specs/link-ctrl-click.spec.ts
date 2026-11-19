// Ctrl+click on a link opens it and leaves the editor's selection exactly as it was:
// nothing gets node-selected, so the next keystroke only inserts at the cursor and can
// never replace a paragraph (owner bug report).
import { expect, test, type Page } from '@playwright/test';
import { body, login, makePng, newNote, uniq, waitSaved } from './helpers';

const noteId = (page: Page) => new URL(page.url()).pathname.split('/').pop()!;
const saved = async (page: Page) => (await (await page.request.get(`/api/notes/${noteId(page)}`)).json()).note.content;
const LINK = { type: 'link', attrs: { href: 'https://example.com/' } };
const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const FIRST = para(t('first paragraph stays'));
const SECOND = para(t('please see '), t('example', [LINK]), t(' for details'));

/** Every text run in the saved note, in order. */
function texts(doc: any): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n.type === 'text') out.push(n.text);
    (n.content ?? []).forEach(walk);
  };
  walk(doc);
  return out;
}

async function open(page: Page, content: unknown) {
  await newNote(page, `Ctrl-click ${uniq()}`);
  expect((await page.request.patch(`/api/notes/${noteId(page)}`, { data: { content } })).status()).toBe(200);
  await page.reload();
  await expect(body(page)).toBeVisible();
}

const selectionState = (page: Page) =>
  page.evaluate(() => ({
    text: window.getSelection()!.toString(),
    selectedNodes: document.querySelectorAll('.ProseMirror-selectednode').length,
  }));

/** Ctrl+clicks the link, checks a tab opened, and comes back to the note. */
async function ctrlClickLink(page: Page, link: ReturnType<Page['locator']>) {
  const tab = page.context().waitForEvent('page');
  await link.click({ modifiers: ['Control'] });
  await (await tab).close();
  await page.bringToFront();
}

test('the reported steps: Ctrl+click a link, come back, type one letter without clicking: nothing is replaced', async ({ page }) => {
  await login(page, 'alice');
  await open(page, { type: 'doc', content: [FIRST, SECOND] });
  // The cursor is at the end of the first paragraph, as after writing it.
  await body(page).getByText('first paragraph stays').click({ delay: 60 });
  await page.keyboard.press('End');
  await page.waitForTimeout(150);
  const before = await selectionState(page);

  await ctrlClickLink(page, body(page).locator('a[href="https://example.com/"]'));
  expect(await selectionState(page)).toEqual(before);
  expect(before.selectedNodes).toBe(0);

  await page.keyboard.type('X');
  await waitSaved(page);
  expect(texts(await saved(page))).toEqual(['first paragraph staysX', 'please see ', 'example', ' for details']);
});

test('a text selection is left exactly as it was, and typing replaces only that text', async ({ page }) => {
  await login(page, 'alice');
  await open(page, { type: 'doc', content: [FIRST, SECOND] });
  // Select "first" with the keyboard.
  await body(page).getByText('first paragraph stays').click({ delay: 60 });
  await page.keyboard.press('Home');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(150);
  const before = await selectionState(page);
  expect(before.text).toBe('first');
  await ctrlClickLink(page, body(page).locator('a[href="https://example.com/"]'));
  expect(await selectionState(page)).toEqual(before);
  await page.keyboard.type('Y');
  await waitSaved(page);
  const all = texts(await saved(page));
  expect(all.slice(1)).toEqual(['please see ', 'example', ' for details']);
  expect(all[0]).toBe('Y paragraph stays');
});

const PLACES: Array<[string, (link: unknown) => unknown]> = [
  ['a list item', (l) => ({ type: 'bulletList', content: [{ type: 'listItem', content: [para(t('item with '), l, t(' inside'))] }] })],
  ['a table cell', (l) => ({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [para(t('cell with '), l)] }, { type: 'tableCell', content: [para(t('other cell'))] }] }] })],
  ['a heading', (l) => ({ type: 'heading', attrs: { level: 2 }, content: [t('heading with '), l] })],
  ['a block quote', (l) => ({ type: 'blockquote', content: [para(t('quote with '), l, t(' inside'))] })],
  ['a paragraph of its own', (l) => para(l)],
];

for (const [where, wrap] of PLACES) {
  test(`a link in ${where}: Ctrl+click leaves the selection alone and typing only inserts at the cursor`, async ({ page }) => {
    await login(page, 'alice');
    const content = { type: 'doc', content: [FIRST, wrap(t('example', [LINK])), para(t('last paragraph'))] };
    await open(page, content);
    const before = texts(await saved(page));
    await body(page).getByText('first paragraph stays').click({ delay: 60 });
    await page.keyboard.press('End');
    await page.waitForTimeout(150);
    const sel = await selectionState(page);
    await ctrlClickLink(page, body(page).locator('a[href="https://example.com/"]'));
    expect(await selectionState(page)).toEqual(sel);
    await page.keyboard.type('Z');
    await waitSaved(page);
    expect(texts(await saved(page))).toEqual(['first paragraph staysZ', ...before.slice(1)]);
  });
}

const TEXT_PLACES: Array<[string, unknown, string]> = [
  ['a paragraph', para(t('plain words here')), 'plain words here'],
  ['a heading', { type: 'heading', attrs: { level: 2 }, content: [t('plain heading words')] }, 'plain heading words'],
  ['a list item', { type: 'bulletList', content: [{ type: 'listItem', content: [para(t('plain item words'))] }] }, 'plain item words'],
  ['a table cell', { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [para(t('plain cell words'))] }, { type: 'tableCell', content: [para(t('other cell'))] }] }] }, 'plain cell words'],
  ['a block quote', { type: 'blockquote', content: [para(t('plain quote words'))] }, 'plain quote words'],
];

for (const [where, block, words] of TEXT_PLACES) {
  test(`Ctrl+click on ordinary text in ${where} never selects the block; typing afterwards replaces nothing`, async ({ page }) => {
    await login(page, 'alice');
    await open(page, { type: 'doc', content: [FIRST, block, para(t('last paragraph'))] });
    const before = texts(await saved(page));
    await body(page).getByText('first paragraph stays').click({ delay: 60 });
    await page.keyboard.press('End');
    await page.waitForTimeout(150);
    const sel = await selectionState(page);
    let tabs = 0;
    page.context().on('page', () => tabs++);
    await body(page).getByText(words, { exact: true }).click({ modifiers: ['Control'] });
    await page.waitForTimeout(200);
    expect(await selectionState(page)).toEqual(sel);
    expect(sel.selectedNodes).toBe(0);
    await page.keyboard.type('Q');
    await waitSaved(page);
    expect(texts(await saved(page))).toEqual(['first paragraph staysQ', ...before.slice(1)]);
    expect(tabs).toBe(0);
  });
}

test('photos: a plain click still selects one (controls and handles); Ctrl+click selects nothing; keyboard shortcuts still work', async ({ page }) => {
  await login(page, 'alice');
  const up = await page.request.post('/api/photos', { multipart: { file: { name: 'p.png', mimeType: 'image/png', buffer: makePng(200, 150) } } });
  const src = (await up.json()).photo.url;
  await open(page, { type: 'doc', content: [FIRST, para(t('plain words here')), { type: 'image', attrs: { src } }] });
  await body(page).locator('.jot-photo img').click({ modifiers: ['Control'] });
  await page.waitForTimeout(200);
  await expect(page.getByRole('toolbar', { name: 'Photo' })).toHaveCount(0);
  await body(page).locator('.jot-photo img').click();
  await expect(page.getByRole('toolbar', { name: 'Photo' })).toBeVisible();
  await expect(body(page).locator('.jot-photo-handle')).toHaveCount(4);
  // Ctrl+A selects everything, as before.
  await body(page).getByText('plain words here').click({ delay: 60 });
  await page.keyboard.press('Control+A');
  await page.waitForTimeout(150);
  expect((await selectionState(page)).text).toContain('first paragraph stays');
  expect((await selectionState(page)).text).toContain('plain words here');
});
