import { deflateSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';

export const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e password 1';

/** A short unique word (letters only, so it is also a valid tag). */
export function uniq(prefix = 'w'): string {
  const n = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return (prefix + n.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)])).toLowerCase();
}

export async function login(page: Page, username: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

/** Log out lives on the Account page (the person icon at the bottom of the left bar). */
export async function logout(page: Page) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Account' }).click();
  await page.getByRole('button', { name: /^Log out/ }).click();
}

export async function newNote(page: Page, title: string) {
  const before = page.url();
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page).toHaveURL(/\/n\/[A-Za-z0-9_-]+$/);
  await expect(page).not.toHaveURL(before);
  // Wait for this note's own editor (the previous note may still be on screen for a moment).
  const id = new URL(page.url()).pathname.split('/').pop()!;
  const t = page.locator(`article[data-note-id="${id}"]`).getByRole('textbox', { name: 'Title' });
  await t.fill(title);
  await waitSaved(page);
  return page.url();
}

/** The Jot logo at the top of the left bar goes to the home page (the notes list). */
export async function goHome(page: Page) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Jot home/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('notes-list')).toBeVisible();
}

export async function waitSaved(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 20_000 });
}

export const body = (page: Page) => page.locator('.note-body');

/** Types into the note body at the end. */
// Clicks into the editor like a person does (button held briefly). With Playwright's
// zero-length clicks ProseMirror can see the keys that follow before it has read
// the new caret position from the browser.
const HUMAN_CLICK = { delay: 60 };

export async function typeInBody(page: Page, text: string) {
  await body(page).locator(':scope > p').last().click(HUMAN_CLICK);
  await page.keyboard.press('End');
  await page.keyboard.type(text);
}

/** Selects the whole line the caret is on. */
export async function selectLine(page: Page) {
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
}

/** Puts the caret in the paragraph containing `text` and selects that paragraph. */
export async function selectParagraph(page: Page, text: string) {
  await body(page).locator('p', { hasText: text }).first().click(HUMAN_CLICK);
  await selectLine(page);
}

export async function openMenu(page: Page, name: string) {
  await page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name, exact: true }).click();
  return page.getByRole('menu', { name });
}

/** A real PNG (solid colour), so photos have a realistic size on screen. */
export function makePng(width: number, height: number, rgb: [number, number, number] = [255, 107, 87]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: width }, () => Buffer.from(rgb)))]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export const PNG = makePng(200, 150);

export async function insertPhoto(page: Page) {
  const chooser = page.waitForEvent('filechooser');
  const menu = await openMenu(page, 'Insert');
  await menu.getByRole('menuitem', { name: 'Image' }).click();
  await (await chooser).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  await expect(body(page).locator('.jot-photo img')).toHaveCount(1);
}
