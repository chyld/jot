// Sections (sections-spec.md §10): create "Work" and "Recipes"; a note made in Work is not
// on the Recipes home page, in its search or in its trash; switching changes the colours;
// a reload stays in the same section; move a note and follow it.
import { expect, test, type Page } from '@playwright/test';
import { goHome, login, newNote, typeInBody, uniq, waitSaved } from './helpers';

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

async function switchTo(page: Page, name: string) {
  await nav(page).getByRole('button', { name: /^Section: / }).click();
  await page.getByRole('menu').getByRole('menuitem', { name }).click();
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
  await nav(page).getByRole('button', { name: 'Section: Default' }).click();
  await page.getByRole('menuitem', { name: 'Manage sections' }).click();
  await expect(page.getByRole('heading', { name: 'Sections', level: 1 })).toBeVisible();
  await createSection(page, work, `work${w}`, 'Blue');
  await createSection(page, recipes, `recipe${w}`, 'Amber');
  await nav(page).getByRole('button', { name: 'Section: Default' }).click();
  await page.screenshot({ path: 'test-results/screens/section-menu.png' });
  await page.keyboard.press('Escape');
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
  await nav(page).getByRole('link', { name: 'Trash' }).click();
  await expect(page.getByRole('heading', { name: 'Trash', level: 1 })).toBeVisible();
  await expect(page.getByText('The trash is empty.')).toBeVisible();

  // Back in Work: its search and its trash have them.
  await switchTo(page, work);
  await searchFor(page, w);
  await expect(page.getByTestId('notes-list')).toContainText(`Plan ${w}`);
  await nav(page).getByRole('link', { name: 'Trash' }).click();
  await expect(page.getByRole('listitem', { name: `Binned ${w}` })).toBeVisible();

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
