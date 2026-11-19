// The home page is the notes list (search, New, tag filter) with no editor beside it;
// the logo goes home; an open note fills the screen; the UI uses the Olive theme.
import { expect, test, type Page } from '@playwright/test';
import { body, goHome, login, newNote, openMenu, typeInBody, uniq, waitSaved } from './helpers';

test('home page, tag filter, logo and full-screen editor', async ({ page }) => {
  await login(page, 'alice');
  const red = uniq('red');
  const blue = uniq('blue');
  const tagged = async (title: string, tag: string) => {
    await newNote(page, title);
    const input = page.getByRole('textbox', { name: 'Add tag' });
    await input.fill(tag);
    await input.press('Enter');
    await expect(page.getByRole('list', { name: 'Tags' }).getByText(`#${tag}`)).toBeVisible();
  };
  await tagged(`Red note ${red}`, red);
  await tagged(`Blue note ${blue}`, blue);

  // The open note fills the screen: title, tags, toolbar and page, no notes list.
  await expect(page.getByRole('textbox', { name: 'Title' })).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();
  await expect(page.getByTestId('notes-list')).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'Search notes' })).toHaveCount(0);
  const pane = (await page.locator('.note-pane').boundingBox())!;
  const rail = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.round(pane.x)).toBe(Math.round(rail.width));
  expect(Math.round(pane.width)).toBe(viewport.width - Math.round(rail.width));

  // The left bar: logo, new note, then fonts, styles, backup, trash and log out. No notes or tags icon.
  const nav = page.getByRole('navigation', { name: 'Main' });
  const controls = await nav.locator('a, button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(controls).toEqual(['Jot home: all notes', 'New note', 'Inbox', 'Tags', 'Fonts', 'Styles', 'Account', 'Trash', 'Log out alice']);
  await goHome(page);

  // Home: search, New, tag filter and the list, no editor.
  await expect(page.getByRole('searchbox', { name: 'Search notes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible();
  await expect(page.locator('.note-body')).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(0);
  const list = page.getByTestId('notes-list');
  const filter = page.getByRole('group', { name: 'Filter by tag' });
  await expect(list.getByText(`Red note ${red}`)).toBeVisible();
  await expect(list.getByText(`Blue note ${blue}`)).toBeVisible();

  await filter.getByRole('button', { name: `#${red}` }).click();
  await expect(filter.getByRole('button', { name: `#${red}` })).toHaveAttribute('aria-pressed', 'true');
  await expect(list.getByText(`Red note ${red}`)).toBeVisible();
  await expect(list.getByText(`Blue note ${blue}`)).toHaveCount(0);

  await filter.getByRole('button', { name: 'All' }).click();
  await expect(list.getByText(`Blue note ${blue}`)).toBeVisible();
  await expect(list.getByText(`Red note ${red}`)).toBeVisible();

  // A tag is a chip only while a non-trashed note uses it.
  await list.getByText(`Blue note ${blue}`).click();
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(filter.getByRole('button', { name: `#${red}` })).toBeVisible();
  await expect(filter.getByRole('button', { name: `#${blue}` })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Trash' }).click();
  await page.getByRole('listitem', { name: `Blue note ${blue}` }).getByRole('button', { name: 'Restore' }).click();
  await goHome(page);
  await expect(filter.getByRole('button', { name: `#${blue}` })).toBeVisible();

  // The New button on the home page opens a fresh note full screen.
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page).toHaveURL(/\/n\/[A-Za-z0-9_-]+$/);
  await typeInBody(page, 'From the home page');
  await waitSaved(page);
  await expect(body(page)).toContainText('From the home page');

  // Opening a note from the list.
  await goHome(page);
  await list.getByText(`Red note ${red}`).click();
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(`Red note ${red}`);
});

/** Visible chrome elements (not note content) whose colours are pink, rose or magenta. */
async function pinkInChrome(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hue = (c: string): { h: number; s: number; a: number } | null => {
      const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/.exec(c);
      if (!m) return null;
      const [r, g, b] = [m[1], m[2], m[3]].map((x) => Number(x) / 255);
      const a = m[4] === undefined ? 1 : Number(m[4]);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      const l = (max + min) / 2;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      let h = 0;
      if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
      return { h: (h + 360) % 360, s, a };
    };
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (el.closest('.note-body') || !(el as HTMLElement).offsetParent && getComputedStyle(el).position !== 'fixed') continue;
      const cs = getComputedStyle(el);
      for (const prop of ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'outline-color']) {
        const v = hue(cs.getPropertyValue(prop));
        if (v && v.a > 0 && v.s > 0.15 && v.h >= 290 && v.h < 355) bad.push(`${el.tagName}.${el.className} ${prop} ${cs.getPropertyValue(prop)}`);
      }
    }
    return bad;
  });
}

