// SQLite database: one file in the data folder. Every owned row carries user_id,
// and every query in Jot filters by the logged-in user.
import Database from 'better-sqlite3';
import { ensureDefaultStyles } from './defaultStyles';
import { addManual, refreshManuals } from './manual';
import { STARTER_STYLES } from './starter';

export type DB = Database.Database;

export const SCHEMA_VERSION = 5;

const SCHEMA_V1 = `
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE notes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  title      TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL,
  body_text  TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX notes_user ON notes(user_id, deleted_at, updated_at);

CREATE TABLE tags (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name    TEXT NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (note_id, tag_id)
);
CREATE INDEX note_tags_tag ON note_tags(tag_id);

CREATE TABLE photos (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  original_name TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);

CREATE TABLE fonts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  family      TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '',
  faces       TEXT NOT NULL,
  archived_at TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, family)
);

CREATE TABLE styles (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,
  font_id    TEXT NOT NULL REFERENCES fonts(id),
  size       INTEGER NOT NULL,
  bold       INTEGER NOT NULL DEFAULT 0,
  italic     INTEGER NOT NULL DEFAULT 0,
  underline  INTEGER NOT NULL DEFAULT 0,
  strike     INTEGER NOT NULL DEFAULT 0,
  text_color TEXT,
  highlight  TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX styles_user ON styles(user_id);

-- Search index: one row per live (non-trashed) note, kept in sync by notes.ts.
CREATE VIRTUAL TABLE notes_fts USING fts5(
  note_id UNINDEXED,
  user_id UNINDEXED,
  title,
  body,
  tags,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

// Version 2: the files of a personal restore that tidy-up still has to delete
// (backup/personal.ts). "new": written by a restore that has not committed;
// "old": replaced by a restore that has.
const SCHEMA_V2 = `
CREATE TABLE restore_files (
  path    TEXT PRIMARY KEY,
  state   TEXT NOT NULL CHECK (state IN ('new', 'old')),
  user_id TEXT NOT NULL REFERENCES users(id)
);
`;

export function openDatabase(file: string): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db: DB) {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > SCHEMA_VERSION) {
    throw new Error(`Database schema version ${version} is newer than this Jot (${SCHEMA_VERSION}).`);
  }
  if (version < 1) {
    db.transaction(() => {
      db.exec(SCHEMA_V1);
      db.pragma(`user_version = 1`);
    })();
  }
  if (version < 2) {
    db.transaction(() => {
      db.exec(SCHEMA_V2);
      db.pragma(`user_version = 2`);
    })();
  }
  // Version 3: read-only notes, and every existing account gets its User manual note
  // (once: this runs only when the database is older than version 3).
  if (version < 3) {
    db.transaction(() => {
      db.exec('ALTER TABLE notes ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0');
      const at = now();
      for (const u of db.prepare('SELECT id FROM users ORDER BY created_at, id').all() as Array<{ id: string }>) addManual(db, u.id, at);
      db.pragma(`user_version = 3`);
    })();
  }
  // Version 4: the five starter styles become default styles (flagged, not editable).
  // Per user and style: the starter style they were given (same name, created with the
  // account) is flagged and set back to its standard definition if it was edited; a
  // deleted or renamed one is created again. Every other style is left as it is.
  if (version < 4) {
    db.transaction(() => {
      db.exec('ALTER TABLE styles ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0');
      const at = now();
      const original = db.prepare('SELECT id FROM styles WHERE user_id = ? AND name = ? AND created_at = ? ORDER BY id LIMIT 1');
      for (const u of db.prepare('SELECT id, created_at FROM users ORDER BY created_at, id').all() as Array<{ id: string; created_at: string }>) {
        for (const def of STARTER_STYLES) {
          const s = original.get(u.id, def.name, u.created_at) as { id: string } | undefined;
          if (s) db.prepare('UPDATE styles SET is_default = 1 WHERE id = ?').run(s.id);
        }
        ensureDefaultStyles(db, u.id, at);
      }
      db.pragma(`user_version = 4`);
    })();
  }
  // Version 5: the Backup screen became the Account page; each existing User manual note
  // gets the updated text (same note, id, tags, dates and read-only flag).
  if (version < 5) {
    db.transaction(() => {
      refreshManuals(db);
      db.pragma(`user_version = 5`);
    })();
  }
}

export function now(): string {
  return new Date().toISOString();
}
