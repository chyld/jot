// Reading a backup archive and checking it against its manifest. Shared by the
// personal restore, the read-back check after taking a backup, `jot verify` and
// `jot restore`. Content rules (what the records must look like) are checked by the
// caller; this checks that the archive is exactly what its manifest says:
//   - the manifest is present, last, sealed, and of a known format not newer than Jot;
//   - every entry name matches the fixed patterns, is a plain file, and appears once;
//   - every entry matches its manifest size and SHA-256, with none extra and none
//     missing; the files the manifest lists as missing are really absent.
import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BackupError } from './errors';
import { readManifest } from './manifest';
import { readTar } from './tar';

export interface MissingFile {
  /** The entry name the file would have had. */
  name: string;
  /** A plain description for people, e.g. Photo "beach.jpg". */
  what: string;
}

export interface ManifestEntry {
  name: string;
  size: number;
  sha256: string;
}

export interface ArchiveCheck {
  manifest: Record<string, any> & { createdAt: string; entries: ManifestEntry[]; missing: MissingFile[] };
  /** Entry name -> size and hash, as read. */
  seen: Map<string, { size: number; sha256: string }>;
  /** The order the entries came in. */
  order: string[];
}

export interface ReadOptions {
  format: string;
  version: number;
  isEntry: (name: string) => boolean;
  /** Names the manifest may list as missing (default: isEntry). */
  isMissingName?: (name: string) => boolean;
  /** Where to write an entry's contents, or null to only check it. Each file is created fresh. */
  extract?: (name: string) => string | null;
  /** Called after each entry is read (failpoints). */
  afterEntry?: (index: number) => Promise<void>;
  /** Called with each extracted file's path. */
  onExtracted?: (path: string) => void;
}

const MAX_MANIFEST = 64 * 1024 * 1024;
const HEX64 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

export function describeName(name: string) {
  return JSON.stringify(name.length > 120 ? `${name.slice(0, 120)}…` : name);
}

export async function readArchive(file: string, opts: ReadOptions): Promise<ArchiveCheck> {
  const seen = new Map<string, { size: number; sha256: string }>();
  const order: string[] = [];
  let manifestBytes: Buffer | null = null;
  let index = 0;

  await readTar(file, async (e, chunks) => {
    if (manifestBytes) throw new BackupError('This backup is damaged: its manifest is not the last entry.');
    if (!opts.isEntry(e.name)) throw new BackupError(`This backup contains an entry name that is not allowed: ${describeName(e.name)}.`);
    if (seen.has(e.name)) throw new BackupError(`This backup contains ${describeName(e.name)} twice.`);
    if (e.name === 'manifest.json') {
      if (e.size > MAX_MANIFEST) throw new BackupError('This backup is damaged: its manifest is too large.');
      const parts: Buffer[] = [];
      for await (const c of chunks) parts.push(c);
      manifestBytes = Buffer.concat(parts);
      return;
    }
    const hash = createHash('sha256');
    const dest = opts.extract?.(e.name) ?? null;
    if (dest) {
      await mkdir(dirname(dest), { recursive: true });
      const out = await open(dest, 'wx', 0o600);
      opts.onExtracted?.(dest);
      try {
        let pos = 0;
        for await (const c of chunks) {
          hash.update(c);
          let off = 0;
          while (off < c.length) {
            const { bytesWritten } = await out.write(c, off, c.length - off, pos);
            off += bytesWritten;
            pos += bytesWritten;
          }
        }
      } finally {
        await out.close();
      }
    } else {
      for await (const c of chunks) hash.update(c);
    }
    seen.set(e.name, { size: e.size, sha256: hash.digest('hex') });
    order.push(e.name);
    if (opts.afterEntry) await opts.afterEntry(index++);
  });

  if (!manifestBytes) throw new BackupError('This backup is incomplete: it has no manifest (was the download cut off?).');
  const m = readManifest(manifestBytes);
  if (m.format !== opts.format) {
    if (m.format === 'jot-personal-backup' || m.format === 'jot-system-backup') {
      throw new BackupError(
        m.format === 'jot-personal-backup'
          ? 'This is a personal backup. Restore it in the web app, on the Backup screen.'
          : 'This is a full system backup, not a personal backup. It can only be restored with the jot restore command.',
      );
    }
    throw new BackupError('This is not a Jot backup.');
  }
  if (!Number.isInteger(m.version) || m.version < 1) throw new BackupError('This backup is damaged: its format version is missing.');
  if (m.version > opts.version) throw new BackupError(`This backup was made by a newer version of Jot (format ${m.version}); this Jot reads up to ${opts.version}.`);
  if (typeof m.createdAt !== 'string' || !DATE.test(m.createdAt)) throw new BackupError('This backup is damaged: its date is missing.');

  if (!Array.isArray(m.entries)) throw new BackupError('This backup is damaged: its manifest has no list of entries.');
  const listed = new Map<string, ManifestEntry>();
  for (const x of m.entries) {
    if (!x || typeof x.name !== 'string' || !Number.isSafeInteger(x.size) || x.size < 0 || typeof x.sha256 !== 'string' || !HEX64.test(x.sha256)) {
      throw new BackupError('This backup is damaged: its manifest has a malformed entry.');
    }
    if (!opts.isEntry(x.name) || x.name === 'manifest.json') throw new BackupError(`This backup's manifest lists an entry name that is not allowed: ${describeName(x.name)}.`);
    if (listed.has(x.name)) throw new BackupError(`This backup's manifest lists ${describeName(x.name)} twice.`);
    listed.set(x.name, x);
  }
  for (const [name, got] of seen) {
    const want = listed.get(name);
    if (!want) throw new BackupError(`This backup contains ${describeName(name)}, which its manifest does not list.`);
    if (want.size !== got.size || want.sha256 !== got.sha256) throw new BackupError(`This backup is damaged: ${describeName(name)} does not match its checksum.`);
  }
  for (const name of listed.keys()) if (!seen.has(name)) throw new BackupError(`This backup is missing ${describeName(name)}, which its manifest lists.`);

  if (!Array.isArray(m.missing)) throw new BackupError('This backup is damaged: its manifest has no list of missing files.');
  const missingNames = new Set<string>();
  for (const x of m.missing) {
    if (!x || typeof x.name !== 'string' || typeof x.what !== 'string' || x.what.length > 1000) throw new BackupError('This backup is damaged: its list of missing files is malformed.');
    if (!(opts.isMissingName ?? opts.isEntry)(x.name) || x.name === 'manifest.json' || missingNames.has(x.name)) throw new BackupError('This backup is damaged: its list of missing files is malformed.');
    if (seen.has(x.name)) throw new BackupError(`This backup lists ${describeName(x.name)} as missing, but contains it.`);
    missingNames.add(x.name);
  }
  return { manifest: m as ArchiveCheck['manifest'], seen, order };
}

export { DATE as ISO_DATE };
