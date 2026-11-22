// Type 3 (unit): the shared section rules (sections-spec.md §1): the ID follows the tag
// rules, the name is 1 to 60 characters, and the colour is one of six; and the section
// list's note and trash counts; what the delete confirmation says.
import { describe, expect, it } from 'vitest';
import { deleteSectionMessage, isSectionColour, normalizeSectionId, normalizeSectionName, SECTION_COLOURS } from '../../src/shared/sections';
import { THEMES } from '../../src/client/theme';
import { now, openDatabase } from '../../src/server/db';
import { createNote, trashNote } from '../../src/server/notes';
import { addDefaultSection, createSection, listSections } from '../../src/server/sections';

describe('section IDs', () => {
  it('are letters a–z, 1 to 30, with uppercase lowercased', () => {
    expect(normalizeSectionId('recipe')).toEqual({ ok: true, id: 'recipe' });
    expect(normalizeSectionId(' Work ')).toEqual({ ok: true, id: 'work' });
    expect(normalizeSectionId('a'.repeat(30))).toEqual({ ok: true, id: 'a'.repeat(30) });
  });
  it.each([[''], ['a'.repeat(31)], ['two words'], ['demo1'], ['with-dash'], ['café'], ['#tag'], [42], [null]])('refuses %j', (v) => {
    const r = normalizeSectionId(v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ID/);
  });
});

describe('section names', () => {
  it('are trimmed, 1 to 60 characters', () => {
    expect(normalizeSectionName("  Bob's Recipes ")).toEqual({ ok: true, name: "Bob's Recipes" });
    expect(normalizeSectionName('n'.repeat(60)).ok).toBe(true);
    for (const v of ['', '   ', 'n'.repeat(61), 3, undefined]) expect(normalizeSectionName(v).ok).toBe(false);
  });
});

describe('colours', () => {
  it('are the twelve, with no rose or pink', () => {
    expect(SECTION_COLOURS).toEqual([
      'olive',
      'forest',
      'teal',
      'cyan',
      'blue',
      'indigo',
      'violet',
      'plum',
      'crimson',
      'terracotta',
      'amber',
      'slate',
    ]);
    expect(isSectionColour('teal')).toBe(true);
    expect(isSectionColour('terracotta')).toBe(true);
    for (const v of ['pink', 'rose', 'Olive', '', null]) expect(isSectionColour(v)).toBe(false);
  });
  it('each have the same eight values, and Olive is today’s theme', () => {
    for (const c of SECTION_COLOURS) {
      expect(Object.keys(THEMES[c]).sort()).toEqual(['accent', 'accentDark', 'appBg', 'border', 'hover', 'muted', 'soft', 'text']);
      for (const v of Object.values(THEMES[c])) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(THEMES.olive).toEqual({ accent: '#4d7c0f', accentDark: '#3f6212', soft: '#e4f2c4', appBg: '#f7f9f1', border: '#e0e8cd', hover: '#eef5dc', text: '#1d2610', muted: '#6b7557' });
  });
});

describe('the section list', () => {
  it('gives each section its number of notes and of trashed notes', () => {
    const db = openDatabase(':memory:');
    db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1', 'alice', 'x', ?)").run(now());
    addDefaultSection(db, 'u1', now());
    createSection(db, 'u1', { id: 'work', name: 'Work', colour: 'blue' });
    const live = createNote(db, 'u1', 'work', 'Live', undefined);
    for (const title of ['Binned', 'Binned too']) trashNote(db, 'u1', createNote(db, 'u1', 'work', title, undefined).id);
    trashNote(db, 'u1', createNote(db, 'u1', 'default', 'Old', undefined).id);
    expect(listSections(db, 'u1').map((s) => [s.id, s.noteCount, s.trashCount])).toEqual([
      ['default', 0, 1],
      ['work', 1, 2],
    ]);
    trashNote(db, 'u1', live.id);
    expect(listSections(db, 'u1').map((s) => [s.id, s.noteCount, s.trashCount])).toEqual([
      ['default', 0, 1],
      ['work', 0, 3],
    ]);
    db.close();
  });
});

describe('the delete confirmation', () => {
  const msg = (noteCount: number, trashCount: number, defaultName = 'Default') => deleteSectionMessage({ name: "Bob's Work", noteCount, trashCount }, defaultName);
  it('says how many notes and trashed notes move to Default', () => {
    expect(msg(3, 2)).toBe("Delete Bob's Work? Its 3 notes and 2 trashed notes move to Default.");
    expect(msg(1, 1)).toBe("Delete Bob's Work? Its 1 note and 1 trashed note move to Default.");
    expect(msg(1, 0)).toBe("Delete Bob's Work? Its 1 note moves to Default.");
    expect(msg(0, 1)).toBe("Delete Bob's Work? Its 1 trashed note moves to Default.");
    expect(msg(0, 4)).toBe("Delete Bob's Work? Its 4 trashed notes move to Default.");
    expect(msg(0, 0)).toBe("Delete Bob's Work? It has no notes.");
  });
  it('names Default by its current name', () => {
    expect(msg(2, 0, 'Home')).toBe("Delete Bob's Work? Its 2 notes move to Home.");
  });
});
