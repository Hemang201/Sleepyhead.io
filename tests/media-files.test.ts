import { describe, expect, it } from 'vitest';

import { decodePathSegment, sniffImage } from '../src/shared/media-files';

/**
 * Uploaded images are content, not filenames: the Worker and the dashboard both
 * decide what a file is from its leading bytes, so a `.png` that is really an
 * HTML document is never accepted as artwork.
 */
describe('sniffImage', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const gif = new TextEncoder().encode('GIF89a______________');
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

  it('identifies real images from their leading bytes', () => {
    expect(sniffImage(png)?.contentType).toBe('image/png');
    expect(sniffImage(jpeg)?.contentType).toBe('image/jpeg');
    expect(sniffImage(gif)?.contentType).toBe('image/gif');
    expect(sniffImage(webp)?.contentType).toBe('image/webp');
    expect(sniffImage(png)?.extension).toBe('png');
  });

  it('refuses content that is not an image at all', () => {
    expect(sniffImage(new TextEncoder().encode('<svg onload="alert(1)"></svg>'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode('nothing like an image here'))).toBeNull();
    expect(sniffImage(new Uint8Array(0))).toBeNull();
  });
});

describe('decodePathSegment', () => {
  it('decodes a normal escaped segment', () => {
    expect(decodePathSegment('neon%20drift')).toBe('neon drift');
    expect(decodePathSegment('plain-slug')).toBe('plain-slug');
  });

  it('reports malformed escapes instead of throwing a URIError', () => {
    expect(decodePathSegment('%')).toBeNull();
    expect(decodePathSegment('%ZZ')).toBeNull();
  });
});
