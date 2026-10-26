import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Offline support, kept deliberately small and honest.
 *
 * The worker (/sw.js) caches the app shell and hashed build output, and never
 * touches game builds. Two things have to happen from the page side:
 *
 *  1. Warming — a first visit is not controlled by the worker, so the page hands
 *     it the list of resources it actually loaded. Without this the shell would
 *     come back offline with no JavaScript behind it.
 *  2. Route warming — the other pages are separate chunks, so they are fetched
 *     once the first page is quiet (on fast connections only). After one visit
 *     the whole site, not just the landing page, works offline.
 */

const PREFETCH_ROUTES: Array<() => Promise<unknown>> = [
  () => import('../pages/GamesPage'),
  () => import('../pages/GameDetailPage'),
  () => import('../pages/AboutPage'),
  () => import('../pages/ContactPage'),
  () => import('../pages/PrivacyPage'),
  () => import('../pages/NotFoundPage'),
];

type NetworkInformation = Navigator & { connection?: { saveData?: boolean; effectiveType?: string } };

/** /games/<slug>/<file> is a hosted build; /games/<slug> is our own SPA route. */
const GAME_BUILD = /^\/games\/[^/]+\/.+/;

/** A prefetch must never cost a metered or slow visitor bandwidth. */
function connectionIsCheap(): boolean {
  const connection = (navigator as NetworkInformation).connection;
  if (!connection) return true;
  if (connection.saveData) return false;
  return !/(^|-)2g$/.test(connection.effectiveType ?? '');
}

function offlineSupported(): boolean {
  return import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

/** Tells the worker which same-origin resources this page has loaded. */
export function warmOfflineCache(): void {
  if (!offlineSupported()) return;
  const worker = navigator.serviceWorker.controller;
  if (!worker) return;

  const urls = performance
    .getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((url) => {
      if (!url.startsWith(window.location.origin)) return false;
      try {
        return !GAME_BUILD.test(new URL(url).pathname);
      } catch {
        return false;
      }
    });
  if (urls.length === 0) return;

  worker.postMessage({ source: 'hg-page', type: 'warm', urls });
}

function onIdle(task: () => void): void {
  const idle = (window as Window & { requestIdleCallback?: (callback: () => void) => number }).requestIdleCallback;
  if (idle) idle(task);
  else window.setTimeout(task, 1500);
}

/** Pulls in the route chunks a visitor has not opened yet, then caches them. */
function warmRoutes(): void {
  if (!connectionIsCheap()) return;
  void Promise.all(PREFETCH_ROUTES.map((load) => load().catch(() => undefined))).then(() => warmOfflineCache());
}

/**
 * Registers the service worker and warms the cache once the first page settles.
 * Every failure mode here is silent by design: none of it is required for the
 * site to work online.
 */
export function startOfflineSupport(): void {
  const onLoad = () => {
    if (offlineSupported()) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
      window.setTimeout(() => {
        void navigator.serviceWorker.ready
          .then(() => {
            warmOfflineCache();
            onIdle(warmRoutes);
          })
          .catch(() => undefined);
      }, 1200);
    } else {
      onIdle(warmRoutes);
    }
  };

  if (document.readyState === 'complete') onLoad();
  else window.addEventListener('load', onLoad, { once: true });
}

/** Re-warms after client-side navigation, so newly seen artwork works offline. */
export function useOfflineWarmup(): void {
  const { pathname } = useLocation();

  useEffect(() => {
    if (!offlineSupported()) return;
    const timer = window.setTimeout(warmOfflineCache, 800);
    return () => window.clearTimeout(timer);
  }, [pathname]);
}
