// Server-side sessions. The cookie holds a random token; the database holds only its SHA-256.
import { createHash, randomBytes } from 'node:crypto';
import type { DB } from './db';
import { now } from './db';

export const SESSION_COOKIE = 'jot_session';
export const SESSION_DAYS = 30;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export function createSession(db: DB, userId: string): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hash(token),
    userId,
    now(),
    expiresAt.toISOString(),
  );
  return { token, expiresAt };
}

export function userForSession(db: DB, token: string | undefined): { id: string; username: string } | null {
  if (!token || token.length > 200) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(hash(token)) as { id: string; username: string; expires_at: string } | undefined;
  if (!row) return null;
  if (row.expires_at <= now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
    return null;
  }
  return { id: row.id, username: row.username };
}

export function deleteSession(db: DB, token: string | undefined) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
}

export function deleteUserSessions(db: DB, userId: string) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}
