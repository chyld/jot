// Thin JSON client for Jot's API.
import type { BackupInfo, Bot, CatalogFont, Font, Note, NoteSummary, Photo, RestoreSummary, SafetyBackup, Tag, User } from '../shared/types';
import type { Section, SectionColour } from '../shared/sections';
import type { Style, StyleInput } from '../shared/styles';
import { currentSectionId } from './currentSection';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** e.g. "restore-in-progress" or "busy": a temporary refusal worth retrying. */
    public code?: string,
  ) {
    super(message);
  }
}

/** Called when any request finds the session gone (set by the app shell). */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body instanceof Blob) {
    // A backup file: sent as the raw file, streamed by the browser.
    init.body = body;
    (init.headers as Record<string, string>)['content-type'] = 'application/x-tar';
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  const res = await fetch(url, init);
  if (res.status === 204) return undefined as T;
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && url !== '/api/login' && url !== '/api/me') onUnauthorized();
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status}).`, typeof data?.code === 'string' ? data.code : undefined);
  }
  return data as T;
}

/** Adds the current section to a request that works on it (sections-spec.md §2). */
function inSection(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}section=${encodeURIComponent(currentSectionId())}`;
}

export const api = {
  me: () => request<{ user: User }>('GET', '/api/me'),
  login: (username: string, password: string) => request<{ user: User }>('POST', '/api/login', { username, password }),
  logout: () => request<void>('POST', '/api/logout', {}),

  notes: (tag?: string) => request<{ notes: NoteSummary[] }>('GET', inSection(tag ? `/api/notes?tag=${encodeURIComponent(tag)}` : '/api/notes')),
  search: (q: string) => request<{ notes: NoteSummary[] }>('GET', inSection(`/api/search?q=${encodeURIComponent(q)}`)),
  note: (id: string) => request<{ note: Note }>('GET', `/api/notes/${encodeURIComponent(id)}`),
  createNote: () => request<{ note: Note }>('POST', inSection('/api/notes'), {}),
  moveNote: (id: string, section: string) => request<{ note: Note }>('POST', `/api/notes/${encodeURIComponent(id)}/section`, { section }),
  updateNote: (id: string, patch: { title?: string; content?: unknown }) =>
    request<{ note: Note }>('PATCH', `/api/notes/${encodeURIComponent(id)}`, patch),
  inbox: () => request<{ notes: NoteSummary[] }>('GET', '/api/inbox'),
  keep: (id: string) => request<{ note: Note }>('POST', inSection(`/api/notes/${encodeURIComponent(id)}/keep`), {}),
  bots: () => request<{ publicUrl: string; mcpUrl: string; bots: Bot[] }>('GET', '/api/bots'),
  createBot: (name: string) => request<{ bot: Bot }>('POST', '/api/bots', { name }),
  revokeBot: (id: string) => request<void>('DELETE', `/api/bots/${encodeURIComponent(id)}`),
  makeReadOnly: (id: string) => request<{ note: Note }>('POST', `/api/notes/${encodeURIComponent(id)}/read-only`, {}),
  trashNote: (id: string) => request<{ note: Note }>('DELETE', `/api/notes/${encodeURIComponent(id)}`),
  addTag: (id: string, tag: string) => request<{ note: Note }>('POST', `/api/notes/${encodeURIComponent(id)}/tags`, { tag }),
  removeTag: (id: string, tag: string) =>
    request<{ note: Note }>('DELETE', `/api/notes/${encodeURIComponent(id)}/tags/${encodeURIComponent(tag)}`),
  /** Every tag, across all sections (the Tags page). */
  tags: () => request<{ tags: Tag[] }>('GET', '/api/tags'),
  /** The current section's tags (the home page's chips). */
  sectionTags: () => request<{ tags: Tag[] }>('GET', inSection('/api/tags')),
  deleteTag: (tag: string) => request<{ tag: string; removedFrom: number }>('DELETE', `/api/tags/${encodeURIComponent(tag)}`),

  sections: () => request<{ sections: Section[] }>('GET', '/api/sections'),
  createSection: (s: { id: string; name: string; colour: SectionColour }) => request<{ section: Section }>('POST', '/api/sections', s),
  updateSection: (id: string, s: { name: string; colour: SectionColour }) =>
    request<{ section: Section }>('PATCH', `/api/sections/${encodeURIComponent(id)}`, s),
  deleteSection: (id: string) => request<{ moved: number }>('DELETE', `/api/sections/${encodeURIComponent(id)}`),

  trash: () => request<{ notes: NoteSummary[] }>('GET', inSection('/api/trash')),
  restore: (id: string) => request<{ note: Note }>('POST', `/api/trash/${encodeURIComponent(id)}/restore`, {}),
  purge: (id: string) => request<void>('DELETE', `/api/trash/${encodeURIComponent(id)}`),
  emptyTrash: () => request<{ deleted: number }>('DELETE', inSection('/api/trash')),
  emptyNotes: () => request<{ count: number }>('GET', inSection('/api/empty-notes')),
  trashEmptyNotes: () => request<{ trashed: number }>('DELETE', inSection('/api/empty-notes')),

  uploadPhoto: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ photo: Photo }>('POST', '/api/photos', fd);
  },

  catalog: () => request<{ fonts: CatalogFont[] }>('GET', '/api/fonts/catalog'),
  fonts: () => request<{ fonts: Font[] }>('GET', '/api/fonts'),
  addFont: (family: string) => request<{ font: Font }>('POST', '/api/fonts', { family }),
  archiveFont: (id: string) => request<{ font: Font }>('POST', `/api/fonts/${encodeURIComponent(id)}/archive`, {}),
  unarchiveFont: (id: string) => request<{ font: Font }>('POST', `/api/fonts/${encodeURIComponent(id)}/unarchive`, {}),

  styles: () => request<{ styles: Style[] }>('GET', '/api/styles'),
  createStyle: (s: StyleInput) => request<{ style: Style }>('POST', '/api/styles', s),
  updateStyle: (id: string, s: StyleInput) => request<{ style: Style }>('PUT', `/api/styles/${encodeURIComponent(id)}`, s),
  deleteStyle: (id: string) => request<void>('DELETE', `/api/styles/${encodeURIComponent(id)}`),

  makeBackup: () => request<{ backup: BackupInfo }>('POST', '/api/backup', {}),
  backupUrl: (id: string) => `/api/backup/${encodeURIComponent(id)}`,
  stageRestore: (file: File) => request<{ restore: { id: string; summary: RestoreSummary } }>('POST', '/api/restore', file),
  confirmRestore: (id: string) => request<{ restored: RestoreSummary }>('POST', `/api/restore/${encodeURIComponent(id)}/confirm`, { confirm: 'RESTORE' }),
  cancelRestore: (id: string) => request<void>('DELETE', `/api/restore/${encodeURIComponent(id)}`),
  safetyBackups: () => request<{ backups: SafetyBackup[] }>('GET', '/api/safety-backups'),
  safetyBackupUrl: (name: string) => `/api/safety-backups/${encodeURIComponent(name)}`,
  deleteSafetyBackup: (name: string) => request<void>('DELETE', `/api/safety-backups/${encodeURIComponent(name)}`),
};
