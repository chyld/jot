// Pasting into the note editor.
//  - Text always arrives as plain text (from other apps and web pages, and from Jot itself),
//    taking the formatting at the cursor, with lines kept as paragraphs.
//  - An image on the clipboard (as an image file) is uploaded as a Jot photo and inserted
//    at the cursor; a disallowed type or a failed upload shows a message; an external or
//    data: image URL is never inserted; text wins when there is usable text.
// The paste events carry a real DataTransfer, exactly as the browser delivers Ctrl+V or
// its Paste menu; "copy inside Jot" uses what Jot itself put on the clipboard.
import { expect, test, type Page } from '@playwright/test';
import { body, login, makePng, newNote, typeInBody, uniq, waitSaved } from './helpers';

interface ClipFile {
  name: string;
  type: string;
  bytes: number[];
}

async function paste(page: Page, data: { text?: string; html?: string; files?: ClipFile[] }) {
  await body(page).evaluate((el, d) => {
    const dt = new DataTransfer();
    if (d.html !== undefined) dt.setData('text/html', d.html);
    if (d.text !== undefined) dt.setData('text/plain', d.text);
    for (const f of d.files ?? []) dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.type }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, data);
}

/** Copies the editor's selection with Ctrl+C and returns what Jot put on the clipboard. */
async function copySelection(page: Page): Promise<{ text: string; html: string }> {
  await page.evaluate(() => {
    (window as any).__copied = null;
    document.addEventListener(
      'copy',
      (e) => ((window as any).__copied = { text: e.clipboardData!.getData('text/plain'), html: e.clipboardData!.getData('text/html') }),
      { once: true },
    );
  });
  // A person's pace: ProseMirror reads a keyboard-made selection just after the keys.
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+C');
  return page.waitForFunction(() => (window as any).__copied).then((h) => h.jsonValue());
}

const noteId = (page: Page) => new URL(page.url()).pathname.split('/').pop()!;
async function saved(page: Page) {
  return (await (await page.request.get(`/api/notes/${noteId(page)}`)).json()).note.content;
}
/** Every node type and mark in a document. */
function shape(doc: any) {
  const nodes = new Set<string>();
  const marks = new Set<string>();
  const walk = (n: any) => {
    nodes.add(n.type);
    for (const m of n.marks ?? []) marks.add(m.type);
    (n.content ?? []).forEach(walk);
  };
  walk(doc);
  return { nodes: [...nodes].sort(), marks: [...marks].sort() };
}
const paragraphs = (doc: any) => (doc.content ?? []).map((p: any) => (p.content ?? []).map((t: any) => t.text ?? '').join(''));
const PNG = makePng(120, 90, [40, 120, 200]);
const png = (name = 'shot.png'): ClipFile => ({ name, type: 'image/png', bytes: [...PNG] });

