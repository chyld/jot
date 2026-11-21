// Sections (sections-spec.md §10): create "Work" and "Recipes"; a note made in Work is not
// on the Recipes home page, in its search or in its trash; each section's trash opens from
// its card on the Sections page; switching changes the colours; a reload stays in the same
// section; move a note and follow it; delete a section and find its notes and trash in Default.
import { expect, test, type Page } from '@playwright/test';
import { goHome, login, newNote, openTrash, typeInBody, uniq, waitSaved } from './helpers';

const BLUE = 'rgb(29, 78, 216)'; // #1d4ed8
const AMBER = 'rgb(180, 83, 9)'; // #b45309

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const newButton = (page: Page) => nav(page).getByRole('button', { name: 'New note' });

async function createSection(page: Page, name: string, id: string, colour: string) {
  await page.getByRole('button', { name: 'New section' }).click();
  const dialog = page.getByRole('dialog', { name: 'New section' });
  await expect(dialog).toContainText('cannot be changed later');
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('ID').fill(id);
  await dialog.getByRole('radio', { name: colour }).click();
  await dialog.getByRole('button', { name: 'Create section' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('listitem', { name })).toContainText(`ID: ${id}`);
}

async function openSections(page: Page) {
  await nav(page).getByRole('link', { name: /^Sections \(current: / }).click();
  await expect(page).toHaveURL(/\/sections$/);
  await expect(page.getByRole('heading', { name: 'Sections', level: 1 })).toBeVisible();
}

/** Switching section is done with Open on the section's card on the Sections page. */
async function switchTo(page: Page, name: string) {
  await openSections(page);
  await page.getByRole('listitem', { name }).getByRole('button', { name: `Open ${name}` }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

async function searchFor(page: Page, word: string) {
  await page.getByLabel('Search notes').fill(word);
  await page.waitForTimeout(400); // the search waits for typing to stop
}

test('sections keep their notes, search and trash apart; colours, reload and moving a note', async ({ page }) => {
  const w = uniq('s');
  const work = `Work ${w}`;
  const recipes = `Recipes ${w}`;
  await login(page, 'alice');
  await expect(page.getByRole('heading', { name: 'Default', level: 1 })).toBeVisible();

  // Create the two sections on the Sections page.
  // The left bar's square is a link to the Sections page, marked active there.
  const sectionLink = nav(page).getByRole('link', { name: 'Sections (current: Default)' });
  await expect(sectionLink).toHaveText('D');
  await sectionLink.click();
  await expect(page).toHaveURL(/\/sections$/);
  await expect(page.getByRole('heading', { name: 'Sections', level: 1 })).toBeVisible();
  await expect(sectionLink).toHaveAttribute('aria-current', 'page');
  await createSection(page, work, `work${w}`, 'Blue');
  await createSection(page, recipes, `recipe${w}`, 'Amber');
  // Every card's buttons fit on one line, the current section's too.
  for (const name of ['Default', work, recipes]) {
    const tops = await page.getByRole('listitem', { name, exact: true }).getByRole('button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    expect(new Set(tops).size).toBe(1);
  }
  await page.screenshot({ path: 'test-results/screens/sections.png' });

  // A note in Work, and one in Work's trash.
  await switchTo(page, work);
  await expect(newButton(page)).toHaveCSS('background-color', BLUE);
  await newNote(page, `Plan ${w}`);
  await typeInBody(page, `budget ${w}`);
  await waitSaved(page);
  await newNote(page, `Binned ${w}`);
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('notes-list')).toContainText(`Plan ${w}`);

  // Recipes sees none of it, in the list, its search or its trash; and is amber.
  await switchTo(page, recipes);
  await expect(newButton(page)).toHaveCSS('background-color', AMBER);
  await expect(page.getByTestId('notes-list')).not.toContainText(`Plan ${w}`);
  await searchFor(page, w);
  await expect(page.getByTestId('notes-list')).toContainText('No notes match.');

  // Each card on the Sections page has a Trash button with its count; the left bar has no Trash.
  await expect(nav(page).getByRole('link', { name: 'Trash' })).toHaveCount(0);
  await openSections(page);
  const recipesTrash = page.getByRole('listitem', { name: recipes }).getByRole('button', { name: /^Trash of / });
  await expect(recipesTrash).toHaveText('Trash 0');
  await recipesTrash.click();
  await expect(page).toHaveURL(/\/trash$/);
  await expect(page.getByRole('heading', { name: `Trash — ${recipes}`, level: 1 })).toBeVisible();
  await expect(page.getByText('The trash is empty.')).toBeVisible();

  // Work's card opens Work's trash, which has the binned note, and makes Work current.
  await openSections(page);
  const workTrash = page.getByRole('listitem', { name: work }).getByRole('button', { name: /^Trash of / });
  await expect(workTrash).toHaveText('Trash 1');
  await page.screenshot({ path: 'test-results/screens/sections-trash.png' });
  await workTrash.click();
  await expect(page.getByRole('heading', { name: `Trash — ${work}`, level: 1 })).toBeVisible();
  await expect(page.getByRole('listitem', { name: `Binned ${w}` })).toBeVisible();
  await expect(newButton(page)).toHaveCSS('background-color', BLUE);

  // Back in Work: its search has the note.
  await goHome(page);
  await expect(page.getByRole('heading', { name: work, level: 1 })).toBeVisible();
  await searchFor(page, w);
  await expect(page.getByTestId('notes-list')).toContainText(`Plan ${w}`);

  // A reload stays in the same section, with its colours.
  await goHome(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: work, level: 1 })).toBeVisible();
  await expect(newButton(page)).toHaveCSS('background-color', BLUE);

  // Move the note to Recipes: the app follows it there.
  await page.getByTestId('notes-list').getByRole('link', { name: `Plan ${w}`, exact: true }).click();
  const sectionButton = page.locator('.note-header').getByRole('button', { name: `Section: ${work}` });
  await sectionButton.click();
  await page.screenshot({ path: 'test-results/screens/note-section.png' });
  await page.getByRole('menuitem', { name: `Move to ${recipes}` }).click();
  await expect(page.locator('.note-header').getByRole('button', { name: `Section: ${recipes}` })).toBeVisible();
  await expect(newButton(page)).toHaveCSS('background-color', AMBER);
  await goHome(page);
  await expect(page.getByRole('heading', { name: recipes, level: 1 })).toBeVisible();
  await expect(page.getByTestId('notes-list')).toContainText(`Plan ${w}`);
  await switchTo(page, work);
  await expect(page.getByTestId('notes-list')).not.toContainText(`Plan ${w}`);
});

test('deleting a section moves its notes to Default and its trashed notes to Default’s trash', async ({ page }) => {
  const w = uniq('d');
  const old = `Old ${w}`;
  await login(page, 'alice');
  await openSections(page);
  await createSection(page, old, `old${w}`, 'Teal');
  await switchTo(page, old);
  await newNote(page, `Kept ${w}`);
  await typeInBody(page, `words ${w}`);
  await waitSaved(page);
  await newNote(page, `Binned ${w}`);
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await expect(page).toHaveURL(/\/$/);

  // The current section's card has a "Current" tag and no Open.
  await openSections(page);
  const card = page.getByRole('listitem', { name: old });
  await expect(card.getByText('Current', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: `Open ${old}` })).toHaveCount(0);

  // Delete it from its Edit dialog, with a confirm step that says what happens.
  await card.getByRole('button', { name: `Edit ${old}` }).click();
  const dialog = page.getByRole('dialog', { name: `Edit ${old}` });
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toContainText(`Delete ${old}? Its 1 note and 1 trashed note move to Default.`);
  await dialog.getByRole('button', { name: 'Delete section' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('listitem', { name: old })).toHaveCount(0);
  // It was current, so Default is now.
  await expect(page.getByRole('listitem', { name: 'Default', exact: true }).getByText('Current', { exact: true })).toBeVisible();

  await goHome(page);
  await expect(page.getByRole('heading', { name: 'Default', level: 1 })).toBeVisible();
  await expect(page.getByTestId('notes-list')).toContainText(`Kept ${w}`);
  await openTrash(page);
  await expect(page.getByRole('heading', { name: 'Trash — Default', level: 1 })).toBeVisible();
  await expect(page.getByRole('listitem', { name: `Binned ${w}` })).toBeVisible();
});
