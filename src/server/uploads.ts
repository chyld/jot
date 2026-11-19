// Upload type checks. The first bytes of the file decide its type; the declared
// MIME type and the file name are never trusted.

export const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const);
export type ImageType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** Number of leading bytes detectImageType needs. */
export const SNIFF_BYTES = 16;

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectImageType(head: Buffer): ImageType | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_SIG)) return 'image/png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 6) {
    const six = head.subarray(0, 6).toString('latin1');
    if (six === 'GIF87a' || six === 'GIF89a') return 'image/gif';
  }
  if (head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}
