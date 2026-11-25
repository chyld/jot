// Notes, tags, trash and search. Every function takes the owner's user id and every
// query filters by it. The FTS5 index holds exactly one row per live (non-trashed)
// note and is rewritten in the same transaction as any change that affects it.
// The functions behind the home page, search, New, "Delete N empty" and the trash take the
// current section and add it to their queries (sections-spec.md §2). The app checks that
// the section is the user's before calling them.
import type { Note, NoteContent, NoteKind, NoteSummary, SheetDoc, Tag, TiptapDoc } from '../shared/types';
import { docText, emptyDoc, previewOf } from './content';
import { now, type DB } from './db';
import { newId } from './ids';
import { buildFtsQuery } from './search';
import { emptySheet, isEmptySheet, sheetText } from './sheet';

interface NoteRow {
  id: string;
  kind: string;
  user_id: string;
  title: string;
  content?: string;
  body_text: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  read_only: number;
  inbox: number;
  bot_name: string | null;
  section_id: string;
  tag_list: string | null;
}

const SUMMARY_COLS = `n.id, n.kind, n.user_id, n.title, n.body_text, n.created_at, n.updated_at, n.deleted_at, n.read_only, n.inbox, n.bot_name, n.section_id,
  (SELECT group_concat(t.name, ' ' ORDER BY t.name) FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
     WHERE nt.note_id = n.id) AS tag_list`;

function toSummary(r: NoteRow): NoteSummary {
  return {
    id: r.id,
    kind: r.kind === 'sheet' ? 'sheet' : 'doc',
    title: r.title,
    preview: previewOf(r.body_text),
    tags: r.tag_list ? r.tag_list.split(' ') : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    readOnly: r.read_only === 1,
    inbox: r.inbox === 1,
    botName: r.bot_name ?? null,
    section: r.section_id,
  };
}

/** Rewrites the note's search-index row (or removes it if the note is trashed or gone). */
export function reindexNote(db: DB, noteId: string) {
  db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(noteId);
  const r = db
    .prepare(`SELECT ${SUMMARY_COLS} FROM notes n WHERE n.id = ? AND n.deleted_at IS NULL`)
    .get(noteId) as NoteRow | undefined;
  if (r) {
    db.prepare('INSERT INTO notes_fts (note_id, user_id, title, body, tags) VALUES (?, ?, ?, ?, ?)').run(
      r.id,
      r.user_id,
      r.title,
      r.body_text,
      r.tag_list ?? '',
    );
  }
}

function deleteOrphanTags(db: DB, userId: string) {
  db.prepare('DELETE FROM tags WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM note_tags nt WHERE nt.tag_id = tags.id)').run(userId);
}

export function getNote(db: DB, userId: string, id: string): Note | null {
  const r = db
    .prepare(`SELECT ${SUMMARY_COLS}, n.content FROM notes n WHERE n.id = ? AND n.user_id = ?`)
    .get(id, userId) as NoteRow | undefined;
  if (!r) return null;
  return { ...toSummary(r), content: JSON.parse(r.content!) as NoteContent };
}

export function getNoteKind(db: DB, userId: string, id: string): NoteKind | null {
  const r = db.prepare('SELECT kind FROM notes WHERE id = ? AND user_id = ?').get(id, userId) as { kind: string } | undefined;
  if (!r) return null;
  return r.kind === 'sheet' ? 'sheet' : 'doc';
}

export function listNotes(db: DB, userId: string, section: string, tag?: string): NoteSummary[] {
  const rows = tag
    ? db
        .prepare(
          `SELECT ${SUMMARY_COLS} FROM notes n WHERE n.user_id = ? AND n.section_id = ? AND n.deleted_at IS NULL AND n.inbox = 0
           AND EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
                       WHERE nt.note_id = n.id AND t.user_id = ? AND t.name = ?)
           ORDER BY n.updated_at DESC, n.id`,
        )
        .all(userId, section, userId, tag)
    : db
        .prepare(`SELECT ${SUMMARY_COLS} FROM notes n WHERE n.user_id = ? AND n.section_id = ? AND n.deleted_at IS NULL AND n.inbox = 0 ORDER BY n.updated_at DESC, n.id`)
        .all(userId, section);
  return (rows as NoteRow[]).map(toSummary);
}

