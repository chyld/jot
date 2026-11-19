// Shapes shared by the API and the browser.
export interface User {
  id: string;
  username: string;
}

export interface NoteSummary {
  id: string;
  title: string;
  preview: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Note extends NoteSummary {
  content: TiptapDoc;
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

export interface TiptapDoc extends TiptapNode {
  type: 'doc';
}

export interface Font {
  id: string;
  family: string;
  category: string;
  archived: boolean;
  /** One of the five starter fonts: it can never be archived. */
  isDefault: boolean;
  createdAt: string;
}

export interface CatalogFont {
  family: string;
  category: string;
}

export interface Tag {
  name: string;
  count: number;
}

export interface Photo {
  id: string;
  url: string;
  mime: string;
}

export interface MissingFile {
  name: string;
  what: string;
}

export interface BackupCounts {
  notes: number;
  photos: number;
  fonts: number;
  styles: number;
}

/** A personal backup built for download. */
export interface BackupInfo {
  id: string;
  name: string;
  size: number;
  counts: BackupCounts;
  missing: MissingFile[];
}

/** What a restore will bring back, shown before the user confirms. */
export interface RestoreSummary {
  createdAt: string;
  counts: BackupCounts;
  adjustedNotes: number;
  missing: MissingFile[];
}

export interface SafetyBackup {
  name: string;
  size: number;
  createdAt: string;
}
