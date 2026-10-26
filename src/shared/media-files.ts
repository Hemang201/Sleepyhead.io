/**
 * File rules for everything this site accepts from the dashboard.
 *
 * Images are identified by their magic bytes rather than their extension, and a
 * URL segment is decoded without throwing: the client bundle and the Worker run
 * the same code, so a file that previews as a PNG is stored as a PNG.
 */

/**
 * Percent-decodes one URL segment without throwing.
 *
 * A malformed escape (`/%`, a stray `%ZZ`) makes `decodeURIComponent` raise a
 * `URIError`. That is a bad request, not a server fault, so public routes turn
 * it into a 400 instead of letting it become an unhandled 500.
 */
export function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export interface ImageInfo {
  contentType: string;
  extension: string;
}

/** Identifies an image from its leading bytes. Extensions are never trusted. */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  const head = bytes.subarray(0, 16);

  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  if (head.length >= 6 && String.fromCharCode(...head.subarray(0, 6)).startsWith('GIF8')) {
    return { contentType: 'image/gif', extension: 'gif' };
  }
  if (
    head.length >= 12 &&
    String.fromCharCode(...head.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...head.subarray(8, 12)) === 'WEBP'
  ) {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  if (head.length >= 12 && String.fromCharCode(...head.subarray(4, 12)).includes('ftypavif')) {
    return { contentType: 'image/avif', extension: 'avif' };
  }
  return null;
}

/** A byte count as the dashboard shows it. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
