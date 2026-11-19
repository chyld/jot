// The one system-wide lock: only one backup or restore runs at a time, across the web
// app and every CLI command. It is an operating-system file lock on data/.lock (SQLite
// takes a POSIX lock on the file for an exclusive transaction), so the kernel releases
// it if the process crashes or is killed. The file itself holds nothing.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { BackupError, BUSY_MESSAGE } from './errors';

export interface Lock {
  release(): void;
}

export const LOCK_FILE = '.lock';

/** Takes the lock without waiting, or returns null if someone else holds it. */
export function tryLock(dataDir: string): Lock | null {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, LOCK_FILE), { timeout: 0 });
  try {
    db.pragma('journal_mode = MEMORY'); // no journal file next to the lock
    db.exec('BEGIN EXCLUSIVE');
  } catch (err) {
    db.close();
    if (err instanceof Error && /SQLITE_BUSY|SQLITE_LOCKED/.test((err as any).code ?? '')) return null;
    throw err;
  }
  let held = true;
  return {
    release() {
      if (!held) return;
      held = false;
      try {
        db.exec('ROLLBACK');
      } finally {
        db.close();
      }
    },
  };
}

/** Takes the lock or refuses with "another backup or restore is running". */
export function takeLock(dataDir: string): Lock {
  const lock = tryLock(dataDir);
  if (!lock) throw new BackupError(BUSY_MESSAGE, 409, 'busy');
  return lock;
}
