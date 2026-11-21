// Accounts. Used by the CLI (the only user administration) and by the tests.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fontsDir, photosDir, userDir, type JotContext } from './context';
import { now } from './db';
import { syncDir, syncFile } from './durable';
import { newId } from './ids';
import { checkPasswordRules, hashPassword } from './passwords';
import { deleteUserSessions } from './sessions';
import { addManual } from './manual';
import { addDefaultSection } from './sections';
import { loadStarterManifest, STARTER_STYLES } from './starter';

export class UserError extends Error {}

export const USERNAME_PATTERN = /^[a-z0-9_]{1,32}$/;

export function normalizeUsername(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const u = input.trim().toLowerCase();
  return USERNAME_PATTERN.test(u) ? u : null;
}

export function findUser(ctx: JotContext, username: string) {
  return ctx.db.prepare('SELECT id, username, password_hash, created_at FROM users WHERE username = ?').get(username) as
    | { id: string; username: string; password_hash: string; created_at: string }
    | undefined;
}

/** Creates an account and gives it its own copy of the starter pack. */
export async function createUser(ctx: JotContext, usernameInput: string, password: string) {
  const username = normalizeUsername(usernameInput);
  if (!username) throw new UserError('Usernames are 1-32 characters: lowercase letters, digits or underscore.');
  const rule = checkPasswordRules(password);
  if (rule) throw new UserError(rule);
  if (findUser(ctx, username)) throw new UserError(`A user named "${username}" already exists.`);

  const manifest = loadStarterManifest(ctx.starterFontsDir);
  const hash = await hashPassword(password);
  const id = newId();
  const created = now();

  mkdirSync(photosDir(ctx, id), { recursive: true });
  mkdirSync(fontsDir(ctx, id), { recursive: true });
  try {
    const fontIds = new Map<string, string>();
    for (const f of manifest) {
      const fontId = newId();
      const dir = join(fontsDir(ctx, id), fontId);
      cpSync(join(ctx.starterFontsDir, f.dir), dir, { recursive: true });
      for (const face of f.faces) await syncFile(join(dir, face.file));
      await syncDir(dir);
      fontIds.set(f.family, fontId);
    }
    // The copies and their folders are on disk before the records are saved.
    for (const d of [fontsDir(ctx, id), photosDir(ctx, id), userDir(ctx, id), dirname(userDir(ctx, id))]) await syncDir(d);
    ctx.db.transaction(() => {
      ctx.db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(id, username, hash, created);
      addDefaultSection(ctx.db, id, created);
      const insFont = ctx.db.prepare(
        'INSERT INTO fonts (id, user_id, family, category, faces, archived_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
      );
      for (const f of manifest) insFont.run(fontIds.get(f.family), id, f.family, f.category, JSON.stringify(f.faces), created);
      const insStyle = ctx.db.prepare(
        `INSERT INTO styles (id, user_id, name, font_id, size, bold, italic, underline, strike, text_color, highlight, created_at, updated_at, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, NULL, ?, ?, 1)`,
      );
      for (const s of STARTER_STYLES) {
        insStyle.run(newId(), id, s.name, fontIds.get(s.font), s.size, s.bold ? 1 : 0, s.italic ? 1 : 0, s.textColor, created, created);
      }
      addManual(ctx.db, id, created);
    })();
  } catch (err) {
    rmSync(userDir(ctx, id), { recursive: true, force: true });
    if (err instanceof Error && /UNIQUE constraint failed: users.username/.test(err.message)) {
      throw new UserError(`A user named "${username}" already exists.`);
    }
    throw err;
  }
  return { id, username };
}

/** Sets a new password and ends all of that user's existing sessions. */
export async function setPassword(ctx: JotContext, usernameInput: string, password: string) {
  const username = normalizeUsername(usernameInput);
  const user = username ? findUser(ctx, username) : undefined;
  if (!user) throw new UserError(`No user named "${usernameInput}".`);
  const rule = checkPasswordRules(password);
  if (rule) throw new UserError(rule);
  const hash = await hashPassword(password);
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    deleteUserSessions(ctx.db, user.id);
  })();
  return { id: user.id, username: user.username };
}

export function listUsers(ctx: JotContext) {
  return ctx.db.prepare('SELECT id, username, created_at AS createdAt FROM users ORDER BY username').all() as Array<{
    id: string;
    username: string;
    createdAt: string;
  }>;
}
