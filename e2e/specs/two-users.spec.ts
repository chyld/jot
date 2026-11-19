// Two users: neither can see the other's notes, tags, fonts, styles or photos.
import { expect, test } from '@playwright/test';
import { body, goHome, insertPhoto, login, newNote, typeInBody, uniq, waitSaved } from './helpers';

test('two users cannot see each other’s things', async ({ browser }) => {
  const aliceCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  await login(alice, 'alice');
  const secret = uniq('secret');
  const tag = uniq('alicetag');
  const styleName = `Alice ${uniq()}`;

  const noteUrl = await newNote(alice, `Alice ${secret}`);
  await typeInBody(alice, `private ${secret}`);
  await alice.getByRole('textbox', { name: 'Add tag' }).fill(tag);
  await alice.getByRole('textbox', { name: 'Add tag' }).press('Enter');
  await insertPhoto(alice);
  await waitSaved(alice);
  const photoSrc = (await body(alice).locator('.jot-photo img').getAttribute('src'))!;
  expect((await alice.request.get(photoSrc)).status()).toBe(200);
  // A font and a style of alice's own.
  expect([200, 201]).toContain((await alice.request.post('/api/fonts', { data: { family: 'Roboto Slab' } })).status());
  const fonts = (await (await alice.request.get('/api/fonts')).json()).fonts;
  const slab = fonts.find((f: any) => f.family === 'Roboto Slab');
  expect((await alice.request.post('/api/styles', { data: { name: styleName, fontId: slab.id, size: 18 } })).status()).toBe(201);

  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await login(bob, 'bob');
  const nav = bob.getByRole('navigation', { name: 'Main' });

  // Notes
  await expect(bob.getByTestId('notes-list')).not.toContainText(secret);
  await bob.goto(noteUrl);
  await expect(bob.getByText('This note does not exist.')).toBeVisible();
  await goHome(bob);
  await bob.getByRole('searchbox', { name: 'Search notes' }).fill(secret);
  await expect(bob.getByTestId('notes-list').getByText('No notes match.')).toBeVisible();

  // Tags: alice's tag is a chip in her home page filter, never in bob's.
  await goHome(alice);
  await expect(alice.getByRole('group', { name: 'Filter by tag' }).getByRole('button', { name: `#${tag}` })).toBeVisible();
  await bob.getByRole('searchbox', { name: 'Search notes' }).fill('');
  const bobFilter = bob.getByRole('group', { name: 'Filter by tag' });
  await expect(bobFilter.getByRole('button', { name: 'All' })).toBeVisible();
  await expect(bobFilter).not.toContainText(tag);
  // Even naming alice's tag in the URL shows bob nothing of hers.
  await bob.goto(`/?tag=${tag}`);
  await expect(bob.getByTestId('notes-list')).not.toContainText(secret);
  await expect(bob).toHaveURL(/\/$/); // an unknown tag stops filtering

  // Fonts
  await nav.getByRole('link', { name: 'Fonts' }).click();
  await expect(bob.getByRole('region', { name: 'Your fonts' })).toContainText('Inter');
  await expect(bob.getByRole('region', { name: 'Your fonts' })).not.toContainText('Roboto Slab');
  expect((await bob.request.get(`/api/fonts/${slab.id}/files/0.woff2`)).status()).toBe(404);

  // Styles
  await nav.getByRole('link', { name: 'Styles' }).click();
  await expect(bob.getByRole('article', { name: 'Style Body' })).toBeVisible();
  await expect(bob.getByRole('article', { name: `Style ${styleName}` })).toHaveCount(0);

  // Photos
  expect((await bob.request.get(photoSrc)).status()).toBe(404);

  // And the other way round: alice cannot see bob's note.
  const bobNote = await newNote(bob, `Bob ${uniq()}`);
  await alice.goto(bobNote);
  await expect(alice.getByText('This note does not exist.')).toBeVisible();

  await aliceCtx.close();
  await bobCtx.close();
});
