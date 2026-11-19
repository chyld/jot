// Forcing files and folders to disk. A record must never point at a file that a power
// cut could still lose, so files (and the folders that name them) are synced before the
// database row that refers to them is written.
import { open } from 'node:fs/promises';

export async function syncFile(path: string): Promise<void> {
  const h = await open(path, 'r');
  try {
    await h.sync();
  } finally {
    await h.close();
  }
}

/** Syncs a folder, so the names of the files in it survive a power cut. */
export async function syncDir(path: string): Promise<void> {
  const h = await open(path, 'r');
  try {
    await h.sync();
  } finally {
    await h.close();
  }
}
