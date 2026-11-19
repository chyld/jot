// Jot's own minimal tar (POSIX ustar), used for both kinds of backup.
//
// Jot only ever writes plain-file entries with fixed header fields (mode 0600, owner 0,
// no user or group names), so the reader is strict: every header must be byte-for-byte
// what Jot would write for that name, size and time; padding and the two end blocks must
// be zeros; and nothing may follow them. Together with the SHA-256 of every entry in the
// manifest, a single changed byte anywhere in an archive is caught. Links, folders and
// every other entry type are refused, and names are checked by the caller against fixed
// patterns before anything is written, so an archive can never name a path of its own.
//
// Files are copied in chunks, never held in memory.
import { createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';
import { BackupError } from './errors';

const BLOCK = 512;
const CHUNK = 1 << 20;
const OCTAL_LIMIT = 8 ** 11; // sizes from here on use base-256

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, '0') + '\0';
}

function writeSize(h: Buffer, size: number) {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error(`bad tar entry size ${size}`);
  if (size < OCTAL_LIMIT) {
    h.write(octal(size, 12), 124, 'latin1');
    return;
  }
  // GNU base-256: first byte 0x80, then the size big-endian in the remaining 11 bytes.
  h[124] = 0x80;
  let n = size;
  for (let i = 135; i > 124; i--) {
    h[i] = n % 256;
    n = Math.floor(n / 256);
  }
}

/** Reads a size field written by writeSize (or throws). */
export function readSize(field: Buffer): number {
  if (field.length !== 12) throw new BackupError('This backup is damaged (a file header is not as Jot writes it).');
  if (field[0] === 0x80) {
    let n = 0;
    for (let i = 1; i < 12; i++) n = n * 256 + field[i];
    if (!Number.isSafeInteger(n) || n < OCTAL_LIMIT) throw new BackupError('This backup is damaged (a file header is not as Jot writes it).');
    return n;
  }
  const s = field.toString('latin1');
  if (!/^[0-7]{11}\0$/.test(s)) throw new BackupError('This backup is damaged (a file header is not as Jot writes it).');
  return parseInt(s.slice(0, 11), 8);
}

/** The 512-byte header Jot writes for a plain file. */
export function encodeHeader(name: string, size: number, mtime: number): Buffer {
  const nameBytes = Buffer.from(name, 'utf8');
  if (nameBytes.length === 0 || nameBytes.length > 100 || nameBytes.includes(0)) throw new Error(`bad tar entry name ${JSON.stringify(name)}`);
  const h = Buffer.alloc(BLOCK);
  nameBytes.copy(h, 0);
  h.write(octal(0o600, 8), 100, 'latin1');
  h.write(octal(0, 8), 108, 'latin1');
  h.write(octal(0, 8), 116, 'latin1');
  writeSize(h, size);
  h.write(octal(mtime, 12), 136, 'latin1');
  h.write('        ', 148, 'latin1');
  h.write('0', 156, 'latin1');
  h.write('ustar\0', 257, 'latin1');
  h.write('00', 263, 'latin1');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'latin1');
  return h;
}

export interface EntryResult {
  size: number;
  sha256: string;
}

/** Writes an archive to a new file. Call finish() to complete it (it is then synced to disk). */
export class TarWriter {
  private pos = 0;
  /** SHA-256 of the whole archive, as written. */
  private whole = createHash('sha256');

  private constructor(
    private fh: FileHandle,
    private mtime: number,
  ) {}

  static async create(path: string, mtime = Math.floor(Date.now() / 1000)): Promise<TarWriter> {
    return new TarWriter(await open(path, 'wx', 0o600), mtime);
  }

  private async write(buf: Buffer) {
    let off = 0;
    while (off < buf.length) {
      const { bytesWritten } = await this.fh.write(buf, off, buf.length - off, this.pos);
      off += bytesWritten;
      this.pos += bytesWritten;
    }
    this.whole.update(buf);
  }

  private async pad(size: number) {
    const rest = (BLOCK - (size % BLOCK)) % BLOCK;
    if (rest) await this.write(Buffer.alloc(rest));
  }