export function listTrash(db: DB, userId: string, section: string): NoteSummary[] {
  const rows = db
    .prepare(`SELECT ${SUMMARY_COLS} FROM notes n WHERE n.user_id = ? AND n.section_id = ? AND n.deleted_at IS NOT NULL ORDER BY n.deleted_at DESC, n.id`)
    .all(userId, section) as NoteRow[];
  return rows.map(toSummary);
}

function contentText(content: NoteContent): string {
  return content.type === 'sheet' ? sheetText(content) : docText(content);
}

export function createNote(db: DB, userId: string, section: string, title: string, content: NoteContent | undefined, kind: NoteKind = 'doc'): Note {
  const id = newId();
  const body = content ?? (kind === 'sheet' ? emptySheet() : emptyDoc());
  const t = now();
  db.transaction(() => {
    db.prepare(
      'INSERT INTO notes (id, kind, user_id, title, content, body_text, created_at, updated_at, deleted_at, section_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)',
    ).run(id, kind, userId, title, JSON.stringify(body), contentText(body), t, t, section);
    reindexNote(db, id);
  })();
  return getNote(db, userId, id)!;
}

export type UpdateResult = Note | 'not-found' | 'trashed' | 'read-only';

/** Whether the note may be changed: it must exist, be the user's, not be in the trash, and not be read-only. */
function liveCheck(db: DB, userId: string, id: string): 'ok' | 'not-found' | 'trashed' | 'read-only' {
  const r = db.prepare('SELECT deleted_at, read_only FROM notes WHERE id = ? AND user_id = ?').get(id, userId) as
    | { deleted_at: string | null; read_only: number }
    | undefined;
  if (!r) return 'not-found';
  if (r.read_only) return 'read-only';
  return r.deleted_at ? 'trashed' : 'ok';
}

/**
 * Makes a note read-only. From then on nothing about it can change through the web app;
 * only `jot unlock-note` makes it writable again. A note in the trash cannot be made read-only.
 */
export function makeReadOnly(db: DB, userId: string, id: string): Note | 'not-found' | 'trashed' {
  return db.transaction(() => {
    const state = liveCheck(db, userId, id);
    if (state === 'not-found' || state === 'trashed') return state;
    db.prepare('UPDATE notes SET read_only = 1 WHERE id = ? AND user_id = ?').run(id, userId);
    return getNote(db, userId, id)!;
  })();
}

/** For `jot unlock-note`: makes any user's read-only note writable again. */
export function unlockNote(db: DB, id: string): { title: string; username: string; result: 'unlocked' | 'not-read-only' } | null {
  return db.transaction(() => {
    const r = db.prepare('SELECT n.title, n.read_only, u.username FROM notes n JOIN users u ON u.id = n.user_id WHERE n.id = ?').get(id) as
      | { title: string; read_only: number; username: string }
      | undefined;
    if (!r) return null;
    if (!r.read_only) return { title: r.title, username: r.username, result: 'not-read-only' as const };
    db.prepare('UPDATE notes SET read_only = 0 WHERE id = ?').run(id);
    return { title: r.title, username: r.username, result: 'unlocked' as const };
  })();
}

