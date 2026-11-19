// Type 3 (unit): upload type checks. The file's own bytes decide its type;
// the declared MIME type and file name are never trusted.
import { describe, expect, it } from 'vitest';
import { detectImageType, ACCEPTED_IMAGE_TYPES } from '../../src/server/uploads';
import { GIF_1PX, JPEG_HEAD, PNG_1PX, WEBP_HEAD } from '../helpers/setup';

describe('detectImageType', () => {
  it('accepts exactly JPEG, PNG, GIF and WebP', () => {
    expect([...ACCEPTED_IMAGE_TYPES].sort()).toEqual(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);
  });

  it('recognises each accepted type from its bytes', () => {
    expect(detectImageType(PNG_1PX)).toBe('image/png');
    expect(detectImageType(JPEG_HEAD)).toBe('image/jpeg');
    expect(detectImageType(GIF_1PX)).toBe('image/gif');
    expect(detectImageType(Buffer.from('GIF87a' + '\0'.repeat(10)))).toBe('image/gif');
    expect(detectImageType(WEBP_HEAD)).toBe('image/webp');
  });

  it('rejects SVG, HTML, text, PDF and executables', () => {
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(detectImageType(Buffer.from('<!doctype html><script>alert(1)</script>'))).toBeNull();
    expect(detectImageType(Buffer.from('just some text'))).toBeNull();
    expect(detectImageType(Buffer.from('%PDF-1.7\n'))).toBeNull();
    expect(detectImageType(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]))).toBeNull();
  });

  it('rejects truncated or empty headers', () => {
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageType(PNG_1PX.subarray(0, 4))).toBeNull();
  });

  it('rejects a RIFF file that is not WebP', () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WAVEfmt '), Buffer.alloc(16)]);
    expect(detectImageType(wav)).toBeNull();
  });

  it('rejects HTML that starts with an image signature-like prefix in text', () => {
    expect(detectImageType(Buffer.from('PNG <script>'))).toBeNull();
  });
});
