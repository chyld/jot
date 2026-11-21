// End-of-note marker: a thin rule with END in the middle, just below the note's last line,
// across the text width. Drawn by CSS (a ::after on the editor), so it moves down as lines
// are added, is never saved, does not stop a click below the text putting the caret at the
// end, and is left out of the printed PDF.
import { expect, test, type Page } from '@playwright/test';
import { body, login, newNote, typeInBody, uniq, waitSaved } from './helpers';

const noteId = (page: Page) => new URL(page.url()).pathname.split('/').pop()!;
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

/** The ::after marker as drawn, measured against the last block of the body. */
async function marker(page: Page) {
  return body(page).evaluate((el) => {
    const m = getComputedStyle(el, '::after');
    // The body has a minimum height; drop it for a moment so its bottom is the marker's bottom.
    const keep = (el as HTMLElement).style.minHeight;
    (el as HTMLElement).style.minHeight = '0px';
    const box = el.getBoundingClientRect();
    const last = el.lastElementChild!.getBoundingClientRect();
    (el as HTMLElement).style.minHeight = keep;
    return {
      content: m.content,
      display: m.display,
      color: m.color,
      width: parseFloat(m.width) + parseFloat(m.paddingLeft) + parseFloat(m.paddingRight),
      bodyWidth: el.clientWidth,
      lastBottom: last.bottom,
      bottom: box.bottom,
      text: el.textContent,
    };
  });
}

test('the END marker sits just below the last line, moves down with new lines, is never saved and does not print', async ({ page }) => {
  await login(page, 'alice');
  await newNote(page, `End ${uniq()}`);
  expect((await page.request.patch(`/api/notes/${noteId(page)}`, { data: { content: { type: 'doc', content: [p('first line'), p('last line')] } } })).status()).toBe(200);
  await page.reload();
  await expect(body(page).getByText('last line')).toBeVisible();

  const before = await marker(page);
  expect(before.content).toBe('"END"');
  expect(before.display).toBe('block');
  expect(before.width).toBeCloseTo(before.bodyWidth, 0); // the full text width
  // Below the last line, with a little space: margin plus its own 12px line.
  expect(before.bottom - before.lastBottom).toBeGreaterThan(18);
  expect(before.bottom - before.lastBottom).toBeLessThan(40);
  expect(before.text).not.toContain('END');
  // The right edge of the text is the margin marker.
  const right = await body(page).evaluate((el) => el.getBoundingClientRect().right);
  const wrap = await page.getByTestId('wrap-marker').evaluate((el) => el.getBoundingClientRect().left);
  expect(Math.abs(right - wrap)).toBeLessThan(2);

  // Clicking below the text (on the marker's row) still puts the caret at the end.
  const box = (await body(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, before.bottom - 6, { delay: 60 });
  await page.keyboard.type(' typed');
  await expect(body(page).locator(':scope > p').last()).toHaveText('last line typed');

  // A new line pushes it down.
  await page.keyboard.press('Enter');
  await page.keyboard.type('one more line');
  await waitSaved(page);
  const after = await marker(page);
  expect(after.bottom).toBeGreaterThan(before.bottom + 15);
  expect(after.bottom - after.lastBottom).toBeCloseTo(before.bottom - before.lastBottom, 0);

  // What is saved is only what was typed.
  const saved = (await (await page.request.get(`/api/notes/${noteId(page)}`)).json()).note.content;
  expect(saved).toEqual({ type: 'doc', content: [p('first line'), p('last line typed'), p('one more line')] });
  expect(JSON.stringify(saved)).not.toContain('END');

  // Printing (Save as PDF) leaves it out.
  await page.emulateMedia({ media: 'print' });
  expect((await marker(page)).content).toBe('none');
  await page.emulateMedia({ media: 'screen' });
  expect((await marker(page)).content).toBe('"END"');
});