export function updateNote(db: DB, userId: string, id: string, patch: { title?: string; content?: NoteContent }): UpdateResult {
  return db.transaction((): UpdateResult => {
    const state = liveCheck(db, userId, id);
    if (state !== 'ok') return state;
    // Strictly increasing, so the list order always reflects the latest edit.
    const prev = (db.prepare('SELECT updated_at FROM notes WHERE id = ?').get(id) as { updated_at: string }).updated_at;
    let t = now();
    if (t <= prev) t = new Date(new Date(prev).getTime() + 1).toISOString();
    if (patch.title !== undefined) db.prepare('UPDATE notes SET title = ? WHERE id = ? AND user_id = ?').run(patch.title, id, userId);
    if (patch.content !== undefined) {
      db.prepare('UPDATE notes SET content = ?, body_text = ? WHERE id = ? AND user_id = ?').run(
        JSON.stringify(patch.content),
        contentText(patch.content),
        id,
        userId,
      );
    }
    db.prepare('UPDATE notes SET updated_at = ? WHERE id = ? AND user_id = ?').run(t, id, userId);
    reindexNote(db, id);
    return getNote(db, userId, id)!;
  })();
}

export function addTag(db: DB, userId: string, id: string, tag: string): UpdateResult {
  return db.transaction((): UpdateResult => {
    const state = liveCheck(db, userId, id);
    if (state !== 'ok') return state;
    db.prepare('INSERT OR IGNORE INTO tags (id, user_id, name) VALUES (?, ?, ?)').run(newId(), userId, tag);
    const tagId = (db.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?').get(userId, tag) as { id: string }).id;
    db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id, user_id) VALUES (?, ?, ?)').run(id, tagId, userId);
    reindexNote(db, id);
    return getNote(db, userId, id)!;
  })();
}

export function removeTag(db: DB, userId: string, id: string, tag: string): UpdateResult {
  return db.transaction((): UpdateResult => {
    const state = liveCheck(db, userId, id);
    if (state !== 'ok') return state;
    db.prepare(
      'DELETE FROM note_tags WHERE note_id = ? AND user_id = ? AND tag_id IN (SELECT id FROM tags WHERE user_id = ? AND name = ?)',
    ).run(id, userId, userId, tag);
    deleteOrphanTags(db, userId);
    reindexNote(db, id);
    return getNote(db, userId, id)!;
  })();
}

/** Moves a live note to the trash. Returns null if the user has no such note. A read-only note cannot be trashed. */
export function trashNote(db: DB, userId: string, id: string): Note | null | 'read-only' {
  return db.transaction(() => {
    if (liveCheck(db, userId, id) === 'read-only') return 'read-only' as const;
    const r = db.prepare('UPDATE notes SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ? AND user_id = ?').run(now(), id, userId);
    if (r.changes === 0) return null;
    reindexNote(db, id);
    return getNote(db, userId, id);
  })();
}

/** A body with nothing in it: empty paragraphs for docs, or no populated cells for sheets. */
function isEmptyContent(json: string, kind: string): boolean {
  try {
    const parsed = JSON.parse(json);
    if (kind === 'sheet') return isEmptySheet(parsed as SheetDoc);
    const nodes = (parsed as TiptapDoc).content ?? [];
    return nodes.every((n) => n.type === 'paragraph' && !n.content?.length);
  } catch {
    return false;
  }
}

/**
 * The user's empty notes: live, on the home page (not in the inbox), not read-only, with
 * no title, no tags and nothing in the body (a photo, a table, a rule or a sheet cell is something).
 */
function emptyNoteIds(db: DB, userId: string, section: string): string[] {
  const rows = db
    .prepare(
      `SELECT n.id, n.kind, n.title, n.content FROM notes n
        WHERE n.user_id = ? AND n.section_id = ? AND n.deleted_at IS NULL AND n.inbox = 0 AND n.read_only = 0
          AND NOT EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id)`,
    )
    .all(userId, section) as Array<{ id: string; kind: string; title: string; content: string }>;
  return rows.filter((r) => r.title.trim() === '' && isEmptyContent(r.content, r.kind)).map((r) => r.id);
}

export function countEmptyNotes(db: DB, userId: string, section: string): number {
  return emptyNoteIds(db, userId, section).length;
}

