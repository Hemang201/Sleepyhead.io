import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { PublicGame } from '../shared/catalogue';
import { api, ApiError } from './api';

/**
 * The public catalogue, loaded from the API.
 *
 * The site ships no game data: every card, filter count, search hit and game
 * page is built from this one response. When nothing is published yet the list
 * is simply empty and the pages show their empty state.
 */

export type LoadStatus = 'loading' | 'ready' | 'error';

export interface CatalogueValue {
  games: PublicGame[];
  status: LoadStatus;
  error: string | null;
  /** ISO timestamp of the response, for "updated" labels. */
  updatedAt: string | null;
  reload: () => void;
}

const CatalogueContext = createContext<CatalogueValue | null>(null);

/** How long a loaded catalogue is considered fresh for focus-revalidation. */
const FRESH_FOR_MS = 60_000;

export function CatalogueProvider({ children }: { children: ReactNode }) {
  const [games, setGames] = useState<PublicGame[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const loadedAt = useRef(0);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus((current) => (current === 'ready' ? current : 'loading'));

    try {
      const data = await api.catalogue();
      setGames(data.games);
      setUpdatedAt(data.updatedAt);
      setError(null);
      setStatus('ready');
      loadedAt.current = Date.now();
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : 'The catalogue could not be loaded.';
      /* In development the usual reason the catalogue is unreachable is that the
         Vite client is running on its own (`npm run dev`), so every /api call is
         answered by the dev server with a 404 instead of by the Worker. Say so —
         and only in development, because a visitor has no use for build
         instructions and a deployment must never look half-configured in
         production when the API is simply down. */
      const hint = import.meta.env.DEV
        ? ' The API is not answering: start the app with `npm run dev:full` so the Worker is served alongside the pages.'
        : '';
      setError(`${message}${hint}`);
      // Keep whatever was already on screen rather than blanking the page.
      setStatus((current) => (current === 'ready' ? 'ready' : 'error'));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // If the owner publishes something while a visitor's tab sits in the
  // background, the catalogue refreshes when they come back to it.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - loadedAt.current > FRESH_FOR_MS) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const value = useMemo<CatalogueValue>(
    () => ({ games, status, error, updatedAt, reload: () => void load() }),
    [error, games, load, status, updatedAt],
  );

  return <CatalogueContext.Provider value={value}>{children}</CatalogueContext.Provider>;
}

export function useCatalogue(): CatalogueValue {
  const value = useContext(CatalogueContext);
  if (!value) throw new Error('useCatalogue must be used inside a CatalogueProvider');
  return value;
}

/** One game by slug, plus the loading state of the catalogue behind it. */
export function useGame(slug: string | undefined): {
  game: PublicGame | null;
  status: LoadStatus;
  error: string | null;
  reload: () => void;
} {
  const { games, status, error, reload } = useCatalogue();
  const game = useMemo(() => (slug ? (games.find((entry) => entry.slug === slug) ?? null) : null), [games, slug]);
  return { game, status, error, reload };
}
