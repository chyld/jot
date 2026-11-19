// Photo resize handles: four visible corner handles that stay on the corners with any
// border, and dragging a corner resizes the photo (aspect ratio kept, 40-4000 px),
// keeps the width box in sync, and saves the width.
import { expect, test, type Page } from '@playwright/test';
import { body, insertPhoto, login, newNote, typeInBody, waitSaved } from './helpers';

const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

async function drag(page: Page, corner: string, dx: number, dy: number) {
  const handle = body(page).locator(`.jot-photo-handle[data-corner="${corner}"]`);
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

async function handlesSitOnCorners(page: Page) {
  const img = (await body(page).locator('.jot-photo img').boundingBox())!;
  const expected: Record<string, [number, number]> = {
    'top-left': [img.x, img.y],
    'top-right': [img.x + img.width, img.y],
    'bottom-left': [img.x, img.y + img.height],
    'bottom-right': [img.x + img.width, img.y + img.height],
  };
  for (const corner of CORNERS) {
    const handle = body(page).locator(`.jot-photo-handle[data-corner="${corner}"]`);
    await expect(handle).toBeVisible();
    const b = (await handle.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(12); // clearly visible
    expect(Math.abs(b.x + b.width / 2 - expected[corner][0]), corner).toBeLessThanOrEqual(1.5);
    expect(Math.abs(b.y + b.height / 2 - expected[corner][1]), corner).toBeLessThanOrEqual(1.5);
  }
}

test('four corner handles resize the photo and the width is saved', async ({ page }) => {
  await login(page, 'alice');
  const url = await newNote(page, 'Photo handles');
  await typeInBody(page, 'Resize me');
  await page.keyboard.press('Enter');
  await insertPhoto(page); // a 200 x 150 photo
  const img = body(page).locator('.jot-photo img');
  await img.click();
  const bar = page.getByRole('toolbar', { name: 'Photo' });
  const widthBox = bar.getByRole('textbox', { name: 'Photo width' });

  // All four handles, on the corners, with the right cursors and accent colour.
  await handlesSitOnCorners(page);
  for (const [corner, cursor] of [
    ['top-left', 'nwse-resize'],
    ['bottom-right', 'nwse-resize'],
    ['top-right', 'nesw-resize'],
    ['bottom-left', 'nesw-resize'],
  ]) {
    const h = body(page).locator(`.jot-photo-handle[data-corner="${corner}"]`);
    await expect(h).toHaveCSS('cursor', cursor);
    await expect(h).toHaveCSS('background-color', 'rgb(77, 124, 15)'); // accent #4d7c0f
    await expect(h).toHaveCSS('border-top-color', 'rgb(255, 255, 255)');
  }

  // Still on the corners with the thickest border.
  await bar.getByRole('combobox', { name: 'Border size' }).selectOption('10');
  await expect(img).toHaveCSS('border-top-width', '10px');
  await handlesSitOnCorners(page);
  await page.screenshot({ path: 'test-results/screens/photo-handles.png', clip: { x: 64, y: 100, width: 700, height: 400 } });

  // Start from a known width (the stored width is the outer width, border included).
  await widthBox.fill('200');
  await widthBox.press('Enter');
  await expect(img).toHaveCSS('width', '200px');
  await img.click();

  // Drag the top-left corner outwards: wider, same proportions.
  await drag(page, 'top-left', -100, 0);
  await expect(img).toHaveCSS('width', '300px');
  await expect(widthBox).toHaveValue('300');
  const ratio = async () =>
    img.evaluate((el: HTMLImageElement) => {
      const r = el.getBoundingClientRect();
      const b = parseFloat(getComputedStyle(el).borderTopWidth) * 2;
      return (r.width - b) / (r.height - b) / (el.naturalWidth / el.naturalHeight);
    });
  expect(await ratio()).toBeCloseTo(1, 2);
  await handlesSitOnCorners(page);

  // Drag the bottom-left corner downwards: grows by the aspect ratio of the outer box.
  const box = (await img.boundingBox())!;
  const expected = Math.round(box.width + 30 * (box.width / box.height));
  await drag(page, 'bottom-left', 0, 30);
  await expect(widthBox).toHaveValue(String(expected));
  await expect(img).toHaveCSS('width', `${expected}px`);
  expect(await ratio()).toBeCloseTo(1, 2);

  // The lower limit holds.
  await drag(page, 'bottom-right', -1000, 0);
  await expect(img).toHaveCSS('width', '40px');
  await expect(widthBox).toHaveValue('40');

  // Final size, saved and reloaded.
  await img.click();
  await drag(page, 'top-right', 220, 0);
  await expect(widthBox).toHaveValue('260');
  await waitSaved(page);
  await page.reload();
  await expect(page).toHaveURL(url);
  const again = body(page).locator('.jot-photo img');
  await expect(again).toHaveCSS('width', '260px');
  await again.click();
  await expect(page.getByRole('toolbar', { name: 'Photo' }).getByRole('textbox', { name: 'Photo width' })).toHaveValue('260');
});
