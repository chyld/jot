// The current section (sections-spec.md §2): one small store. It holds the user's
// sections and the current one, remembers the current one in this browser (local storage,
// per user, shared by every tab), and gives the API client the ID it adds to requests.
// Nothing remembered, or a remembered section that does not exist, means Default.
import { useSyncExternalStore } from 'react';
import { DEFAULT_SECTION_ID, type Section } from '../shared/sections';

interface State {
  userId: string | null;
  /** The current section's ID. */
  current: string;
  /** Default first, then in the order they were created (as the server lists them). */
  sections: Section[];
}

/** Until the list has loaded (or if it cannot be): only Default. */
const DEFAULT_ONLY: Section[] = [{ id: DEFAULT_SECTION_ID, name: 'Default', colour: 'olive', noteCount: 0, trashCount: 0 }];

let state: State = { userId: null, current: DEFAULT_SECTION_ID, sections: DEFAULT_ONLY };
const listeners = new Set<() => void>();
const storageKey = (userId: string) => `jot.section.${userId}`;

function update(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

/** The current section's ID, for the API client. */
export function currentSectionId(): string {
  return state.current;
}

/** Starts the store for a logged-in user, in the section this browser remembers. */
export function startSections(userId: string) {
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(storageKey(userId));
  } catch {
    remembered = null;
  }
  state = { userId, current: remembered || DEFAULT_SECTION_ID, sections: DEFAULT_ONLY };
}

/** The user's sections as just fetched. A current section that is not among them becomes Default. */
export function setSections(list: Section[]) {
  const sections = list.length ? list : DEFAULT_ONLY;
  update({ sections, current: sections.some((s) => s.id === state.current) ? state.current : DEFAULT_SECTION_ID });
}

/** Makes a section current and remembers it in this browser. */
export function setCurrentSection(id: string) {
  if (id === state.current) return;
  try {
    if (state.userId) localStorage.setItem(storageKey(state.userId), id);
  } catch {
    /* not remembered; it is still current in this page */
  }
  update({ current: id });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The sections and the current one; re-renders when either changes. */
export function useSections(): { sections: Section[]; current: Section } {
  const s = useSyncExternalStore(subscribe, () => state);
  return { sections: s.sections, current: s.sections.find((x) => x.id === s.current) ?? s.sections[0] };
}
