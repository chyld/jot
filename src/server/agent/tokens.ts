// Bot tokens (agent-spec.md §2). One token per bot, named by the user (1 to 40
// characters, unique for that user). Stored readable in the database (the owner's
// decision, so they can be shown again), never written to the log, never in personal
// backups. A token works only at /mcp.
import { randomBytes } from 'node:crypto';
import { now, type DB } from '../db';
import { newId } from '../ids';

export interface BotToken {
  id: string;
  name: string;
  token: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export class BotError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const MAX_BOT_NAME = 40;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

const toBot = (r: any): BotToken => ({ id: r.id, name: r.name, token: r.token, createdAt: r.created_at, lastUsedAt: r.last_used_at });

export function listBots(db: DB, userId: string): BotToken[] {
  return (db.prepare('SELECT * FROM bot_tokens WHERE user_id = ? ORDER BY name COLLATE NOCASE, created_at, id').all(userId) as any[]).map(toBot);
}

export function createBot(db: DB, userId: string, input: unknown): BotToken {
  if (typeof input !== 'string') throw new BotError('Give the bot a name.');
  const name = input.trim();
  if (name.length < 1 || name.length > MAX_BOT_NAME || CONTROL.test(name)) throw new BotError(`A bot's name is 1 to ${MAX_BOT_NAME} characters, on one line.`);
  if (db.prepare('SELECT 1 FROM bot_tokens WHERE user_id = ? AND name = ?').get(userId, name)) throw new BotError(`You already have a bot called "${name}".`, 409);
  const row = { id: newId(), name, token: `jot_${randomBytes(32).toString('base64url')}`, created_at: now(), last_used_at: null };
  db.prepare('INSERT INTO bot_tokens (id, user_id, name, token, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, NULL)').run(row.id, userId, name, row.token, row.created_at);
  return toBot(row);
}

/** Revoking deletes the token at once. */
export function revokeBot(db: DB, userId: string, id: string): boolean {
  return db.prepare('DELETE FROM bot_tokens WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

/** The bot a token belongs to (and records that it was used), or null. */
export function botForToken(db: DB, token: string): { id: string; userId: string; name: string } | null {
  const r = db.prepare('SELECT id, user_id, name FROM bot_tokens WHERE token = ?').get(token) as { id: string; user_id: string; name: string } | undefined;
  if (!r) return null;
  db.prepare('UPDATE bot_tokens SET last_used_at = ? WHERE id = ?').run(now(), r.id);
  return { id: r.id, userId: r.user_id, name: r.name };
}
