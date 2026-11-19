// Editor extras: Clear formatting, opening links, a full-width writing area with a right
// margin marker, no vertical scrollbars anywhere, and showing invisible characters.
import { expect, test, type Page } from '@playwright/test';
import { body, goHome, login, newNote, openMenu, typeInBody, uniq, waitSaved } from './helpers';

const noteId = (page: Page) => new URL(page.url()).pathname.split('/').pop()!;
async function setContent(page: Page, content: unknown) {
  expect((await page.request.patch(`/api/notes/${noteId(page)}`, { data: { content } })).status()).toBe(200);
  await page.reload();
  await expect(body(page)).toBeVisible();
}
const saved = async (page: Page) => (await (await page.request.get(`/api/notes/${noteId(page)}`)).json()).note.content;
const p = (text: string, marks?: unknown[]) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
const STYLED = [{ type: 'bold' }, { type: 'italic' }, { type: 'textStyle', attrs: { fontFamily: '"Lora"', fontSize: '32px', color: '#E11D48' } }, { type: 'highlight', attrs: { color: '#FFE38F' } }];

test('Clear formatting clears styled text, a heading and a list item; typing afterwards is plain', async ({ page }) => {
  await login(page, 'alice');
  await newNote(page, `Clear ${uniq()}`);
  await setContent(page, {
    type: 'doc',
    content: [
      p('Styled words', STYLED),
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'A heading' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('A list item', [{ type: 'bold' }])] }] },
      p('Kept link', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
    ],
  });
  const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
  await body(page).click({ delay: 60 });
  await page.keyboard.press('Control+A');
  await page.waitForTimeout(150);
  await toolbar.getByRole('button', { name: 'Clear formatting' }).click();
  await waitSaved(page);
  const doc = await saved(page);
  expect(doc.content.map((b: any) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph']);
  expect(doc.content.slice(0, 3)).toEqual([p('Styled words'), p('A heading'), p('A list item')]);
  expect(doc.content[3].content).toEqual([{ type: 'text', text: 'Kept link', marks: [{ type: 'link', attrs: expect.objectContaining({ href: 'https://example.com' }) }] }]);

  // With nothing selected: the current paragraph, and what is typed next is plain.
  await setContent(page, { type: 'doc', content: [p('Bold big', [{ type: 'bold' }, { type: 'textStyle', attrs: { fontFamily: '"Lora"', fontSize: '30px' } }]), p('Other', [{ type: 'bold' }])] });
  await body(page).getByText('Bold big').click({ delay: 60 });
  await page.keyboard.press('End');
  await toolbar.getByRole('button', { name: 'Clear formatting' }).click();
  await expect(toolbar.getByRole('button', { name: 'Styles' })).toHaveText(/^Styles/);
  await expect(toolbar.getByRole('button', { name: 'Font', exact: true })).toHaveText(/Inter/);
  await expect(toolbar.getByRole('textbox', { name: 'Font size' })).toHaveValue('16');
  await expect(toolbar.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.type(' plain');
  await waitSaved(page);
  expect((await saved(page)).content).toEqual([p('Bold big plain'), p('Other', [{ type: 'bold' }])]);
});

test('Ctrl+click opens a link in a new tab, a plain click edits it; a typed web address becomes a link', async ({ page, context }) => {
  await login(page, 'alice');
  await newNote(page, `Links ${uniq()}`);
  await typeInBody(page, 'go to https://example.com/typed and on');
  await page.keyboard.press('Enter');
  await page.keyboard.type('next line');
  await waitSaved(page);
  const link = body(page).locator('a[href="https://example.com/typed"]');
  await expect(link).toHaveText('https://example.com/typed');
  await expect(link).toHaveAttribute('title', 'Ctrl+click to open');
  const content = JSON.stringify(await saved(page));
  expect(content).toContain('"href":"https://example.com/typed"');

  // A plain click places the cursor and opens nothing.
  let opened = 0;
  context.on('page', () => opened++);
  await link.click({ delay: 60 });
  await page.waitForTimeout(500);
  expect(opened).toBe(0);
  await expect(page).toHaveURL(new RegExp(`/n/${noteId(page)}$`));
  // Ctrl+click opens a new tab.
  const tab = context.waitForEvent('page');
  await link.click({ modifiers: ['Control'] });
  const newTab = await tab;
  await expect.poll(() => newTab.url()).toMatch(/^https:\/\/example\.com\/typed|^about:blank|^chrome-error/);
  expect(await newTab.evaluate(() => window.opener)).toBeNull(); // noopener
  await newTab.close();

  // Links made with the link button behave the same.
  await body(page).getByText('next line').click({ delay: 60 });
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Link' }).click();
  await page.getByRole('textbox', { name: 'Link address' }).fill('https://example.org/');
  await page.getByRole('textbox', { name: 'Link address' }).press('Enter');
  const made = body(page).locator('a[href="https://example.org/"]');
  await expect(made).toHaveAttribute('title', 'Ctrl+click to open');
  const tab2 = context.waitForEvent('page');
  await made.click({ modifiers: ['Control'] });
  await (await tab2).close();

  // In a read-only note a plain click opens the link.
  await waitSaved(page);
  await page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Make read-only' }).click();
  await page.getByRole('button', { name: 'Confirm: make read-only' }).click();
  await expect(page.getByTestId('read-only-indicator')).toBeVisible();
  const tab3 = context.waitForEvent('page');
  await body(page).locator('a[href="https://example.com/typed"]').click();
  await (await tab3).close();
});

test('the writing area fills the window, with a fixed right margin marker where lines wrap', async ({ page }) => {
  await login(page, 'alice');
  await newNote(page, `Wide ${uniq()}`);
  const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
  await setContent(page, { type: 'doc', content: [p(words), ...Array.from({ length: 40 }, (_, i) => p(`line ${i}`))] });

  const check = async () => {
    const pane = (await page.locator('.note-pane').boundingBox())!;
    const content = (await page.locator('.note-content').boundingBox())!;
    expect(Math.round(content.width)).toBe(Math.round(pane.width)); // no narrower centred column
    const marker = page.getByTestId('wrap-marker');
    await expect(marker.locator('.wrap-marker-line')).toBeVisible();
    const line = (await marker.locator('.wrap-marker-line').boundingBox())!;
    const tri = (await marker.locator('.wrap-marker-triangle').boundingBox())!;
    const toolbar = (await page.getByRole('toolbar', { name: 'Formatting' }).boundingBox())!;
    // Line: 1px, full height of the writing area, near the right edge with a gutter beyond it.
    expect(Math.round(line.width)).toBe(1);
    expect(line.x).toBeLessThan(pane.x + pane.width - 24);
    expect(line.x).toBeGreaterThan(pane.x + pane.width - 80);
    expect(Math.abs(line.y - (toolbar.y + toolbar.height))).toBeLessThan(2);
    expect(Math.abs(line.y + line.height - (pane.y + pane.height))).toBeLessThan(2);
    // The triangle sits on the line just under the toolbar.
    expect(Math.abs(tri.x + tri.width / 2 - (line.x + 0.5))).toBeLessThan(1.5);
    expect(Math.abs(tri.y - (toolbar.y + toolbar.height))).toBeLessThan(2);
    // Text wraps exactly at the line: the longest line ends just before it.
    const right = await body(page).locator('p').first().evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return Math.max(...Array.from(r.getClientRects()).map((x) => x.right));
    });
    expect(right).toBeLessThanOrEqual(line.x + 0.5);
    expect(right).toBeGreaterThan(line.x - 70);
    return line;
  };
  const wide = await check();
  await expect(page.getByTestId('wrap-marker').locator('.wrap-marker-line')).toHaveCSS('background-color', 'rgb(180, 200, 140)');
  await expect(page.getByTestId('wrap-marker').locator('.wrap-marker-triangle')).toHaveCSS('border-top-color', 'rgb(77, 124, 15)');
  await expect(page.getByTestId('wrap-marker')).toHaveCSS('pointer-events', 'none');
  await expect(page.getByTestId('wrap-marker')).toHaveCSS('user-select', 'none');
  expect(await page.locator('.ProseMirror [data-testid="wrap-marker"]').count()).toBe(0); // not part of the note
  await page.screenshot({ path: 'test-results/screens/wrap-marker.png' });

  // It stays put while the note scrolls.
  await page.locator('.note-scroll').hover();
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => page.locator('.note-scroll').evaluate((el) => el.scrollTop)).toBeGreaterThan(500);
  const afterScroll = (await page.getByTestId('wrap-marker').locator('.wrap-marker-line').boundingBox())!;
  expect(afterScroll.x).toBe(wide.x);
  expect(afterScroll.y).toBe(wide.y);

  // The width tracks the window.
  await page.setViewportSize({ width: 1000, height: 800 });
  const narrow = await check();
  expect(narrow.x).toBeLessThan(wide.x - 300);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(JSON.stringify(await saved(page))).not.toMatch(/marker/);
});

