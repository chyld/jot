// Section rules (sections-spec.md §1), shared by the server (authoritative) and the
// Sections page. A section's ID follows the tag rules; its name is what the interface
// shows; its colour is one of six names (the client's theme.ts holds their values).
import { normalizeTag } from './tags';

export const SECTION_COLOURS = ['olive', 'blue', 'violet', 'amber', 'teal', 'slate'] as const;
export type SectionColour = (typeof SECTION_COLOURS)[number];

/** Every user has this section, created with the account. It cannot be deleted (every other section can). */
export const DEFAULT_SECTION_ID = 'default';
export const MAX_SECTION_NAME = 60;

export interface Section {
  id: string;
  name: string;
  colour: SectionColour;
  /** Live notes on the section's home page (not trashed, not in the Inbox). */
  noteCount: number;
  /** Notes in the section's trash (its Trash screen). */
  trashCount: number;
}

export type SectionIdResult = { ok: true; id: string } | { ok: false; error: string };
export type SectionNameResult = { ok: true; name: string } | { ok: false; error: string };

/** The tag rules: letters a–z only, 1 to 30 characters; uppercase is lowercased. */
export function normalizeSectionId(input: unknown): SectionIdResult {
  const r = normalizeTag(input);
  if (r.ok) return { ok: true, id: r.tag };
  return { ok: false, error: 'A section ID is 1 to 30 letters a–z (no digits, hyphens, spaces or accents).' };
}

export function normalizeSectionName(input: unknown): SectionNameResult {
  if (typeof input !== 'string') return { ok: false, error: 'The name must be text.' };
  const name = input.trim();
  if (!name) return { ok: false, error: 'The name cannot be empty.' };
  if (name.length > MAX_SECTION_NAME) return { ok: false, error: `The name can be at most ${MAX_SECTION_NAME} characters.` };
  return { ok: true, name };
}

export function isSectionColour(v: unknown): v is SectionColour {
  return typeof v === 'string' && (SECTION_COLOURS as readonly string[]).includes(v);
}

/**
 * What the delete confirmation says: "Delete Bob's Work? Its 3 notes and 2 trashed notes
 * move to Default." (`defaultName` is the Default section's name, which can be changed.)
 */
export function deleteSectionMessage(s: Pick<Section, 'name' | 'noteCount' | 'trashCount'>, defaultName: string): string {
  const parts: string[] = [];
  if (s.noteCount) parts.push(s.noteCount === 1 ? '1 note' : `${s.noteCount} notes`);
  if (s.trashCount) parts.push(s.trashCount === 1 ? '1 trashed note' : `${s.trashCount} trashed notes`);
  if (!parts.length) return `Delete ${s.name}? It has no notes.`;
  const one = s.noteCount + s.trashCount === 1;
  return `Delete ${s.name}? Its ${parts.join(' and ')} ${one ? 'moves' : 'move'} to ${defaultName}.`;
}
