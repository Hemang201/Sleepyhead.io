/**
 * The background-music document.
 *
 * Two pieces of state, in two places:
 *
 *   - **The configuration** (title, enabled flag, storage reference and file
 *     metadata) is one JSON document in D1's `site_settings`, next to the
 *     appearance settings. It survives deployments and is read by the public
 *     site on every load.
 *   - **The audio file itself** is an object in R2. Only the storage key is in
 *     the document, so the database never carries a megabyte of audio.
 *
 * When no file has ever been uploaded the document points at the track that
 * ships with the build (`/audio/ambient-theme.wav`), so a fresh deployment has
 * working music and the dashboard starts from a real, playable state.
 */

export const MUSIC_LIMITS = {
  /** 12 MB is roughly 20 minutes of compressed audio — generous for a loop. */
  maxBytes: 12 * 1024 * 1024,
  maxTitle: 80,
} as const;

/** The formats the uploader accepts, with the content type it stores. */
export const MUSIC_FORMATS = [
  { extension: 'mp3', contentType: 'audio/mpeg', label: 'MP3' },
  { extension: 'ogg', contentType: 'audio/ogg', label: 'OGG' },
  { extension: 'wav', contentType: 'audio/wav', label: 'WAV' },
  { extension: 'm4a', contentType: 'audio/mp4', label: 'M4A' },
  { extension: 'flac', contentType: 'audio/flac', label: 'FLAC' },
] as const;

export type MusicSource = 'bundled' | 'uploaded' | 'none';

export interface MusicConfig {
  title: string;
  /** Where the audio comes from. `none` is the state after a removal. */
  source: MusicSource;
  /** R2 key of the uploaded file; null for the bundled track or no track. */
  storageKey: string | null;
  contentType: string | null;
  byteSize: number | null;
  enabled: boolean;
  /** ISO timestamp of the last change; also the cache-busting value. */
  updatedAt: string | null;
}

/** What a visitor's browser is told. Never the storage key. */
export interface PublicMusic {
  enabled: boolean;
  title: string;
  /** Same-origin URL, or null when music is disabled or the file is missing. */
  url: string | null;
  updatedAt: string | null;
}

export const DEFAULT_MUSIC: MusicConfig = {
  title: 'Ambient theme',
  source: 'bundled',
  storageKey: null,
  contentType: 'audio/wav',
  byteSize: null,
  enabled: true,
  updatedAt: null,
};

export const BUNDLED_TRACK = '/audio/ambient-theme.wav';
export const MUSIC_MEDIA_PATH = '/api/media/music';

function text(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.slice(0, max) || fallback;
}

/**
 * Coerces anything the API might have stored into a complete document. A
 * malformed row degrades to the shipped track instead of taking the player down.
 */
export function normaliseMusic(value: unknown): MusicConfig {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const storageKey =
    typeof source.storageKey === 'string' && /^music\/[A-Za-z0-9._-]+$/.test(source.storageKey)
      ? source.storageKey
      : null;
  const contentType =
    typeof source.contentType === 'string' && source.contentType.startsWith('audio/')
      ? source.contentType.slice(0, 60)
      : storageKey
        ? 'audio/mpeg'
        : DEFAULT_MUSIC.contentType;
  const byteSize =
    typeof source.byteSize === 'number' && Number.isFinite(source.byteSize) && source.byteSize > 0
      ? Math.round(source.byteSize)
      : null;
  const declared = source.source === 'uploaded' || source.source === 'none' || source.source === 'bundled' ? source.source : null;
  const kind: MusicSource = declared === 'none' ? 'none' : storageKey || declared === 'uploaded' ? 'uploaded' : 'bundled';
  if (kind === 'uploaded' && !storageKey) {
    // A dangling "uploaded" document with no key cannot be played; treat the
    // track as removed rather than falling back to the bundled file silently.
    return { ...DEFAULT_MUSIC, enabled: false, source: 'none', updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null };
  }

  return {
    title: text(source.title, DEFAULT_MUSIC.title, MUSIC_LIMITS.maxTitle),
    source: kind,
    storageKey: kind === 'uploaded' ? storageKey : null,
    contentType: kind === 'uploaded' ? contentType : kind === 'bundled' ? DEFAULT_MUSIC.contentType : null,
    byteSize: kind === 'uploaded' ? byteSize : null,
    // Nothing can be "enabled" without a source.
    enabled: kind !== 'none' && (source.enabled === undefined ? DEFAULT_MUSIC.enabled : source.enabled === true),
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
  };
}

/**
 * The public projection. `available` is answered by the Worker after a
 * `HEAD` on the R2 object, so a deleted file never becomes a broken player.
 */
export function publicMusic(config: MusicConfig, available: boolean): PublicMusic {
  if (!config.enabled) return { enabled: false, title: config.title, url: null, updatedAt: config.updatedAt };
  if (config.source === 'bundled') {
    return { enabled: true, title: config.title, url: BUNDLED_TRACK, updatedAt: config.updatedAt };
  }
  if (config.source === 'none' || !config.storageKey) {
    return { enabled: false, title: config.title, url: null, updatedAt: config.updatedAt };
  }
  // The Worker checks R2 before answering, so a deleted object becomes "no
  // music" for the public site instead of a player that fails in the open.
  if (!available) return { enabled: false, title: config.title, url: null, updatedAt: config.updatedAt };
  const version = config.updatedAt ? `?v=${encodeURIComponent(config.updatedAt)}` : '';
  return { enabled: true, title: config.title, url: `${MUSIC_MEDIA_PATH}${version}`, updatedAt: config.updatedAt };
}

/** The storage key for a newly uploaded file. Always inside `music/`. */
export function musicStorageKey(extension: string): string {
  return `music/${crypto.randomUUID()}.${extension}`;
}