  async addBuffer(name: string, data: Buffer): Promise<EntryResult> {
    await this.write(encodeHeader(name, data.length, this.mtime));
    await this.write(data);
    await this.pad(data.length);
    return { size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  }

  /** Copies a file into the archive, hashing it on the way. The file must not change while it is copied. */
  async addFile(name: string, path: string, onChunk?: () => Promise<void>): Promise<EntryResult> {
    const src = await open(path, 'r');
    try {
      const size = (await src.stat()).size;
      await this.write(encodeHeader(name, size, this.mtime));
      const hash = createHash('sha256');
      const buf = Buffer.alloc(Math.min(CHUNK, Math.max(size, 1)));
      let done = 0;
      while (done < size) {
        const { bytesRead } = await src.read(buf, 0, Math.min(buf.length, size - done), done);
        if (bytesRead === 0) throw new Error(`${path} became shorter while it was being backed up`);
        const chunk = buf.subarray(0, bytesRead);
        hash.update(chunk);
        await this.write(chunk);
        done += bytesRead;
        if (onChunk) await onChunk();
      }
      await this.pad(size);
      return { size, sha256: hash.digest('hex') };
    } finally {
      await src.close();
    }
  }

  /** Writes the end of the archive, forces it to disk and closes it. Returns the archive's SHA-256. */
  async finish(): Promise<string> {
    await this.write(Buffer.alloc(BLOCK * 2));
    await this.fh.sync();
    await this.fh.close();
    return this.whole.digest('hex');
  }

  /** Closes without finishing (the caller deletes the file). */
  async abort(): Promise<void> {
    await this.fh.close().catch(() => {});
  }
}

export interface TarEntryInfo {
  name: string;
  size: number;
}

const isZero = (b: Buffer) => b.every((x) => x === 0);
const incomplete = () => new BackupError('This backup is incomplete: the file ends early (was the download cut off?).');
const damagedHeader = () => new BackupError('This backup is damaged (a file header is not as Jot writes it).');

/**
 * Reads an archive written by TarWriter, calling onEntry for each entry with an
 * iterator over its contents. Entries the callback does not read to the end are skipped.
 */
export async function readTar(path: string, onEntry: (e: TarEntryInfo, chunks: AsyncIterable<Buffer>) => Promise<void>): Promise<void> {
  const fh = await open(path, 'r');
  try {
    const fileSize = (await fh.stat()).size;
    const readAt = async (pos: number, length: number) => {
      const buf = Buffer.alloc(length);
      let got = 0;
      while (got < length) {
        const { bytesRead } = await fh.read(buf, got, length - got, pos + got);
        if (bytesRead === 0) throw incomplete();
        got += bytesRead;
      }
      return buf;
    };
    let pos = 0;
    for (;;) {
      if (pos + BLOCK > fileSize) throw incomplete();
      const h = await readAt(pos, BLOCK);
      if (isZero(h)) {
        if (pos + 2 * BLOCK > fileSize) throw incomplete();
        if (!isZero(await readAt(pos + BLOCK, BLOCK))) throw new BackupError('This backup is damaged (its end marker is wrong).');
        if (pos + 2 * BLOCK !== fileSize) throw new BackupError('This backup is damaged: there is data after the end of the archive.');
        return;
      }
      const nul = h.indexOf(0);
      const name = h.subarray(0, nul >= 0 && nul < 100 ? nul : 100).toString('utf8');
      const type = h[156];
      if (type !== 0x30 && type !== 0) throw new BackupError(`This backup contains ${JSON.stringify(name)}, which is not a plain file.`);
      const size = readSize(h.subarray(124, 136));
      const mt = h.subarray(136, 148).toString('latin1');
      if (!/^[0-7]{11}\0$/.test(mt)) throw damagedHeader();
      let expected: Buffer;
      try {
        expected = encodeHeader(name, size, parseInt(mt.slice(0, 11), 8));
      } catch {
        throw damagedHeader();
      }
      if (!expected.equals(h)) throw damagedHeader();
      const start = pos + BLOCK;
      const padded = Math.ceil(size / BLOCK) * BLOCK;
      if (start + padded > fileSize) throw incomplete();

      async function* chunks() {
        let done = 0;
        while (done < size) {
          const n = Math.min(CHUNK, size - done);
          yield await readAt(start + done, n);
          done += n;
        }
      }
      await onEntry({ name, size }, chunks());
      if (padded > size && !isZero(await readAt(start + size, padded - size))) {
        throw new BackupError(`This backup is damaged (the padding after ${JSON.stringify(name)} is not empty).`);
      }
      pos = start + padded;
    }
  } finally {
    await fh.close();
  }
}