test.describe('paste as plain text', () => {
  test('rich HTML from another app or web page arrives as plain text', async ({ page }) => {
    await login(page, 'alice');
    await newNote(page, `Paste rich ${uniq()}`);
    await typeInBody(page, 'start ');
    const html =
      '<h1 style="font-family:Comic Sans MS;color:#ff0000;font-size:48px">Big <b>bold</b> <a href="https://x.example/">link</a></h1>' +
      '<ul><li><i>item one</i></li></ul>' +
      '<table><tr><td>cell a</td><td><mark>cell b</mark></td></tr></table>' +
      '<p><span style="font-size:40px;background:yellow"><u>styled</u></span> <img src="https://x.example/i.png"></p>';
    await paste(page, { html, text: 'Big bold link\nitem one\ncell a\tcell b\nstyled' });
    for (const tag of ['h1', 'ul', 'li', 'table', 'a', 'b', 'strong', 'i', 'em', 'u', 'mark', 'img', 'span[style]']) {
      await expect(body(page).locator(tag), tag).toHaveCount(0);
    }
    await waitSaved(page);
    await page.reload();
    await expect(body(page)).toContainText('styled');
    const doc = await saved(page);
    expect(shape(doc)).toEqual({ nodes: ['doc', 'paragraph', 'text'], marks: [] });
    expect(paragraphs(doc)).toEqual(['start Big bold link', 'item one', 'cell a\tcell b', 'styled']);
  });

  test('markdown-like text and web addresses are not turned into formatting', async ({ page }) => {
    await login(page, 'alice');
    await newNote(page, `Paste plain ${uniq()}`);
    await typeInBody(page, 'x ');
    await paste(page, { text: '**not bold** _not italic_ ~~not struck~~ ==not marked== `not code` https://example.com/page' });
    await waitSaved(page);
    const doc = await saved(page);
    expect(shape(doc).marks).toEqual([]);
    expect(paragraphs(doc)).toEqual(['x **not bold** _not italic_ ~~not struck~~ ==not marked== `not code` https://example.com/page']);
  });

  test('styled text and table cells copied inside Jot paste as plain text that takes the formatting at the cursor', async ({ page }) => {
    await login(page, 'alice');
    await newNote(page, `Paste from Jot ${uniq()}`);
    const styled = { type: 'textStyle', attrs: { fontFamily: '"Lora"', fontSize: '32px', color: 'Crimson' } };
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'STYLED', marks: [{ type: 'bold' }, { type: 'italic' }, styled, { type: 'highlight', attrs: { color: 'Sunflower' } }] },
            { type: 'text', text: 'LINKED', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
          ],
        },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'HEADING' }] },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'CELLONE' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'CELLTWO', marks: [{ type: 'bold' }] }] }] },
              ],
            },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'plain target' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'BOLDTARGET', marks: [{ type: 'bold' }] }] },
      ],
    };
    expect((await page.request.patch(`/api/notes/${noteId(page)}`, { data: { content } })).status()).toBe(200);
    await page.reload();
    await expect(body(page)).toContainText('BOLDTARGET');

    // Copy the styled paragraph and the heading (Ctrl+C), paste at the end of the plain paragraph.
    await body(page).getByText('STYLED').click({ delay: 60 });
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+End');
    const fromJot = await copySelection(page);
    expect(fromJot.html).toMatch(/data-pm-slice/); // really Jot's own rich copy
    await body(page).getByText('plain target').click({ delay: 60 });
    await page.keyboard.press('End');
    await paste(page, fromJot);

    // Copy a table cell's text, paste it into the bold paragraph: it becomes bold like typing would.
    await body(page).getByText('CELLTWO').click({ delay: 60 });
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    const cell = await copySelection(page);
    expect(cell.text).toBe('CELLTWO');
    expect(cell.html).toMatch(/<strong>CELLTWO<\/strong>/); // copied with its bold
    await body(page).getByText('BOLDTARGET').click({ delay: 60 });
    await page.keyboard.press('End');
    await paste(page, cell);
    await waitSaved(page);

    await page.reload();
    await expect(body(page)).toContainText('BOLDTARGETCELLTWO');
    const doc = await saved(page);
    const blocks = doc.content as any[];
    const target = blocks.find((b) => b.type === 'paragraph' && JSON.stringify(b).includes('plain target'));
    expect(target.content).toEqual([{ type: 'text', text: 'plain targetSTYLEDLINKED' }]);
    expect(blocks.filter((b) => b.type === 'heading').length).toBe(1); // only the original heading
    expect(blocks.some((b) => b.type === 'paragraph' && JSON.stringify(b).includes('"text":"HEADING"'))).toBe(true);
    const bold = blocks.at(-1);
    expect(bold.content).toEqual([{ type: 'text', text: 'BOLDTARGETCELLTWO', marks: [{ type: 'bold' }] }]);
    expect(blocks.filter((b) => b.type === 'table').length).toBe(1);
  });
});

