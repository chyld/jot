// Sections (sections-spec.md): the `sections` table and every section rule. Every user
// has a Default section; sections can be created, renamed and recoloured, never deleted.
// Every query filters by the owner, and a section is known by (user, ID).
import {
  DEFAULT_SECTION_ID,
  isSectionColour,
  normalizeSectionId,
  normalizeSectionName,
  type Section,
  type SectionColour,
} from '../shared/sections';
import { now, type DB } from './db';

export class SectionError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const COLOUR_ERROR = 'Choose one of the six colours.';

/** Gives a user their Default section (new accounts and the upgrade). */
export function addDefaultSection(db: DB, userId: string, at: string) {
  db.prepare("INSERT INTO sections (user_id, id, name, colour, created_at) VALUES (?, ?, 'Default', 'olive', ?)").run(userId, DEFAULT_SECTION_ID, at);
}

/** Default first, then in the order they were created. */
export function listSections(db: DB, userId: string): Section[] {
  return db
    .prepare(
      `SELECT s.id, s.name, s.colour,
         (SELECT COUNT(*) FROM notes n WHERE n.user_id = s.user_id AND n.section_id = s.id AND n.deleted_at IS NULL AND n.inbox = 0) AS noteCount
       FROM sections s WHERE s.user_id = ?
       ORDER BY s.id <> ?, s.created_at, s.rowid`,
    )
    .all(userId, DEFAULT_SECTION_ID) as Section[];
}

export function getSection(db: DB, userId: string, id: string): Section | null {
  return listSections(db, userId).find((s) => s.id === id) ?? null;
}

export function sectionExists(db: DB, userId: string, id: unknown): boolean {
  return typeof id === 'string' && !!db.prepare('SELECT 1 FROM sections WHERE user_id = ? AND id = ?').get(userId, id);
}

export function createSection(db: DB, userId: string, input: { id: unknown; name: unknown; colour: unknown }): Section {
  const name = normalizeSectionName(input.name);
  if (!name.ok) throw new SectionError(name.error);
  const id = normalizeSectionId(input.id);
  if (!id.ok) throw new SectionError(id.error);
  if (!isSectionColour(input.colour)) throw new SectionError(COLOUR_ERROR);
  if (sectionExists(db, userId, id.id)) throw new SectionError(`You already have a section with the ID "${id.id}".`, 409);
  db.prepare('INSERT INTO sections (user_id, id, name, colour, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, id.id, name.name, input.colour, now());
  return getSection(db, userId, id.id)!;
}

/** Renames and/or recolours a section. Its ID never changes. */
export function updateSection(db: DB, userId: string, id: string, patch: { name?: unknown; colour?: unknown }): Section {
  if (!sectionExists(db, userId, id)) throw new SectionError('No such section.', 404);
  let name: string | undefined;
  if (patch.name !== undefined) {
    const r = normalizeSectionName(patch.name);
    if (!r.ok) throw new SectionError(r.error);
    name = r.name;
  }
  if (patch.colour !== undefined && !isSectionColour(patch.colour)) throw new SectionError(COLOUR_ERROR);
  const colour = patch.colour as SectionColour | undefined;
  db.prepare('UPDATE sections SET name = COALESCE(?, name), colour = COALESCE(?, colour) WHERE user_id = ? AND id = ?').run(name ?? null, colour ?? null, userId, id);
  return getSection(db, userId, id)!;
}
