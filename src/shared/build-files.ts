/**
 * File-format rules for uploaded builds and artwork.
 *
 * Uploaded content is code that will run in a browser, so nothing here trusts a
 * filename: paths are normalised and checked, and images are identified by their
 * magic bytes rather than their extension.
 *
 * This module is shared: the Worker enforces these rules on every uploaded file,
 * and the dashboard applies the identical rules while preparing an archive, so
 * the owner sees exactly what will be stored before anything is sent.
 */

/** Content types for the file kinds a browser game build is allowed to contain. */
const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  wasm: 'application/wasm',
  data: 'application/octet-stream',
  mem: 'application/octet-stream',
  unityweb: 'application/octet-stream',
  bin: 'application/octet-stream',
  pak: 'application/octet-stream',
  res: 'application/octet-stream',
  pck: 'application/octet-stream',
  // Pre-compressed variants some engine exports ship alongside the originals
  // (Unity's "decompression fallback", Godot and Defold archives, atlas files).
  // They are served as-is: the engine's own loader decompresses them.
  br: 'application/octet-stream',
  gz: 'application/octet-stream',
  arcd: 'application/octet-stream',
  arcz: 'application/octet-stream',
  projectc: 'application/octet-stream',
  texturec: 'application/octet-stream',
  atlas: 'text/plain; charset=utf-8',
  fnt: 'text/plain; charset=utf-8',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
};

/**
 * Extensions a build may contain. An allowlist, not a blocklist: a game build is
 * a web bundle, so anything executable by a server or the OS is simply not a
 * valid entry here.
 */
export const ALLOWED_BUILD_EXTENSIONS = new Set(Object.keys(CONTENT_TYPES));

/** Files that would change how our own hosting behaves if they were served. */
const RESERVED_NAMES = new Set(['_headers', '_redirects', '.htaccess', 'wrangler.toml', 'wrangler.jsonc', 'package.json']);

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

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extensionOf(path)] ?? 'application/octet-stream';
}

/**
 * Normalises an archive entry or upload path, or returns null when it is not
 * safe to store. Rejects absolute paths, traversal, backslashes, control
 * characters, reserved hosting files and unsupported extensions.
 */
export function safeBuildPath(raw: string): string | null {
  let path = raw.trim();
  if (!path || path.length > 512) return null;
  // Control characters are exactly what we are looking for here, so the
  // no-control-regex rule does not apply.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return null;
  if (path.includes('\\')) return null;

  path = path.replace(/^\.\//, '');
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null;
    if (segment.length > 255) return null;
    if (RESERVED_NAMES.has(segment.toLowerCase())) return null;
    segments.push(segment);
  }
  if (segments.length === 0 || segments.length > 20) return null;

  const normalized = segments.join('/');
  const extension = extensionOf(normalized);
  if (!ALLOWED_BUILD_EXTENSIONS.has(extension)) return null;
  return normalized;
}

/** True for paths that could be a game entry point. */
export function isHtmlPath(path: string): boolean {
  const extension = extensionOf(path);
  return extension === 'html' || extension === 'htm';
}

export interface ArchiveEntry {
  path: string;
  bytes: Uint8Array;
}

export interface ArchiveInspection {
  /** Files that passed validation, in archive order. */
  files: ArchiveEntry[];
  /** Entries the owner should know were dropped, with the reason. */
  skipped: { path: string; reason: string }[];
  /** Directory prefixes stripped because every entry shared a single root folder. */
  strippedPrefix: string | null;
  totalBytes: number;
}

/** True when an archive or upload would exceed the configured file budget. */
export function fileCountExceedsLimit(fileCount: number, maxFiles: number): boolean {
  return fileCount > Math.floor(maxFiles);
}

/**
 * Picks the entry point for a build. Prefers index.html at the shallowest level
 * (after any single wrapping folder has been stripped), otherwise the only HTML
 * file present. Returns null when the choice is genuinely ambiguous, so the
 * dashboard can ask instead of guessing.
 */
export function detectEntryPath(paths: string[]): { entry: string | null; candidates: string[] } {
  const html = paths.filter(isHtmlPath);
  if (html.length === 0) return { entry: null, candidates: [] };

  const indexes = html.filter((path) => /(^|\/)index\.html?$/i.test(path)).sort(byDepth);
  if (indexes.length > 0) return { entry: indexes[0], candidates: html };

  const sorted = [...html].sort(byDepth);
  if (sorted.length === 1) return { entry: sorted[0], candidates: html };
  return { entry: null, candidates: sorted };
}

function byDepth(a: string, b: string): number {
  const depth = a.split('/').length - b.split('/').length;
  return depth !== 0 ? depth : a.localeCompare(b);
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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface PreparedFile {
  path: string;
  bytes: Uint8Array;
}

/**
 * Drops a single wrapping folder, which most game exports ship inside, and
 * enforces the file-count limit. Shared so the browser prepares a build exactly
 * the way the server would store it.
 */
export function stripSingleRoot(
  entries: PreparedFile[],
  maxFiles = 3000,
): { files: PreparedFile[]; strippedPrefix: string | null } {
  // The file-count limit applies whether or not a root folder was stripped.
  const capped = entries.slice(0, maxFiles);
  if (entries.length === 0) return { files: entries, strippedPrefix: null };
  const slash = entries[0].path.indexOf('/');
  const firstSegment = slash === -1 ? null : entries[0].path.slice(0, slash);
  if (!firstSegment) return { files: capped, strippedPrefix: null };

  const sharedRoot = entries.every((entry) => entry.path.startsWith(`${firstSegment}/`));
  if (!sharedRoot) return { files: capped, strippedPrefix: null };

  const files = capped
    .map((entry) => ({ path: entry.path.slice(firstSegment.length + 1), bytes: entry.bytes }))
    .filter((entry) => entry.path.length > 0);
  return { files, strippedPrefix: firstSegment };
}