test.describe('paste an image', () => {
  test('an image on the clipboard is uploaded, inserted at the cursor as a photo, and saved', async ({ page }) => {
    await login(page, 'alice');
    await newNote(page, `Paste image ${uniq()}`);
    await typeInBody(page, 'before the picture');
    const uploads: number[] = [];
    page.on('response', (r) => r.url().endsWith('/api/photos') && r.request().method() === 'POST' && uploads.push(r.status()));
    await paste(page, { files: [png()] });
    const img = body(page).locator('.jot-photo img');
    await expect(img).toHaveCount(1);
    await expect(img).toHaveAttribute('src', /^\/api\/photos\/[A-Za-z0-9_-]{22}$/);
    expect(uploads).toEqual([201]);
    // The usual photo controls and handles.
    await img.click();
    await expect(page.getByRole('toolbar', { name: 'Photo' })).toBeVisible();
    await expect(body(page).locator('.jot-photo-handle')).toHaveCount(4);
    await waitSaved(page);
    await page.reload();
    await expect(body(page).locator('.jot-photo img')).toHaveCount(1);
    const doc = await saved(page);
    const image = JSON.stringify(doc).match(/"src":"(\/api\/photos\/[^"]+)"/)![1];
    const got = await page.request.get(image);
    expect(got.status()).toBe(200);
    expect(Buffer.from(await got.body()).equals(PNG)).toBe(true);
    expect(paragraphs({ content: doc.content.filter((b: any) => b.type === 'paragraph') }).join('')).toContain('before the picture');
  });

  test('a disallowed image type shows a message and nothing is uploaded or inserted', async ({ page }) => {
    await login(page, 'alice');
    await newNote(page, `Paste bmp ${uniq()}`);
    await typeInBody(page, 'x');
    let uploads = 0;
    page.on('request', (r) => r.url().endsWith('/api/photos') && r.method() === 'POST' && uploads++);
    await paste(page, { files: [{ name: 'old.bmp', type: 'image/bmp', bytes: [0x42, 0x4d, 1, 2, 3, 4] }] });
    await expect(page.getByRole('alert')).toContainText('JPEG, PNG, GIF or WebP');
    await paste(page, { files: [{ name: 'vector.svg', type: 'image/svg+xml', bytes: [...Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')] }] });
    await expect(page.getByRole('alert')).toContainText('JPEG, PNG, GIF or WebP');
    await expect(body(page).locator('img')).toHaveCount(0);
    expect(uploads).toBe(0);
  });

  test('a failed upload shows a message and nothing is inserted', async ({ page }) => {
    await login(page, 'alice');
    await newNote(page, `Paste broken ${uniq()}`);
    await typeInBody(page, 'x');
    await paste(page, { files: [{ name: 'fake.png', type: 'image/png', bytes: [...Buffer.from('not really a png')] }] });
    await expect(page.getByRole('alert')).toContainText(/photo|image/i);
    await expect(body(page).locator('img')).toHaveCount(0);
  });

  test('text wins when there is usable text; an image wins only when there is none', async ({ page }) => {
    await login(page, 'alice');
    await newNote(page, `Paste both ${uniq()}`);
    await typeInBody(page, 'x ');
    let uploads = 0;
    page.on('request', (r) => r.url().endsWith('/api/photos') && r.method() === 'POST' && uploads++);
    await paste(page, { text: 'words from the app', html: '<p>words from the app</p><img src="https://x.example/i.png">', files: [png()] });
    await expect(body(page)).toContainText('x words from the app');
    await expect(body(page).locator('img')).toHaveCount(0);
    expect(uploads).toBe(0);
    await paste(page, { text: '  \n ', html: '<img src="https://x.example/i.png">', files: [png()] });
    await expect(body(page).locator('.jot-photo img')).toHaveCount(1);
    expect(uploads).toBe(1);
  });

  test('an external or data: image URL is never inserted', async ({ page }) => {
    await login(page, 'alice');
    await newNote(page, `Paste urls ${uniq()}`);
    await typeInBody(page, 'x');
    await paste(page, { html: '<img src="https://x.example/i.png"><img src="data:image/png;base64,iVBORw0KGgo=">' });
    await paste(page, { html: '<p><img src="https://x.example/i.png"></p>', text: '' });
    await expect(body(page).locator('img')).toHaveCount(0);
    await waitSaved(page).catch(() => {});
    expect(JSON.stringify(await saved(page))).not.toMatch(/x\.example|data:/);
  });
});
