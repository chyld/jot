// Entry names allowed inside backups (nothing else is ever accepted, so an archive can
// never name a path outside its folder), and the names of backup files.
import { randomBytes } from 'node:crypto';

const ID = '[A-Za-z0-9_-]{22}';
const FONT = '\\d{1,4}\\.woff2';

const PERSONAL = new RegExp(`^(?:data\\.json|manifest\\.json|photos/${ID}|fonts/${ID}/${FONT})$`);
const SYSTEM = new RegExp(`^(?:jot\\.db|manifest\\.json|users/${ID}/photos/${ID}|users/${ID}/fonts/${ID}/${FONT})$`);

export const isPersonalEntry = (name: string) => PERSONAL.test(name);
export const isSystemEntry = (name: string) => SYSTEM.test(name);

/**
 * Names a personal manifest may list as missing: any entry name, plus photos a note
 * points at that were never this account's (the note content allows any photo id).
 * Missing files are never written, so these names are never used as paths.
 */
export const isPersonalMissingName = (name: string) => PERSONAL.test(name) || /^photos\/[A-Za-z0-9_-]{1,64}$/.test(name);

/** 20261118-090503 (UTC). */
export function stamp(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-');
}

export const personalBackupName = (username: string, d: Date) => `jot-backup-${username}-${stamp(d)}.tar`;
export const systemBackupName = (d: Date) => `jot-backup-${stamp(d)}.tar`;
export const safetyBackupName = (d: Date) => `jot-safety-${stamp(d)}-${randomBytes(4).toString('hex')}.tar`;
export const SAFETY_NAME = /^jot-safety-\d{8}-\d{6}-[0-9a-f]{8}\.tar$/;

/** The time in a backup file name, as an ISO date. */
export function timeFromName(name: string): string | null {
  const m = /-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null;
}