test('the Olive theme', async ({ page }) => {
  await login(page, 'alice');
  const nav = page.getByRole('navigation', { name: 'Main' });
  const railLink = nav.getByRole('link', { name: 'Fonts' }); // any left bar link

  // Left bar: white, with a right border.
  await expect(nav).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(nav).toHaveCSS('border-right-width', '1px');
  await expect(nav).toHaveCSS('border-right-color', 'rgb(224, 232, 205)'); // #e0e8cd
  await expect(railLink).toHaveCSS('color', 'rgb(107, 117, 87)'); // #6b7557
  await railLink.hover();
  await expect(railLink).toHaveCSS('background-color', 'rgb(238, 245, 220)'); // hover tint #eef5dc
  const newNoteBtn = nav.getByRole('button', { name: 'New note' });
  await expect(newNoteBtn).toHaveCSS('background-color', 'rgb(77, 124, 15)'); // #4d7c0f
  await expect(newNoteBtn).toHaveCSS('color', 'rgb(255, 255, 255)');
  const logo = nav.getByRole('link', { name: /Jot home/ });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveCSS('background-color', 'rgb(228, 242, 196)'); // on home: active #e4f2c4
  await expect(logo).toHaveCSS('color', 'rgb(63, 98, 18)'); // #3f6212

  // App colours.
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(247, 249, 241)'); // #f7f9f1
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(29, 38, 16)'); // #1d2610
  const newBtn = page.getByRole('button', { name: 'New', exact: true });
  await expect(newBtn).toHaveCSS('background-color', 'rgb(77, 124, 15)');
  await expect(newBtn).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(page.getByRole('searchbox', { name: 'Search notes' }).locator('..')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByRole('searchbox', { name: 'Search notes' }).locator('..')).toHaveCSS('border-top-color', 'rgb(224, 232, 205)');
  const all = page.getByRole('group', { name: 'Filter by tag' }).getByRole('button', { name: 'All' });
  await expect(all).toHaveCSS('background-color', 'rgb(77, 124, 15)'); // selected filter chip
  await expect(all).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.mouse.move(700, 500);
  expect(await pinkInChrome(page)).toEqual([]);

  // Active left bar item; the logo is the accent when not on the home page.
  await railLink.click();
  await page.mouse.move(700, 500);
  await expect(railLink).toHaveCSS('background-color', 'rgb(228, 242, 196)'); // #e4f2c4
  await expect(railLink).toHaveCSS('color', 'rgb(63, 98, 18)'); // #3f6212
  await expect(logo).toHaveCSS('color', 'rgb(77, 124, 15)');
  await expect(page.getByRole('heading', { name: 'Fonts', level: 1 })).toBeVisible();
  expect(await pinkInChrome(page)).toEqual([]);
  // The Account page too.
  const backupLink = nav.getByRole('link', { name: 'Account' });
  await backupLink.click();
  await page.mouse.move(700, 500);
  await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible();
  await expect(page.getByTestId('account-username')).toHaveText('alice');
  await expect(backupLink).toHaveCSS('background-color', 'rgb(228, 242, 196)');
  await expect(page.getByRole('button', { name: 'Back up my data' })).toHaveCSS('background-color', 'rgb(77, 124, 15)');
  await expect(page.locator('.backup-section')).toHaveCount(4); // three backup parts and Bots
  expect(await pinkInChrome(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/screens/account-olive.png' });

  // Editor toolbar: pale, with a bottom border.
  await newNote(page, 'Theme check');
  const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
  await expect(toolbar).toHaveCSS('background-color', 'rgb(238, 245, 220)'); // #eef5dc
  await expect(toolbar).toHaveCSS('color', 'rgb(50, 71, 15)'); // #32470f
  await expect(toolbar).toHaveCSS('border-bottom-width', '1px');
  await expect(toolbar).toHaveCSS('border-bottom-color', 'rgb(224, 232, 205)');
  await expect(toolbar.locator('.tb-sep').first()).toHaveCSS('background-color', 'rgb(224, 232, 205)');
  const bold = toolbar.getByRole('button', { name: 'Bold' });
  await expect(bold).toHaveCSS('color', 'rgb(50, 71, 15)');
  await bold.hover();
  await expect(bold).toHaveCSS('background-color', 'rgb(228, 242, 196)'); // hover (#eef5dc would vanish on the toolbar)
  await typeInBody(page, 'pressed');
  await page.keyboard.press('Shift+Home');
  await bold.click();
  await page.mouse.move(700, 600);
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await expect(bold).toHaveCSS('background-color', 'rgb(77, 124, 15)'); // pressed: accent
  await expect(bold).toHaveCSS('color', 'rgb(255, 255, 255)');
  await bold.hover();
  await expect(bold).toHaveCSS('background-color', 'rgb(77, 124, 15)'); // stays accent under the mouse
  await page.mouse.move(700, 600);
  // Disabled redo stays readable (4.2:1).
  const redo = toolbar.getByRole('button', { name: 'Redo' });
  await expect(redo).toBeDisabled();
  await expect(redo).toHaveCSS('color', 'rgb(109, 119, 90)'); // #6d775a
  await expect(redo).toHaveCSS('opacity', '1');
  // The size box (3:1 edge) and menus stay white with dark text.
  const size = toolbar.getByRole('textbox', { name: 'Font size' });
  await expect(size).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(size).toHaveCSS('color', 'rgb(29, 38, 16)');
  await expect(size).toHaveCSS('border-top-color', 'rgb(133, 144, 110)'); // #85906e
  const fontBtn = toolbar.getByRole('button', { name: 'Font', exact: true });
  await fontBtn.click();
  const menu = page.getByRole('menu', { name: 'Font' });
  await expect(menu).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(menu).toHaveCSS('color', 'rgb(29, 38, 16)');
  await expect(fontBtn).toHaveCSS('background-color', 'rgb(77, 124, 15)'); // open dropdown: accent
  await expect(fontBtn).toHaveCSS('color', 'rgb(255, 255, 255)');
  expect(await pinkInChrome(page)).toEqual([]);
  await page.keyboard.press('Escape');

  await expect(page.locator('.note-pane')).toHaveCSS('background-color', 'rgb(255, 255, 255)'); // the page stays white
  const input = page.getByRole('textbox', { name: 'Add tag' });
  await input.fill('olive');
  await input.press('Enter');
  const chip = page.getByRole('list', { name: 'Tags' }).getByRole('listitem').first();
  await expect(chip).toHaveCSS('background-color', 'rgb(228, 242, 196)'); // #e4f2c4
  await expect(chip).toHaveCSS('color', 'rgb(63, 98, 18)'); // #3f6212
  // No dark mode.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(247, 249, 241)');
  await expect(toolbar).toHaveCSS('background-color', 'rgb(238, 245, 220)');
  await expect(nav).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.emulateMedia({ colorScheme: 'light' });

  // Table controls and the colour menu; then the home page.
  const insert = await openMenu(page, 'Insert');
  await insert.getByRole('menuitem', { name: 'Table' }).click();
  await expect(page.getByRole('toolbar', { name: 'Table' })).toBeVisible();
  await page.mouse.move(700, 700);
  expect(await pinkInChrome(page)).toEqual([]);
  await toolbar.getByRole('button', { name: 'Text colour' }).click();
  await expect(page.getByRole('menu', { name: 'Text colour' })).toHaveText('');
  await page.screenshot({ path: 'test-results/screens/editor-olive.png' });
  await page.keyboard.press('Escape');
  await goHome(page);
  await expect(page.getByTestId('notes-list').locator('.note-card').first()).toBeVisible();
  await expect(page.getByRole('group', { name: 'Filter by tag' }).getByRole('button', { name: '#olive' })).toBeVisible();
  await page.mouse.move(700, 800);
  expect(await pinkInChrome(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/screens/home-olive.png' });
});
