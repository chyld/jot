// Notes, tags, trash and search. Every function takes the owner's user id and every
// query filters by it. The FTS5 index holds exactly one row per live (non-trashed)
// note and is rewritten in the same transaction as any change that affects it.
import type { Note, NoteSummary, Tag, TiptapDoc } from '../shared/types';
import { docText, emptyDoc, previewOf } from './content';
import { now, type DB } from './db';
import { newId } from './ids';
import { buildFtsQuery } from './search';

interface NoteRow {
  id: string;
  user_id: string;
  title: string;
  content?: string;
  body_text: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  tag_list: string | null;
}

const SUMMARY_COLS = `n.id, n.user_id, n.title, n.body_text, n.created_at, n.updated_at, n.deleted_at,
  (SELECT group_concat(t.name, ' ' ORDER BY t.name) FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
     WHERE nt.note_id = n.id) AS tag_list`;

function toSummary(r: NoteRow): NoteSummary {
  return {
    id: r.id,
    title: r.title,
    preview: previewOf(r.body_text),
    tags: r.tag_list ? r.tag_list.split(' ') : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
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
  return { ...toSummary(r), content: JSON.parse(r.content!) as TiptapDoc };
}

export function listNotes(db: DB, userId: string, tag?: string): NoteSummary[] {
  const rows = tag
    ? db
        .prepare(
          `SELECT ${SUMMARY_COLS} FROM notes n WHERE n.user_id = ? AND n.deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
                       WHERE nt.note_id = n.id AND t.user_id = ? AND t.name = ?)
           ORDER BY n.updated_at DESC, n.id`,
        )
        .all(userId, userId, tag)
    : db
        .prepare(`SELECT ${SUMMARY_COLS} FROM notes n WHERE n.user_id = ? AND n.deleted_at IS NULL ORDER BY n.updated_at DESC, n.id`)
        .all(userId);
  return (rows as NoteRow[]).map(toSummary);
}

export function listTrash(db: DB, userId: string): NoteSummary[] {
  const rows = db
    .prepare(`SELECT ${SUMMARY_COLS} FROM notes n WHERE n.user_id = ? AND n.deleted_at IS NOT NULL ORDER BY n.deleted_at DESC, n.id`)
    .all(userId) as NoteRow[];
  return rows.map(toSummary);
}

export function createNote(db: DB, userId: string, title: string, content: TiptapDoc | undefined): Note {
  const id = newId();
  const doc = content ?? emptyDoc();
  const t = now();
  db.transaction(() => {
    db.prepare(
      'INSERT INTO notes (id, user_id, title, content, body_text, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
    ).run(id, userId, title, JSON.stringify(doc), docText(doc), t, t);
    reindexNote(db, id);
  })();
  return getNote(db, userId, id)!;
}

export type UpdateResult = Note | 'not-found' | 'trashed';

function liveCheck(db: DB, userId: string, id: string): 'ok' | 'not-found' | 'trashed' {
  const r = db.prepare('SELECT deleted_at FROM notes WHERE id = ? AND user_id = ?').get(id, userId) as { deleted_at: string | null } | undefined;
  if (!r) return 'not-found';
  return r.deleted_at ? 'trashed' : 'ok';
}

export function updateNote(db: DB, userId: string, id: string, patch: { title?: string; content?: TiptapDoc }): UpdateResult {
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
        docText(patch.content),
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

/** Moves a live note to the trash. Returns null if the user has no such note. */
export function trashNote(db: DB, userId: string, id: string): Note | null {
  return db.transaction(() => {
    const r = db.prepare('UPDATE notes SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ? AND user_id = ?').run(now(), id, userId);
    if (r.changes === 0) return null;
    reindexNote(db, id);
    return getNote(db, userId, id);
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

/** Permanently deletes every note in the user's trash. Photos stay on disk, as with purgeNote. */
export function emptyTrash(db: DB, userId: string): number {
  return db.transaction(() => {
    const ids = (db.prepare('SELECT id FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL').all(userId) as Array<{ id: string }>).map((r) => r.id);
    const delFts = db.prepare('DELETE FROM notes_fts WHERE note_id = ?');
    for (const id of ids) delFts.run(id); // trashed notes have no index row; kept exact anyway
    db.prepare('DELETE FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL').run(userId);
    deleteOrphanTags(db, userId);
    return ids.length;
  })();
}

export function listTags(db: DB, userId: string): Tag[] {
  return db
    .prepare(
      `SELECT t.name AS name, COUNT(*) AS count FROM tags t
       JOIN note_tags nt ON nt.tag_id = t.id
       JOIN notes n ON n.id = nt.note_id
       WHERE t.user_id = ? AND n.user_id = ? AND n.deleted_at IS NULL
       GROUP BY t.id ORDER BY t.name`,
    )
    .all(userId, userId) as Tag[];
}

export function searchNotes(db: DB, userId: string, q: unknown): NoteSummary[] {
  const match = buildFtsQuery(q);
  if (!match) return [];
  try {
    const rows = db
      .prepare(
        `SELECT ${SUMMARY_COLS} FROM notes_fts f JOIN notes n ON n.id = f.note_id
         WHERE notes_fts MATCH ? AND f.user_id = ? AND n.user_id = ? AND n.deleted_at IS NULL
         ORDER BY f.rank, n.updated_at DESC LIMIT 200`,
      )
      .all(match, userId, userId) as NoteRow[];
    return rows.map(toSummary);
  } catch (err) {
    // buildFtsQuery only produces valid expressions; a syntax error here is a last line
    // of defence. Any other database error is a real failure and is not hidden.
    if (err instanceof Error && /fts5: syntax error|malformed MATCH/i.test(err.message)) return [];
    throw err;
  }
}
