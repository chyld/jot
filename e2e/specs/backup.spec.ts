// Personal backup and restore in the browser (backup-spec.md §7 "End to end", "Old tab").
// Uses carol, so the restores here never touch the other flows' users.
import { expect, test, type Page } from '@playwright/test';
import { body, goHome, login, newNote, typeInBody, uniq, waitSaved } from './helpers';

async function openBackup(page: Page) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Backup' }).click();
  await expect(page.getByRole('heading', { name: 'Backup', level: 1 })).toBeVisible();
}

async function download(page: Page): Promise<string> {
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up my data' }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/^jot-backup-carol-\d{8}-\d{6}\.tar$/);
  const path = `test-results/${uniq('backup')}.tar`;
  await d.saveAs(path);
  await expect(page.getByRole('region', { name: 'Back up my data' })).toContainText('Downloading');
  return path;
}

async function restoreFrom(page: Page, file: string) {
  await openBackup(page);
  const region = page.getByRole('region', { name: 'Restore from a backup' });
  await page.getByLabel('Backup file').setInputFiles(file);
  await expect(region).toContainText('This backup was made on');
  await expect(region).toContainText(/\d+ notes?/);
  const restore = region.getByRole('button', { name: 'Restore' });
  await expect(restore).toBeDisabled();
  await region.getByLabel('Type RESTORE to confirm').fill('RESTORE');
  await restore.click();
  // The tab that ran the restore reloads on the home page.
  await expect(page).toHaveURL(/\/$/, { timeout: 60_000 });
  await expect(page.getByTestId('notes-list')).toBeVisible();
}

test('back up, delete notes, restore, and see them back; another user is unaffected', async ({ browser }) => {
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await login(bob, 'bob');
  const bobTitle = `Bob keeps ${uniq()}`;
  await newNote(bob, bobTitle);

  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await login(page, 'carol');
  const word = uniq('kept');
  const first = `First ${word}`;
  const second = `Second ${word}`;
  await newNote(page, first);
  await typeInBody(page, `body of ${word}`);
  await waitSaved(page);
  const tag = page.getByRole('textbox', { name: 'Add tag' });
  await tag.fill(word);
  await tag.press('Enter');
  await expect(page.getByRole('list', { name: 'Tags' }).getByText(`#${word}`)).toBeVisible();
  await newNote(page, second);

  await openBackup(page);
  const file = await download(page);

  // Delete both notes for good.
  for (const n of (await (await page.request.get('/api/notes')).json()).notes.filter((n: any) => n.title.includes(word))) {
    expect((await page.request.delete(`/api/notes/${n.id}`)).status()).toBe(200);
    expect((await page.request.delete(`/api/trash/${n.id}`)).status()).toBe(204);
  }
  await goHome(page);
  await expect(page.getByTestId('notes-list')).not.toContainText(word);

  await restoreFrom(page, file);
  const list = page.getByTestId('notes-list');
  await expect(list).toContainText(first);
  await expect(list).toContainText(second);
  await list.getByRole('link', { name: first }).click();
  await expect(body(page)).toContainText(`body of ${word}`);
  await expect(page.getByRole('list', { name: 'Tags' }).getByText(`#${word}`)).toBeVisible();
  // Search and the tag filter work on the restored notes.
  await goHome(page);
  await page.getByRole('searchbox', { name: 'Search notes' }).fill(word);
  await expect(list).toContainText(first);
  await page.getByRole('searchbox', { name: 'Search notes' }).fill('');
  await page.getByRole('group', { name: 'Filter by tag' }).getByRole('button', { name: `#${word}` }).click();
  await expect(list).toContainText(first);
  await expect(list).not.toContainText(second);

  // A safety backup of the data from just before the restore is listed.
  await openBackup(page);
  const safety = page.getByRole('region', { name: 'Safety backups' });
  await expect(safety.getByRole('link', { name: /Download/ }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/backup-after-restore.png' });

  // Bob is unaffected and still sees nothing of carol's.
  await bob.reload();
  await goHome(bob);
  await expect(bob.getByTestId('notes-list')).toContainText(bobTitle);
  await expect(bob.getByTestId('notes-list')).not.toContainText(word);

  await ctx.close();
  await bobCtx.close();
});

test('a tab opened before a restore cannot change restored notes, and keeps its unsaved text', async ({ browser }) => {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await login(page, 'carol');
  const word = uniq('tab');
  await newNote(page, `Old tab ${word}`);
  await typeInBody(page, 'saved before the backup');
  await waitSaved(page);
  const noteUrl = page.url();

  await openBackup(page);
  const file = await download(page);

  // A second tab stays open on the note.
  const old = await ctx.newPage();
  await old.goto(noteUrl);
  await expect(body(old)).toContainText('saved before the backup');

  await restoreFrom(page, file);

  // The old tab types: its save is refused (the note has a new id), the warning is clear,
  // and the text stays on screen.
  await typeInBody(old, ' typed in the old tab');
  await expect(old.getByTestId('save-status')).toHaveText('Not saved', { timeout: 20_000 });
  await expect(old.getByTestId('save-error')).toContainText('no longer exists');
  await expect(body(old)).toContainText('typed in the old tab');

  // The restored note is unchanged.
  const restored = (await (await page.request.get('/api/notes')).json()).notes.find((n: any) => n.title === `Old tab ${word}`);
  const content = JSON.stringify((await (await page.request.get(`/api/notes/${restored.id}`)).json()).note.content);
  expect(content).toContain('saved before the backup');
  expect(content).not.toContain('typed in the old tab');
  await ctx.close();
});
