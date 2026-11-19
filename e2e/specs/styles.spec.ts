// Create a style and apply it; edit the style and confirm the old text is unchanged;
// reapply and confirm it updates. Also: save a selection as a style.
import { expect, test } from '@playwright/test';
import { body, login, newNote, openMenu, selectParagraph, typeInBody, uniq, waitSaved } from './helpers';

const CRIMSON = 'rgb(224, 6, 49)';
const JADE = 'rgb(8, 145, 99)';

test('a style is a stamp', async ({ page }) => {
  await login(page, 'alice');
  const nav = page.getByRole('navigation', { name: 'Main' });
  const name = `Stamp ${uniq()}`;

  await nav.getByRole('link', { name: 'Styles' }).click();
  await page.getByRole('button', { name: 'New style' }).click();
  let dialog = page.getByRole('dialog', { name: 'New style' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Font').selectOption({ label: 'Lora' });
  await dialog.getByLabel('Size (px)').fill('22');
  await dialog.getByLabel('Bold').check();
  await dialog.getByRole('radio', { name: 'Text colour Crimson' }).click();
  await dialog.getByRole('button', { name: 'Save style' }).click();
  const card = page.getByRole('article', { name: `Style ${name}` });
  await expect(card).toContainText('Lora');
  await expect(card).toContainText('22 px');
  await expect(card).toContainText('Bold');
  await expect(card).toContainText('Crimson');

  const url = await newNote(page, 'Stamp test');
  await typeInBody(page, 'Stamped once');
  await selectParagraph(page, 'Stamped once');
  await (await openMenu(page, 'Styles')).getByRole('menuitem', { name }).click();
  const first = body(page).getByText('Stamped once', { exact: true });
  await expect(first).toHaveCSS('font-size', '22px');
  await expect(first).toHaveCSS('color', CRIMSON);
  await expect(first).toHaveCSS('font-family', /Lora/);
  await expect(first).toHaveCSS('font-weight', '700');
  await expect(page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Styles' })).toHaveText(name);
  await waitSaved(page);

  // Edit the style.
  await nav.getByRole('link', { name: 'Styles' }).click();
  await page.getByRole('article', { name: `Style ${name}` }).getByRole('button', { name: 'Edit' }).click();
  dialog = page.getByRole('dialog', { name: 'Edit style' });
  await dialog.getByLabel('Size (px)').fill('30');
  await dialog.getByRole('radio', { name: 'Text colour Jade' }).click();
  await dialog.getByRole('button', { name: 'Save style' }).click();
  await expect(page.getByRole('article', { name: `Style ${name}` })).toContainText('30 px');

  // The old text is unchanged.
  await page.goto(url);
  const again = body(page).getByText('Stamped once', { exact: true });
  await expect(again).toHaveCSS('font-size', '22px');
  await expect(again).toHaveCSS('color', CRIMSON);

  // Reapplying updates it.
  await selectParagraph(page, 'Stamped once');
  await (await openMenu(page, 'Styles')).getByRole('menuitem', { name }).click();
  await expect(again).toHaveCSS('font-size', '30px');
  await expect(again).toHaveCSS('color', JADE);
  await waitSaved(page);
  await page.reload();
  await expect(body(page).getByText('Stamped once', { exact: true })).toHaveCSS('font-size', '30px');

  // Save the current selection as a new style.
  await selectParagraph(page, 'Stamped once');
  await (await openMenu(page, 'Styles')).getByRole('menuitem', { name: 'Save selection as style…' }).click();
  const saveDialog = page.getByRole('dialog', { name: 'Save selection as style' });
  await expect(saveDialog.getByLabel('Size (px)')).toHaveValue('30');
  await expect(saveDialog.getByLabel('Bold')).toBeChecked();
  await expect(saveDialog.getByRole('radio', { name: 'Text colour Jade' })).toHaveAttribute('aria-checked', 'true');
  const copyName = `Copy ${uniq()}`;
  await saveDialog.getByLabel('Name').fill(copyName);
  await saveDialog.getByRole('button', { name: 'Save style' }).click();
  await expect(saveDialog).toHaveCount(0);
  const menu = await openMenu(page, 'Styles');
  await expect(menu.getByRole('menuitem', { name: copyName })).toBeVisible();
});
