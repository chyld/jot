// Type 8 (e2e): style buttons end-to-end flow — binding on /buttons, toolbar placement,
// stamping with underline (and no underline on mixed selection), hiding without reload,
// and unbinding when a custom style is deleted.
import { expect, test } from '@playwright/test';
import { body, goHome, login, newNote, selectLine, uniq, waitSaved } from './helpers';

const HUMAN_CLICK = { delay: 60 };

test('style buttons: bind, stamp with underline, hide, and unbind on style delete', async ({ page }) => {
  await login(page, 'alice');
  const nav = page.getByRole('navigation', { name: 'Main' });

  // Create a custom style on /styles first so we can bind it and delete it later.
  const customName = `BtnStyle ${uniq('s')}`;
  await nav.getByRole('link', { name: 'Styles' }).click();
  await expect(page.getByRole('heading', { name: 'Styles', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'New style' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Name').fill(customName);
  await dlg.getByLabel('Size (px)').fill('22');
  await dlg.getByRole('checkbox', { name: 'Bold' }).check();
  await dlg.getByRole('radio', { name: 'Text colour Crimson' }).click();
  await dlg.getByRole('button', { name: 'Save style' }).click();
  await expect(page.getByRole('article', { name: `Style ${customName}` })).toBeVisible();

  // Open /buttons from the left bar.
  await nav.getByRole('link', { name: 'Buttons' }).click();
  await expect(page).toHaveURL(/\/buttons$/);
  await expect(page.getByRole('heading', { name: 'Buttons', level: 1 })).toBeVisible();
  await expect(page.getByTestId('buttons-grid').getByRole('article')).toHaveCount(10);
  await expect(page.getByTestId('buttons-grid').getByRole('button', { name: /delete|trash/i })).toHaveCount(0);

  // Bind button 1 to Quote (default style) and button 3 to our custom style.
  const slot1 = page.getByTestId('button-slot-1');
  await slot1.getByRole('button', { name: /Bind a style to button 1|Button 1 style:/ }).click();
  await page.getByRole('menu', { name: 'Style for button 1' }).getByRole('menuitem', { name: 'Quote', exact: true }).click();
  await expect(slot1.getByRole('button', { name: 'Button 1 style: Quote' })).toBeVisible();

  const slot3 = page.getByTestId('button-slot-3');
  await slot3.getByRole('button', { name: /Bind a style to button 3|Button 3 style:/ }).click();
  await page.getByRole('menu', { name: 'Style for button 3' }).getByRole('menuitem', { name: customName, exact: true }).click();
  await expect(slot3.getByRole('button', { name: `Button 3 style: ${customName}` })).toBeVisible();

  // Create a note from the home page.
  await goHome(page);
  const noteUrl = await newNote(page, `Buttons test ${uniq('n')}`);

  // Confirm buttons 1 and 3 appear immediately after Link, in number order, with exact tooltips.
  const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
  const btn1 = toolbar.getByRole('button', { name: 'Style button 1: Quote' });
  const btn3 = toolbar.getByRole('button', { name: `Style button 3: ${customName}` });
  await expect(btn1).toBeVisible();
  await expect(btn3).toBeVisible();
  expect(await btn1.getAttribute('title')).toBe('Quote');
  expect(await btn3.getAttribute('title')).toBe(customName);
  const order = await toolbar.locator('button[aria-label], input[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  const linkIdx = order.indexOf('Link');
  expect(order.slice(linkIdx + 1, linkIdx + 4)).toEqual(['Style button 1: Quote', `Style button 3: ${customName}`, 'Heading']);

  // Write two lines, select the first and click button 1.
  await body(page).locator(':scope > p').last().click(HUMAN_CLICK);
  await page.keyboard.type('First styled line');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second plain line');
  await waitSaved(page);

  await body(page).locator('p', { hasText: 'First styled line' }).click(HUMAN_CLICK);
  await selectLine(page);
  await btn1.click();

  // Text takes Quote style and button 1 shows its underline (no filled background).
  const styledSpan = body(page).locator('p', { hasText: 'First styled line' }).locator('span[style*="Lora"]').first();
  await expect(styledSpan).toBeVisible();
  await expect(btn1).toHaveClass(/is-in-use/);
  await expect(btn1).toHaveAttribute('aria-pressed', 'true');
  await expect(btn3).not.toHaveClass(/is-in-use/);
  // Move pointer off the button so :hover does not paint the hover tint; active state has no filled background.
  await page.mouse.move(0, 0);
  const bg = await btn1.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgba(0, 0, 0, 0)');
  const bar = await btn1.locator('.style-chip').evaluate((el) => {
    const s = getComputedStyle(el, '::after');
    return { height: s.height, bg: s.backgroundColor };
  });
  expect(bar).toEqual({ height: '3px', bg: 'rgb(20, 20, 20)' });

  // Mixed selection across both paragraphs: NO button is underlined.
  await body(page).locator('p', { hasText: 'First styled line' }).click(HUMAN_CLICK);
  await page.keyboard.press('ControlOrMeta+a');
  await expect(btn1).not.toHaveClass(/is-in-use/);
  await expect(btn3).not.toHaveClass(/is-in-use/);

  // Hide button 1 on /buttons, navigate back to the note via SPA (no reload) -> button 1 leaves the toolbar.
  await nav.getByRole('link', { name: 'Buttons' }).click();
  await page.getByTestId('button-slot-1').getByRole('button', { name: 'Hide button 1' }).click();
  await expect(page.getByTestId('button-slot-1')).toHaveClass(/is-hidden/);
  await page.goBack();
  await expect(page).toHaveURL(noteUrl);
  await expect(toolbar.getByRole('button', { name: 'Style button 1: Quote' })).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: `Style button 3: ${customName}` })).toBeVisible();

  // Delete the custom style -> button 3 is unbound.
  await nav.getByRole('link', { name: 'Styles' }).click();
  const card = page.getByRole('article', { name: `Style ${customName}` });
  await card.getByRole('button', { name: 'Delete' }).click();
  await card.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(card).toHaveCount(0);

  await nav.getByRole('link', { name: 'Buttons' }).click();
  await expect(page.getByTestId('button-slot-3').getByRole('button', { name: 'Bind a style to button 3' })).toBeVisible();
  // Button 1 kept its Quote binding while hidden.
  await expect(page.getByTestId('button-slot-1').getByRole('button', { name: 'Button 1 style: Quote' })).toBeVisible();

  // Clean up slot 1 so alice stays clean for other specs.
  await page.getByTestId('button-slot-1').getByRole('button', { name: 'Show button 1' }).click();
  await page.getByTestId('button-slot-1').getByRole('button', { name: 'Button 1 style: Quote' }).click();
  await page.getByRole('menu', { name: 'Style for button 1' }).getByRole('menuitem', { name: 'No style' }).click();
  await expect(page.getByTestId('button-slot-1').getByRole('button', { name: 'Bind a style to button 1' })).toBeVisible();
});
