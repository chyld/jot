// Regression for "cannot add more than one tag / cannot remove a tag": several tags are
// added to one note one after another, one is removed, and the result survives a reload.
// The tags are entered twice over: with real keystrokes, and by setting the field's value
// directly the way browser autofill, input methods, extensions and automation tools do
// (which React's onChange never sees).
import { expect, test, type Page } from '@playwright/test';
import { login, newNote, typeInBody, waitSaved } from './helpers';

type Entry = (page: Page, tag: string) => Promise<void>;

const typed: Entry = async (page, tag) => {
  const input = page.getByRole('textbox', { name: 'Add tag' });
  await input.click();
  await input.pressSequentially(tag);
  await input.press('Enter');
};

const setDirectly: Entry = async (page, tag) => {
  const input = page.getByRole('textbox', { name: 'Add tag' });
  await input.click();
  await input.evaluate((el: HTMLInputElement, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, tag);
  await input.press('Enter');
};

for (const [how, enter] of [
  ['typed', typed],
  ['set directly', setDirectly],
] as const) {
  test(`add three tags one after another, remove one, reload (${how})`, async ({ page }) => {
    await login(page, 'alice');
    const url = await newNote(page, `Three tags ${how}`);
    await typeInBody(page, 'A note with several tags');
    await waitSaved(page);

    const tags = page.getByRole('list', { name: 'Tags' });
    for (const t of ['alpha', 'beta', 'gamma']) {
      await enter(page, t);
      await expect(tags.getByText(`#${t}`, { exact: true })).toBeVisible();
    }
    await expect(tags.getByRole('listitem')).toHaveCount(3);

    await page.getByRole('button', { name: 'Remove tag beta' }).click();
    await expect(tags.getByText('#beta', { exact: true })).toHaveCount(0);
    await expect(tags.getByRole('listitem')).toHaveCount(2);

    await page.reload();
    await expect(page).toHaveURL(url);
    const after = page.getByRole('list', { name: 'Tags' });
    await expect(after.getByRole('listitem')).toHaveCount(2);
    await expect(after.getByText('#alpha', { exact: true })).toBeVisible();
    await expect(after.getByText('#gamma', { exact: true })).toBeVisible();
    await expect(after.getByText('#beta', { exact: true })).toHaveCount(0);
  });
}
