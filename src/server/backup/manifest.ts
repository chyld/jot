// The manifest is sealed with the SHA-256 of its own contents ("check"), so a changed
// byte in the manifest is caught just like a changed byte in any other entry.
import { createHash } from 'node:crypto';
import { BackupError } from './errors';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function sealManifest(manifest: object): Buffer {
  const { check: _ignored, ...rest } = manifest as Record<string, unknown>;
  return Buffer.from(JSON.stringify({ ...rest, check: sha(JSON.stringify(rest)) }));
}

export function readManifest(bytes: Buffer): Record<string, any> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new BackupError('This backup is damaged: its manifest cannot be read.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new BackupError('This backup is damaged: its manifest cannot be read.');
  const { check, ...rest } = parsed as Record<string, unknown>;
  if (typeof check !== 'string' || check !== sha(JSON.stringify(rest))) {
    throw new BackupError('This backup is damaged: its manifest does not match its checksum.');
  }
  return rest;
}