/** Moves every empty note of the section to the trash, in one transaction. Returns how many. */
export function trashEmptyNotes(db: DB, userId: string, section: string): number {
  return db.transaction(() => {
    const ids = emptyNoteIds(db, userId, section);
    const t = now();
    const trash = db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ? AND user_id = ?');
    for (const id of ids) {
      trash.run(t, id, userId);
      reindexNote(db, id);
    }
    return ids.length;
  })();
}

/** Restores a trashed note. Returns null unless the user has this note in the trash. */
export function restoreNote(db: DB, userId: string, id: string): Note | null {
  return db.transaction(() => {
    const r = db.prepare('UPDATE notes SET deleted_at = NULL WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL').run(id, userId);
    if (r.changes === 0) return null;
    reindexNote(db, id);
    return getNote(db, userId, id);
  })();
}

/** Permanently deletes a trashed note. Returns false unless the user has it in the trash. */
export function purgeNote(db: DB, userId: string, id: string): boolean {
  return db.transaction(() => {
    const r = db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL').run(id, userId);
    if (r.changes === 0) return false;
    db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(id);
    deleteOrphanTags(db, userId);
    return true;
  })();
}

/** Permanently deletes every note in the section's trash. Photos stay on disk, as with purgeNote. */
export function emptyTrash(db: DB, userId: string, section: string): number {
  return db.transaction(() => {
    const ids = (
      db.prepare('SELECT id FROM notes WHERE user_id = ? AND section_id = ? AND deleted_at IS NOT NULL').all(userId, section) as Array<{ id: string }>
    ).map((r) => r.id);
    const delFts = db.prepare('DELETE FROM notes_fts WHERE note_id = ?');
    for (const id of ids) delFts.run(id); // trashed notes have no index row; kept exact anyway
    db.prepare('DELETE FROM notes WHERE user_id = ? AND section_id = ? AND deleted_at IS NOT NULL').run(userId, section);
    deleteOrphanTags(db, userId);
    return ids.length;
  })();
}

/** The Inbox: notes bots wrote that the user has not kept yet, newest first. */
export function listInbox(db: DB, userId: string): NoteSummary[] {
  const rows = db
    .prepare(`SELECT ${SUMMARY_COLS} FROM notes n WHERE n.user_id = ? AND n.deleted_at IS NULL AND n.inbox = 1 ORDER BY n.created_at DESC, n.id`)
    .all(userId) as NoteRow[];
  return rows.map(toSummary);
}

/** Keep: moves a note out of the Inbox into the given (current) section. The bot's name stays. */
export function keepNote(db: DB, userId: string, id: string, section: string): UpdateResult {
  return db.transaction((): UpdateResult => {
    const state = liveCheck(db, userId, id);
    if (state !== 'ok') return state;
    db.prepare('UPDATE notes SET inbox = 0, section_id = ? WHERE id = ? AND user_id = ?').run(section, id, userId);
    return getNote(db, userId, id)!;
  })();
}

/** Moves a note to another section. Only its section changes (not even its dates). Read-only and trashed notes cannot be moved. */
export function moveNote(db: DB, userId: string, id: string, section: string): UpdateResult {
  return db.transaction((): UpdateResult => {
    const state = liveCheck(db, userId, id);
    if (state !== 'ok') return state;
    db.prepare('UPDATE notes SET section_id = ? WHERE id = ? AND user_id = ?').run(section, id, userId);
    return getNote(db, userId, id)!;
  })();
}

/** A note a bot wrote: in the Inbox and the Default section, with the bot's name copied onto it. The caller runs this in a transaction. */
export function createBotNote(
  db: DB,
  userId: string,
  n: { title: string; content: TiptapDoc; tags: string[]; botName: string; requestId: string | null },
): Note {
  const id = newId();
  const t = now();
  db.prepare(
    `INSERT INTO notes (id, user_id, title, content, body_text, created_at, updated_at, deleted_at, inbox, bot_name, bot_request_id, section_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, 'default')`,
  ).run(id, userId, n.title, JSON.stringify(n.content), docText(n.content), t, t, n.botName, n.requestId);
  for (const tag of n.tags) {
    db.prepare('INSERT OR IGNORE INTO tags (id, user_id, name) VALUES (?, ?, ?)').run(newId(), userId, tag);
    const tagId = (db.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?').get(userId, tag) as { id: string }).id;
    db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id, user_id) VALUES (?, ?, ?)').run(id, tagId, userId);
  }
  reindexNote(db, id);
  return getNote(db, userId, id)!;
}

