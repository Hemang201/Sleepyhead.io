import { afterEach, describe, expect, it, vi } from 'vitest';

/** Minimal in-memory Storage stand-in. */
function fakeStorage(options: { throwOnWrite?: boolean } = {}): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => {
      if (options.throwOnWrite) throw new Error('QuotaExceededError');
      map.set(key, value);
    },
  };
}

async function loadStorage() {
  vi.resetModules();
  return import('../src/lib/storage');
}

describe('storage without a working localStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unavailable but keeps values alive for the session', async () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('access denied');
      },
    });

    const storage = await loadStorage();
    expect(storage.storageAvailable).toBe(false);
    expect(storage.writeRaw('k', 'v')).toBe(false);
    expect(storage.readRaw('k')).toBe('v');
  });

  it('survives a localStorage that throws on write (private mode, full quota)', async () => {
    vi.stubGlobal('window', { localStorage: fakeStorage({ throwOnWrite: true }) });

    const storage = await loadStorage();
    expect(storage.storageAvailable).toBe(false);
    expect(storage.writeRaw('quota', 'value')).toBe(false);
    expect(storage.readRaw('quota')).toBe('value');
  });

  it('survives corrupt JSON', async () => {
    const backing = fakeStorage();
    backing.setItem('broken', '{not json');
    vi.stubGlobal('window', { localStorage: backing });

    const storage = await loadStorage();
    const fallback = { safe: true };
    expect(storage.readJSON('broken', fallback, () => ({ safe: false }))).toBe(fallback);
  });

  it('writes and reads JSON when storage works', async () => {
    vi.stubGlobal('window', { localStorage: fakeStorage() });

    const storage = await loadStorage();
    expect(storage.storageAvailable).toBe(true);
    expect(storage.writeJSON('key', { a: 1 })).toBe(true);
    expect(
      storage.readJSON<{ a: number }>('key', { a: 0 }, (value) =>
        typeof value === 'object' && value !== null && typeof (value as { a: unknown }).a === 'number'
          ? (value as { a: number })
          : null,
      ),
    ).toEqual({ a: 1 });
  });
});

describe('preference stores', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validates stored values and falls back to defaults', async () => {
    const backing = fakeStorage();
    backing.setItem('hg.favourites.v1', JSON.stringify(['refraction', 42, null]));
    backing.setItem('hg.games-filter.v1', JSON.stringify({ categories: ['puzzle', 'nonsense'], sort: 'bogus' }));
    vi.stubGlobal('window', { localStorage: backing });

    vi.resetModules();
    const preferences = await import('../src/lib/preferences');

    expect(preferences.favouritesStore.get()).toEqual(['refraction']);
    expect(preferences.filtersStore.get()).toEqual({ categories: ['puzzle'], sort: 'featured' });
  });

  it('toggles favourites without duplicates and notifies subscribers', async () => {
    vi.stubGlobal('window', { localStorage: fakeStorage() });
    vi.resetModules();
    const preferences = await import('../src/lib/preferences');

    let notifications = 0;
    const unsubscribe = preferences.favouritesStore.subscribe(() => {
      notifications += 1;
    });

    expect(preferences.toggleFavourite('neon-drift')).toBe(true);
    expect(preferences.favouritesStore.get()).toEqual(['neon-drift']);
    expect(preferences.toggleFavourite('neon-drift')).toBe(false);
    expect(preferences.favouritesStore.get()).toEqual([]);
    expect(notifications).toBe(2);

    unsubscribe();
    preferences.toggleFavourite('refraction');
    expect(notifications).toBe(2);
  });

  it('keeps the recently played list short and de-duplicated', async () => {
    vi.stubGlobal('window', { localStorage: fakeStorage() });
    vi.resetModules();
    const preferences = await import('../src/lib/preferences');

    for (let index = 0; index < 12; index += 1) preferences.recordPlayed(`game-${index}`);
    preferences.recordPlayed('game-0');

    const recent = preferences.recentStore.get();
    expect(recent.length).toBeLessThanOrEqual(8);
    expect(recent[0].slug).toBe('game-0');
    expect(new Set(recent.map((entry) => entry.slug)).size).toBe(recent.length);
  });

  it('only records improved best scores', async () => {
    vi.stubGlobal('window', { localStorage: fakeStorage() });
    vi.resetModules();
    const preferences = await import('../src/lib/preferences');

    expect(preferences.recordBestScore('neon-drift', 120)).toBe(true);
    expect(preferences.recordBestScore('neon-drift', 90)).toBe(false);
    expect(preferences.recordBestScore('neon-drift', 240)).toBe(true);
    expect(preferences.bestScoresStore.get()['neon-drift']).toBe(240);
    expect(preferences.recordBestScore('neon-drift', Number.NaN)).toBe(false);
  });
});
