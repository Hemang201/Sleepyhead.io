/* Service worker — intentionally minimal.
 *
 * What it caches:
 *   - the app shell (index.html, icons, offline page);
 *   - hashed build assets under /assets/ (immutable, so cache-first is safe).
 *
 * What it never caches:
 *   - /api/* — the catalogue is served by the Worker from a database and must
 *     never be answered from a stale cache;
 *   - /auth/* — sign-in, callback and sign-out must always reach the provider;
 *   - /play/* — game builds are large, uploaded by the owner and change
 *     independently, so they are always fetched live;
 *   - anything cross-origin.
 *
 * This means the shell loads offline once visited, and games are never claimed
 * to work offline.
 */

const VERSION = 'hg-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const OFFLINE_URL = '/offline.html';

const SHELL_FILES = ['/', OFFLINE_URL, '/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png'];

/**
 * A hosted game build is /games/<slug>/<file>. The site's own game page is the
 * SPA route /games/<slug>, which must still be served from the shell offline —
 * so only paths with a second segment count as builds.
 */
/** Game builds, API responses and auth traffic are always live, never cached. */
const isGameBuild = (pathname) => pathname.startsWith('/play/');
const isApi = (pathname) => pathname.startsWith('/api/') || pathname.startsWith('/auth/');

/** Hashed build output lives in its own cache; everything else goes in the shell cache. */
function cacheNameFor(url) {
  try {
    return new URL(String(url), self.location.origin).pathname.startsWith('/assets/') ? ASSET_CACHE : SHELL_CACHE;
  } catch {
    return SHELL_CACHE;
  }
}

/** Cache a list of same-origin, non-game URLs, ignoring individual failures. */
async function warm(urls) {
  const grouped = new Map();
  for (const url of urls) {
    const name = cacheNameFor(url);
    grouped.set(name, [...(grouped.get(name) ?? []), String(url)]);
  }
  await Promise.all(
    [...grouped].map(async ([name, list]) => {
      const cache = await caches.open(name);
      await Promise.all(list.slice(0, 60).map((url) => cache.add(url).catch(() => undefined)));
    }),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_FILES).catch(() => undefined);

      // Also precache the entry assets that index.html references. The first
      // visit happens before this worker controls the page, so without this the
      // shell would come back offline with no JavaScript behind it.
      try {
        const response = await fetch('/', { cache: 'no-store' });
        const html = await response.text();
        const urls = Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)).map((match) => match[1]);
        await warm(urls);
      } catch {
        /* offline during install: the runtime caches still fill in later */
      }

      await self.skipWaiting();
    })(),
  );
});

/**
 * The page tells us what it actually loaded, so client-side route chunks are
 * cached too. Game builds are filtered out: they are large and change
 * independently, and are never served stale.
 */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.source !== 'hg-page' || data.type !== 'warm' || !Array.isArray(data.urls)) return;

  event.waitUntil(
    warm(
      data.urls.filter((url) => {
        try {
          const parsed = new URL(String(url));
          return parsed.origin === self.location.origin && !isGameBuild(parsed.pathname);
        } catch {
          return false;
        }
      }),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isGameBuild(url.pathname) || isApi(url.pathname)) return;

  // Navigations: network first, offline page as the last resort.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match('/', { ignoreSearch: true });
        return cached ?? caches.match(OFFLINE_URL).then((page) => page ?? Response.error());
      }),
    );
    return;
  }

  // Hashed build output: cache-first, refreshed in the background.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => undefined);
        return cached ?? (await network) ?? Response.error();
      }),
    );
    return;
  }

  // Everything else (icons, artwork, manifest): stale-while-revalidate.
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => undefined);
      return cached ?? (await network) ?? Response.error();
    }),
  );
});
