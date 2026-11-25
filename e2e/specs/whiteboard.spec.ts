// Whiteboards MVP (Excalidraw): lazy chunk split, zero external network requests (offline fonts),
// strict CSP compliance, drawing & autosave persistence across reload, home card tile & preview,
// and read-only lock blocking canvas edits.
import { expect, test } from '@playwright/test';
import { goHome, login, newNote, uniq, waitSaved } from './helpers';

test('create a whiteboard, draw under strict CSP with offline fonts, persist across reload, and lock read-only', async ({ page }) => {
  const cspOrPageErrors: string[] = [];
  const boardChunkRequests: string[] = [];
  const externalRequests: string[] = [];
  const badFontResponses: string[] = [];

  page.on('pageerror', (err) => cspOrPageErrors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /content security policy|eval|unsafe/i.test(msg.text())) {
      cspOrPageErrors.push(`console: ${msg.text()}`);
    }
  });
  page.on('request', (req) => {
    const url = req.url();
    if (/BoardEditor-.*\.js/.test(url)) boardChunkRequests.push(url);
    if (/esm\.sh|excalidraw\.com/i.test(url)) externalRequests.push(url);
  });
  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('/excalidraw/fonts/')) {
      const ct = res.headers()['content-type'] ?? '';
      if (res.status() !== 200 || ct.includes('text/html')) {
        badFontResponses.push(`${res.status()} ${ct} ${url}`);
      }
    }
  });

  await login(page, 'alice');

  // Opening a regular document must never download the lazy BoardEditor chunk.
  await newNote(page, `PlainDoc ${uniq()}`);
  expect(boardChunkRequests).toEqual([]);
  await goHome(page);

  await page.getByRole('button', { name: 'New whiteboard' }).first().click();
  await expect(page).toHaveURL(/\/n\/[A-Za-z0-9_-]+$/);

  const article = page.locator('article[data-note-kind="board"]');
  await expect(article).toBeVisible();
  const host = page.getByTestId('board-editor');
  await expect(host).toBeVisible();
  await expect(host).toHaveAttribute('data-board-ready', 'true', { timeout: 15000 });
  await expect(host.locator('canvas').first()).toBeVisible();
  expect(boardChunkRequests.length).toBeGreaterThan(0);

  // Set title and draw a rectangle on the canvas.
  const id = new URL(page.url()).pathname.split('/').pop()!;
  const boardTitle = `Architecture ${uniq()}`;
  const titleInput = article.getByRole('textbox', { name: 'Title' });
  await titleInput.fill(boardTitle);
  await waitSaved(page);

  // Select rectangle tool (key '2') and drag on the interactive canvas.
  const box = (await host.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.keyboard.press('2');
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.6, { steps: 6 });
  await page.mouse.up();
  await waitSaved(page);

  await expect
    .poll(async () => (await (await page.request.get(`/api/notes/${id}`)).json()).note.content.elements.length)
    .toBeGreaterThanOrEqual(1);

  // Also persist a labelled text element and reload to confirm round-trip and card preview.
  const existing = (await (await page.request.get(`/api/notes/${id}`)).json()).note.content;
  existing.elements.push({
    id: 'e2e_label_1',
    type: 'text',
    x: 120,
    y: 120,
    width: 140,
    height: 25,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 12345,
    version: 1,
    versionNonce: 54321,
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    text: 'DiagramLabel',
    fontSize: 20,
    fontFamily: 5,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    originalText: 'DiagramLabel',
    autoResize: true,
    lineHeight: 1.25,
  });
  expect((await page.request.patch(`/api/notes/${id}`, { data: { content: existing } })).status()).toBe(200);

  await page.reload();
  await expect(host).toHaveAttribute('data-board-ready', 'true', { timeout: 15000 });
  await expect(titleInput).toHaveValue(boardTitle);

  // Return home and verify Whiteboard icon tile + text preview.
  await article.getByRole('link', { name: 'Back to notes' }).click();
  await expect(page).toHaveURL(/\/$/);
  const card = page.locator(`article[data-note-id="${id}"]`);
  await expect(card).toBeVisible();
  await expect(card.getByLabel('Whiteboard')).toBeVisible();
  await expect(card).toContainText('DiagramLabel');

  // Reopen, lock read-only, and verify canvas edits do not modify saved content.
  await card.getByRole('link', { name: boardTitle }).click();
  await expect(host).toHaveAttribute('data-board-ready', 'true', { timeout: 15000 });
  await page.getByRole('button', { name: 'Make read-only' }).click();
  await page.getByRole('group', { name: 'Confirm read-only' }).getByRole('button', { name: 'Make read-only' }).click();
  await expect(page.getByTestId('read-only-indicator')).toBeVisible();
  await expect(titleInput).toHaveAttribute('readonly', '');

  const beforeLock = JSON.stringify((await (await page.request.get(`/api/notes/${id}`)).json()).note.content);
  const lockedBox = (await host.boundingBox())!;
  await page.keyboard.press('2');
  await page.mouse.move(lockedBox.x + lockedBox.width * 0.25, lockedBox.y + lockedBox.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(lockedBox.x + lockedBox.width * 0.4, lockedBox.y + lockedBox.height * 0.55, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const afterLock = JSON.stringify((await (await page.request.get(`/api/notes/${id}`)).json()).note.content);
  expect(afterLock).toBe(beforeLock);

  expect(externalRequests).toEqual([]);
  expect(badFontResponses).toEqual([]);
  expect(cspOrPageErrors).toEqual([]);
});