test('no element shows a vertical scrollbar, yet long notes, lists and menus still scroll', async ({ page }) => {
  await login(page, 'alice');
  const scrollbars = () =>
    page.evaluate(() =>
      [document.documentElement, ...Array.from(document.querySelectorAll('*'))]
        .filter((el) => {
          const cs = getComputedStyle(el);
          const bars = (el as HTMLElement).offsetWidth - el.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
          // Only elements that can scroll vertically (and the page itself) can draw a vertical scrollbar.
          const scrolls = el === document.documentElement || ['auto', 'scroll'].includes(cs.overflowY);
          return scrolls && el.clientWidth > 0 && bars > 0.5;
        })
        .map((el) => `${el.tagName}.${(el as HTMLElement).className}`),
    );
  // A long note.
  await newNote(page, `Scroll ${uniq()}`);
  await setContent(page, { type: 'doc', content: Array.from({ length: 120 }, (_, i) => p(`paragraph ${i}`)) });
  expect(await page.locator('.note-scroll').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await scrollbars()).toEqual([]);
  await page.locator('.note-scroll').hover();
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.locator('.note-scroll').evaluate((el) => el.scrollTop)).toBeGreaterThan(300);
  await body(page).getByText('paragraph 30', { exact: true }).click({ delay: 60 });
  await page.keyboard.press('Control+End');
  await expect(body(page).getByText('paragraph 119', { exact: true })).toBeInViewport();
  // An open dropdown menu.
  await openMenu(page, 'Font');
  expect(await scrollbars()).toEqual([]);
  await page.keyboard.press('Escape');
  // The home page and the other screens.
  await goHome(page);
  expect(await scrollbars()).toEqual([]);
  for (const name of ['Fonts', 'Styles', 'Backup', 'Trash']) {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    expect(await scrollbars(), name).toEqual([]);
  }
  // The Fonts screen is long: it scrolls with the wheel.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Fonts' }).click();
  await expect(page.getByTestId('catalog-card').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('.screen').hover();
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => page.locator('.screen').evaluate((el) => el.scrollTop)).toBeGreaterThan(300);
  expect(await scrollbars()).toEqual([]);
});

