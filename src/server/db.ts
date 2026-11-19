// SQLite database: one file in the data folder. Every owned row carries user_id,
// and every query in Jot filters by the logged-in user.
import Database from 'better-sqlite3';

export type DB = Database.Database;

export const SCHEMA_VERSION = 2;

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
}

export function now(): string {
  return new Date().toISOString();
}
