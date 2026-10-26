/**
 * Safe browser storage helpers.
 *
 * localStorage throws in a surprising number of real situations: Safari private
 * mode, blocked third-party storage, embedded webviews, or a full quota. Every
 * read/write in the site goes through here so a storage failure can never break
 * the UI — preferences simply stop persisting.
 */

const memoryFallback = new Map<string, string>();

function storage(): Storage | null {
  try {
    const test = '__hg_probe__';
    window.localStorage.setItem(test, test);
    window.localStorage.removeItem(test);
    return window.localStorage;
  } catch {
    return null;
  }
}

const available = storage();

/** True when preferences can actually be persisted in this browser. */
export const storageAvailable = available !== null;

export function readRaw(key: string): string | null {
  try {
    if (available) return available.getItem(key);
  } catch {
    /* fall through to the in-memory copy */
  }
  return memoryFallback.get(key) ?? null;
}

export function writeRaw(key: string, value: string): boolean {
  memoryFallback.set(key, value);
  try {
    if (available) {
      available.setItem(key, value);
      return true;
    }
  } catch {
    /* quota or privacy restriction: the in-memory copy still works this session */
  }
  return false;
}

export function removeRaw(key: string): void {
  memoryFallback.delete(key);
  try {
    available?.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

export function readJSON<T>(key: string, fallback: T, parse: (value: unknown) => T | null): T {
  const raw = readRaw(key);
  if (raw === null) return fallback;
  try {
    const parsed = parse(JSON.parse(raw));
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown): boolean {
  try {
    return writeRaw(key, JSON.stringify(value));
  } catch {
    return false;
  }
}

/** Storage keys, versioned so a shape change cannot crash an old client. */
export const STORAGE_KEYS = {
  theme: 'hg.theme.v1',
  cookieConsent: 'hg.privacy.v1',
  favourites: 'hg.favourites.v1',
  recentlyPlayed: 'hg.recent.v1',
  gameFilters: 'hg.games-filter.v1',
  muted: 'hg.game-muted.v1',
  ambientMusic: 'hg.music.v1',
  musicVolume: 'hg.music.volume.v1',
} as const;

/** Keeps the "recently played" list short and predictable. */
export const RECENT_LIMIT = 8;
export const FAVOURITES_LIMIT = 50;
