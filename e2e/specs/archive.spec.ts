// Archive a font: notes and styles that use it still render, and it is gone from the pickers.
import { expect, test } from '@playwright/test';
import { body, login, newNote, openMenu, selectParagraph, typeInBody, uniq, waitSaved } from './helpers';

test('an archived font keeps working but leaves the pickers', async ({ page }) => {
  await login(page, 'alice');
  const nav = page.getByRole('navigation', { name: 'Main' });

  // Add Bebas Neue and build a style on it.
  await nav.getByRole('link', { name: 'Fonts' }).click();
  await page.getByRole('searchbox', { name: 'Search fonts' }).fill('Bebas Neue');
  const card = page.getByRole('article', { name: 'Bebas Neue', exact: true });
  await card.getByRole('button', { name: 'Add' }).click({ timeout: 30_000 });
  await expect(card.getByRole('button', { name: 'Archive' })).toBeVisible({ timeout: 60_000 });

  const styleName = `Poster ${uniq()}`;
  await nav.getByRole('link', { name: 'Styles' }).click();
  await page.getByRole('button', { name: 'New style' }).click();
  const dialog = page.getByRole('dialog', { name: 'New style' });
  await dialog.getByLabel('Name').fill(styleName);
  await dialog.getByLabel('Font').selectOption({ label: 'Bebas Neue' });
  await dialog.getByLabel('Size (px)').fill('30');
  await dialog.getByRole('button', { name: 'Save style' }).click();
  await expect(page.getByRole('article', { name: `Style ${styleName}` })).toBeVisible();

  // A note with text in that font (applied through the style).
  const url = await newNote(page, 'Poster note');
  await typeInBody(page, 'Open tonight');
  await selectParagraph(page, 'Open tonight');
  await (await openMenu(page, 'Styles')).getByRole('menuitem', { name: styleName }).click();
  await expect(body(page).getByText('Open tonight', { exact: true })).toHaveCSS('font-family', /Bebas Neue/);
  await waitSaved(page);

  // Archive it.
  await nav.getByRole('link', { name: 'Fonts' }).click();
  await page.getByRole('button', { name: 'Archive Bebas Neue' }).click();
  await expect(page.getByRole('list', { name: 'Archived fonts' }).getByText('Bebas Neue')).toBeVisible();

  // The note still renders in it, from Jot's copy.
  await page.goto(url);
  const span = body(page).getByText('Open tonight', { exact: true });
  await expect(span).toHaveCSS('font-family', /Bebas Neue/);
  expect(
    await page.evaluate(async () => {
      await document.fonts.load('30px "Bebas Neue"', 'Open');
      return document.fonts.check('30px "Bebas Neue"', 'Open');
    }),
  ).toBe(true);

  // Gone from the font picker...
  const fontMenu = await openMenu(page, 'Font');
  await expect(fontMenu.getByRole('menuitem', { name: 'Inter' })).toBeVisible();
  await expect(fontMenu.getByRole('menuitem', { name: 'Bebas Neue' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // ...but the style that uses it still applies it.
  await typeInBody(page, '\nSecond line');
  await selectParagraph(page, 'Second line');
  await (await openMenu(page, 'Styles')).getByRole('menuitem', { name: styleName }).click();
  await expect(body(page).getByText('Second line', { exact: true })).toHaveCSS('font-family', /Bebas Neue/);
  await waitSaved(page);

  // The style card still shows it; a new style cannot pick it.
  await nav.getByRole('link', { name: 'Styles' }).click();
  const styleCard = page.getByRole('article', { name: `Style ${styleName}` });
  await expect(styleCard.getByText('Bebas Neue (archived)')).toBeVisible();
  await expect(styleCard.locator('.style-card-name span')).toHaveCSS('font-family', /Bebas Neue/);
  await page.getByRole('button', { name: 'New style' }).click();
  const fontSelect = page.getByRole('dialog', { name: 'New style' }).getByLabel('Font');
  await expect(fontSelect.locator('option', { hasText: 'Inter' })).toHaveCount(1);
  await expect(fontSelect.locator('option', { hasText: 'Bebas Neue' })).toHaveCount(0);
});