/** The note a bot already made for this request_id, if any (so retries are safe). */
export function findBotRequest(db: DB, userId: string, botName: string, requestId: string): { id: string; title: string } | null {
  return (
    (db.prepare('SELECT id, title FROM notes WHERE user_id = ? AND bot_name = ? AND bot_request_id = ?').get(userId, botName, requestId) as
      | { id: string; title: string }
      | undefined) ?? null
  );
}

/** Tags on live notes outside the Inbox: of one section (the home page's chips), or of all of them (the Tags page). */
export function listTags(db: DB, userId: string, section?: string): Tag[] {
  return db
    .prepare(
      `SELECT t.name AS name, COUNT(*) AS count FROM tags t
       JOIN note_tags nt ON nt.tag_id = t.id
       JOIN notes n ON n.id = nt.note_id
       WHERE t.user_id = ? AND n.user_id = ? AND n.deleted_at IS NULL AND n.inbox = 0 AND (? IS NULL OR n.section_id = ?)
       GROUP BY t.id ORDER BY t.name`,
    )
    .all(userId, userId, section ?? null, section ?? null) as Tag[];
}

export type DeleteTagResult = { removedFrom: number } | { readOnly: number } | 'not-found';

/**
 * Deletes a tag: removes it from every note of the user that carries it (live, in the
 * Inbox or in the trash, so restoring a note cannot bring the tag back). The notes stay.
 * Refused while a read-only note carries the tag, because a read-only note cannot change.
 */
export function deleteTag(db: DB, userId: string, tag: string): DeleteTagResult {
  return db.transaction((): DeleteTagResult => {
    const t = db.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?').get(userId, tag) as { id: string } | undefined;
    if (!t) return 'not-found';
    const rows = db
      .prepare('SELECT n.id AS id, n.read_only AS read_only FROM note_tags nt JOIN notes n ON n.id = nt.note_id WHERE nt.tag_id = ? AND nt.user_id = ? AND n.user_id = ?')
      .all(t.id, userId, userId) as Array<{ id: string; read_only: number }>;
    const readOnly = rows.filter((r) => r.read_only).length;
    if (readOnly > 0) return { readOnly };
    db.prepare('DELETE FROM note_tags WHERE tag_id = ? AND user_id = ?').run(t.id, userId);
    db.prepare('DELETE FROM tags WHERE id = ? AND user_id = ?').run(t.id, userId);
    for (const r of rows) reindexNote(db, r.id);
    return { removedFrom: rows.length };
  })();
}

export function searchNotes(db: DB, userId: string, section: string, q: unknown): NoteSummary[] {
  const match = buildFtsQuery(q);
  if (!match) return [];
  try {
    const rows = db
      .prepare(
        `SELECT ${SUMMARY_COLS} FROM notes_fts f JOIN notes n ON n.id = f.note_id
         WHERE notes_fts MATCH ? AND f.user_id = ? AND n.user_id = ? AND n.section_id = ? AND n.deleted_at IS NULL AND n.inbox = 0
         ORDER BY f.rank, n.updated_at DESC LIMIT 200`,
      )
      .all(match, userId, userId, section) as NoteRow[];
    return rows.map(toSummary);
  } catch (err) {
    // buildFtsQuery only produces valid expressions; a syntax error here is a last line
    // of defence. Any other database error is a real failure and is not hidden.
    if (err instanceof Error && /fts5: syntax error|malformed MATCH/i.test(err.message)) return [];
    throw err;
  }
}
