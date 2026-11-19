// Resize a photo and set its border size and colour.
import { expect, test } from '@playwright/test';
import { body, insertPhoto, login, newNote, typeInBody, waitSaved } from './helpers';

test('resize a photo and set its border', async ({ page }) => {
  await login(page, 'alice');
  await newNote(page, 'Photo border');
  await typeInBody(page, 'A photo follows');
  await page.keyboard.press('Enter');
  await insertPhoto(page);
  const img = body(page).locator('.jot-photo img');

  await img.click();
  const bar = page.getByRole('toolbar', { name: 'Photo' });
  await expect(bar).toBeVisible();

  // Resize with the width box...
  const width = bar.getByRole('textbox', { name: 'Photo width' });
  await width.fill('300');
  await width.press('Enter');
  await expect(img).toHaveCSS('width', '300px');

  // ...and by dragging the corner handle.
  const handle = body(page).locator('.jot-photo-handle[data-corner="bottom-right"]');
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(img).toHaveCSS('width', '360px');
  await expect(width).toHaveValue('360');

  // Border size and colour.
  await img.click();
  await bar.getByRole('combobox', { name: 'Border size' }).selectOption('5');
  await bar.getByRole('button', { name: 'Border colour Violet' }).click();
  await expect(img).toHaveCSS('border-top-width', '5px');
  await expect(img).toHaveCSS('border-top-color', 'rgb(133, 22, 243)'); // #8516F3
  await waitSaved(page);

  await page.reload();
  const again = body(page).locator('.jot-photo img');
  await expect(again).toHaveCSS('width', '360px');
  await expect(again).toHaveCSS('border-top-width', '5px');
  await expect(again).toHaveCSS('border-top-style', 'solid');
  await expect(again).toHaveCSS('border-top-color', 'rgb(133, 22, 243)');

  // Back to no border.
  await again.click();
  await page.getByRole('toolbar', { name: 'Photo' }).getByRole('combobox', { name: 'Border size' }).selectOption('0');
  await expect(again).toHaveCSS('border-top-width', '0px');
});
