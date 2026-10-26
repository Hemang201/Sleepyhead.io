import { CATEGORIES, type CategoryId } from '../shared/catalogue';
import { RECENT_LIMIT, FAVOURITES_LIMIT, STORAGE_KEYS, readJSON, writeJSON } from './storage';
import { isSortKey, type SortKey } from './games-query';

/**
 * Tiny localStorage-backed stores.
 *
 * Written this way (rather than ad-hoc reads inside components) so that:
 *   - every value is validated on read (a hand-edited or stale localStorage
 *     entry degrades to the default instead of crashing the page);
 *   - reads return a cached, referentially stable snapshot, which is what
 *     `useSyncExternalStore` requires;
 *   - a storage failure (private mode, full quota) is invisible to visitors.
 */

export interface Store<T> {
  get(): T;
  set(value: T): void;
  update(updater: (value: T) => T): void;
  subscribe(listener: () => void): () => void;
  reset(): void;
}

export function createStore<T>(key: string, initial: T, parse: (value: unknown) => T | null): Store<T> {
  let cache: T | null = null;
  const listeners = new Set<() => void>();

  const read = (): T => {
    if (cache !== null) return cache;
    cache = readJSON<T>(key, initial, parse);
    return cache;
  };

  const emit = () => {
    for (const listener of listeners) listener();
  };

  return {
    get: read,
    set(value) {
      cache = value;
      writeJSON(key, value);
      emit();
    },
    update(updater) {
      this.set(updater(read()));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      cache = initial;
      writeJSON(key, initial);
      emit();
    },
  };
}

/* ---------------------------------------------------------------- favourites */

function parseSlugList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === 'string').slice(0, FAVOURITES_LIMIT);
}

export const favouritesStore = createStore<string[]>(STORAGE_KEYS.favourites, [], parseSlugList);

export function toggleFavourite(slug: string): boolean {
  let added = false;
  favouritesStore.update((current) => {
    if (current.includes(slug)) return current.filter((item) => item !== slug);
    added = true;
    return [slug, ...current].slice(0, FAVOURITES_LIMIT);
  });
  return added;
}

/* ----------------------------------------------------------- recently played */

export interface RecentEntry {
  slug: string;
  at: number;
}

function parseRecent(value: unknown): RecentEntry[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter(
      (item): item is RecentEntry =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as RecentEntry).slug === 'string' &&
        typeof (item as RecentEntry).at === 'number',
    )
    .slice(0, RECENT_LIMIT);
}

export const recentStore = createStore<RecentEntry[]>(STORAGE_KEYS.recentlyPlayed, [], parseRecent);

export function recordPlayed(slug: string): void {
  recentStore.update((current) => [{ slug, at: Date.now() }, ...current.filter((item) => item.slug !== slug)].slice(0, RECENT_LIMIT));
}

/* --------------------------------------------------------------- library UI */

export interface StoredFilters {
  categories: CategoryId[];
  sort: SortKey;
}

export const emptyFilters: StoredFilters = { categories: [], sort: 'featured' };

function parseFilters(value: unknown): StoredFilters | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<StoredFilters>;
  return {
    // Only genres that still exist in the manifest survive: a renamed or removed
    // genre in a stale localStorage entry can never filter the library down to
    // nothing.
    categories: Array.isArray(candidate.categories)
      ? candidate.categories.filter((item): item is CategoryId =>
          CATEGORIES.some((category) => category.id === item),
        )
      : [],
    sort: isSortKey(candidate.sort) ? candidate.sort : 'featured',
  };
}

export const filtersStore = createStore<StoredFilters>(STORAGE_KEYS.gameFilters, emptyFilters, parseFilters);

/* ------------------------------------------------------------- misc prefs */

export const mutedStore = createStore<boolean>(STORAGE_KEYS.muted, false, (value) =>
  typeof value === 'boolean' ? value : null,
);

/**
 * Whether the visitor wants the ambient music. The audio element itself lives in
 * `lib/ambient.ts`; this is only the remembered choice, so it survives reloads
 * and routes.
 */
export const ambientEnabledStore = createStore<boolean>(STORAGE_KEYS.ambientMusic, false, (value) =>
  typeof value === 'boolean' ? value : null,
);

/**
 * The visitor's volume for the ambient track, 0–1. Stored separately from
 * on/off, so muting and resuming — and reloading — never lose the level they
 * chose. The default is a background bed, not a soundtrack.
 */
export const DEFAULT_MUSIC_VOLUME = 0.4;

export const musicVolumeStore = createStore<number>(STORAGE_KEYS.musicVolume, DEFAULT_MUSIC_VOLUME, (value) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null,
);

export interface BestScores {
  [slug: string]: number;
}

/** Best scores reported by local games through postMessage. */
export const bestScoresStore = createStore<BestScores>(`${STORAGE_KEYS.recentlyPlayed}.scores`, {}, (value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]),
  );
  return Object.fromEntries(entries);
});

export function recordBestScore(slug: string, score: number): boolean {
  if (!Number.isFinite(score) || score < 0) return false;
  const current = bestScoresStore.get()[slug] ?? 0;
  if (score <= current) return false;
  bestScoresStore.update((scores) => ({ ...scores, [slug]: Math.round(score) }));
  return true;
}
