// End to end: a real MCP client (the SDK's own) connects to the real container over HTTP
// with a token made on the Account page, lists its tools, creates a note with an image,
// lists and reads notes; the user sees the note in the Inbox and keeps it.
import { expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { body, goHome, login, makePng, uniq } from './helpers';

const BASE = process.env.BASE_URL ?? 'http://jot-app:9003';

async function connect(token: string) {
  const client = new Client({ name: 'e2e-bot', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}
const text = (r: any) => (r.content as any[]).map((c) => c.text).join('\n');

test('a bot with a real MCP client writes a note with a photo; the user finds it in the Inbox and keeps it', async ({ page }) => {
  await login(page, 'bob');
  const botName = `Bot ${uniq()}`;

  // Make a token on the Account page.
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Account' }).click();
  const bots = page.getByRole('region', { name: 'Bots' });
  await expect(bots).toContainText('/mcp');
  await bots.getByLabel('Bot name').fill(botName);
  await bots.getByRole('button', { name: 'Create' }).click();
  const row = bots.getByRole('listitem').filter({ hasText: botName });
  const token = (await row.getByTestId('bot-token').textContent())!.trim();
  expect(token).toMatch(/^jot_/);
  await expect(row).toContainText(/last used: never/i);
  await page.screenshot({ path: 'test-results/screens/account-bots.png', fullPage: true });

  // The bot connects, lists its tools and writes a note with a photo.
  const client = await connect(token);
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  expect(tools).toEqual(['create_note', 'list_notes', 'read_note']);
  const word = uniq('agent');
  const png = makePng(160, 120, [20, 120, 60]);
  const created = text(
    await client.callTool({
      name: 'create_note',
      arguments: { title: `Report ${word}`, markdown: `Summary for **${word}**.\n\n![chart](chart.png)\n\n- point one\n- point two`, tags: ['reports'], images: [{ name: 'chart.png', mime_type: 'image/png', data: png.toString('base64') }] },
    }),
  );
  const id = /id: ([A-Za-z0-9_-]{22})/.exec(created)![1];
  const listed = text(await client.callTool({ name: 'list_notes', arguments: { query: word } }));
  expect(listed).toContain(id);
  expect(listed).toMatch(/in inbox: yes/);
  const read = text(await client.callTool({ name: 'read_note', arguments: { id } }));
  expect(read).toContain(`**${word}**`);
  expect(read).toContain('[photo]');
  expect(read).toMatch(/UNTRUSTED NOTE DATA/);
  await client.close();

  // The user sees it in the Inbox, with the count, the bot's name and the photo.
  await page.reload();
  await expect(nav.getByRole('link', { name: /^Inbox/ }).getByTestId('inbox-count')).not.toHaveText('');
  await nav.getByRole('link', { name: /^Inbox/ }).click();
  await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
  const card = page.getByRole('article', { name: `Report ${word}` });
  await expect(card.getByTestId('note-bot')).toContainText(botName);
  await expect(row).toHaveCount(0); // (the Account page is gone from view)
  await card.getByRole('link', { name: `Report ${word}` }).click();
  await expect(page.getByTestId('note-bot')).toContainText(botName);
  await expect(body(page).locator('.jot-photo img')).toHaveCount(1);
  await expect(body(page)).toContainText(word);
  await expect(page.getByTestId('notes-list')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/screens/inbox-note.png' });
  // Not on the home page until it is kept.
  await goHome(page);
  await expect(page.getByTestId('notes-list')).not.toContainText(word);
  await nav.getByRole('link', { name: /^Inbox/ }).click();
  await expect(page.getByRole('article', { name: `Report ${word}` })).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/inbox.png' });
  await page.getByRole('button', { name: `Keep Report ${word}` }).click();
  await expect(page.getByRole('article', { name: `Report ${word}` })).toHaveCount(0);
  await goHome(page);
  await expect(page.getByTestId('notes-list')).toContainText(`Report ${word}`);
  await expect(page.getByTestId('notes-list').getByRole('article', { name: `Report ${word}` }).getByTestId('note-bot')).toContainText(botName);

  // Revoking the token stops the bot at once.
  await nav.getByRole('link', { name: 'Account' }).click();
  const again = page.getByRole('region', { name: 'Bots' }).getByRole('listitem').filter({ hasText: botName });
  await expect(again).not.toContainText(/last used: never/i);
  await again.getByRole('button', { name: `Revoke ${botName}` }).click();
  await again.getByRole('button', { name: `Confirm: revoke ${botName}` }).click();
  await expect(page.getByRole('region', { name: 'Bots' }).getByText(botName)).toHaveCount(0);
  await expect(connect(token)).rejects.toThrow();
});