test('invisible characters show on demand, are remembered, and never reach the note', async ({ page }) => {
  await login(page, 'alice');
  await newNote(page, `Invisibles ${uniq()}`);
  const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
  const toggle = toolbar.getByRole('button', { name: 'Show spaces, tabs and line ends' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await typeInBody(page, 'one two');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('three');
  await page.keyboard.press('Enter');
  await page.keyboard.type('four');
  await waitSaved(page);
  await expect(body(page).locator('.inv-space')).toHaveCount(1);
  await expect(body(page).locator('.inv-break')).toHaveCount(1);
  await expect(body(page).locator('.inv-para')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/screens/invisibles.png' });
  // The saved note is exactly what was typed.
  expect(await saved(page)).toEqual({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one two' }, { type: 'hardBreak' }, { type: 'text', text: 'three' }] }, p('four')],
  });
  // Copying gives the plain text, without the marks.
  await body(page).getByText('four').click({ delay: 60 });
  await page.keyboard.press('Control+A');
  await page.waitForTimeout(150);
  await page.evaluate(() => document.addEventListener('copy', (e) => ((window as any).__c = e.clipboardData!.getData('text/plain')), { once: true }));
  await page.keyboard.press('Control+C');
  const copied = await page.waitForFunction(() => (window as any).__c).then((h) => h.jsonValue());
  expect(copied).not.toMatch(/[·¶→↵]/);
  expect(copied).toContain('one two');
  // Search does not see them either.
  expect((await (await page.request.get('/api/search?q=%C2%B6')).json()).notes).toEqual([]);
  // Remembered in this browser, and available on a read-only note.
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(body(page).locator('.inv-para')).toHaveCount(2);
  await toolbar.getByRole('button', { name: 'Make read-only' }).click();
  await page.getByRole('button', { name: 'Confirm: make read-only' }).click();
  await expect(page.getByTestId('read-only-indicator')).toBeVisible();
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(body(page).locator('.inv-para')).toHaveCount(0);
  await toggle.click();
  await expect(body(page).locator('.inv-para')).toHaveCount(2);
  await toggle.click(); // leave it off for the other flows
});
