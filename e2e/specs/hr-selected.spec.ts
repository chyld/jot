// A horizontal line the cursor is on is visible. Arrowing onto a line selects the line
// itself, so there is no text caret; the line is drawn thicker in the accent colour
// instead, without moving the text around it, and goes back when the cursor moves on.
import { expect, test, type Page } from '@playwright/test';
import { body, login, newNote, uniq } from './helpers';

const noteId = (page: Page) => new URL(page.url()).pathname.split('/').pop()!;
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

async function line(page: Page) {
  return body(page).locator('hr').evaluate((el) => {
    const s = getComputedStyle(el);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const probe = document.createElement('i');
    probe.style.color = accent;
    document.body.appendChild(probe);
    const accentRgb = getComputedStyle(probe).color;
    probe.remove();
    return {
      selected: el.classList.contains('ProseMirror-selectednode'),
      colour: s.borderTopColor,
      shadow: s.boxShadow,
      accentRgb,
      top: el.getBoundingClientRect().top,
      belowTop: el.nextElementSibling!.getBoundingClientRect().top,
    };
  });
}

test('a horizontal line shows when the cursor is on it and goes back when it moves on', async ({ page }) => {
  await login(page, 'alice');
  await newNote(page, `Line ${uniq()}`);
  const content = { type: 'doc', content: [p('above the line'), { type: 'horizontalRule' }, p('below the line')] };
  expect((await page.request.patch(`/api/notes/${noteId(page)}`, { data: { content } })).status()).toBe(200);
  await page.reload();
  await expect(body(page).getByText('below the line')).toBeVisible();

  const before = await line(page);
  expect(before.selected).toBe(false);
  expect(before.shadow).toBe('none');
  expect(before.colour).not.toBe(before.accentRgb);

  // From the paragraph below, Arrow Up lands on the line.
  // A held click, as a person does, so the editor has read the caret before the key arrives.
  await body(page).getByText('below the line').click({ delay: 60 });
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowUp');
  await expect(body(page).locator('hr.ProseMirror-selectednode')).toHaveCount(1);
  const on = await line(page);
  expect(on.colour).toBe(on.accentRgb);
  expect(on.shadow).not.toBe('none');
  // Nothing moved.
  expect(on.top).toBe(before.top);
  expect(on.belowTop).toBe(before.belowTop);

  // Arrow Up again moves into the paragraph above; the line is plain again and typing goes there.
  await page.keyboard.press('ArrowUp');
  await expect(body(page).locator('hr.ProseMirror-selectednode')).toHaveCount(0);
  const after = await line(page);
  expect(after.shadow).toBe('none');
  expect(after.colour).toBe(before.colour);
  await page.keyboard.type('!');
  await expect(body(page).locator('p').first()).toContainText('!');
  await expect(body(page).locator('hr')).toHaveCount(1);

  // And down again from above.
  await page.keyboard.press('ArrowDown');
  await expect(body(page).locator('hr.ProseMirror-selectednode')).toHaveCount(1);
});
