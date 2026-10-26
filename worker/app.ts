import { unzipSync } from 'fflate';

import { CHALLENGE_PURPOSES, PASSWORD_MAX_LENGTH } from '../src/shared/owner-security';
import {
  maskEmail,
  normaliseAbout,
  normaliseContact,
  normaliseSocial,
  validateAbout,
  validateContact,
  validateSocial,
  type AboutContent,
  type ContactContent,
  type SocialContent,
} from '../src/shared/site-content';
import {
  configuredLoginEmail,
  configuredOtpEmail,
  isSameOriginRequest,
  resolveOwner,
  resolveOwnerSub,
  seedOtpEmail,
} from './lib/owner';
import {
  activeSessions,
  applyEmailChange,
  gateState,
  changePassword,
  clearChangeCookie,
  clearSessionCookie,
  readSession,
  recentEvents,
  recoveryGuidance,
  resetSecurityState,
  revokeSessionsForOwner,
  securityState,
  signOut,
  startChallenge,
  startSetup,
  verifyChallenge,
  isOtpCode,
  type Failure,
} from './lib/owner-security';

import {
  ACCENTS,
  GAME_STATUSES,
  isActivatableBuild,
  isCatalogueGame,
  isPubliclyVisible,
  latestGameUpdate,
  slugify,
  validateGameInput,
  type Accent,
  type ApiError,
  type CatalogueResponse,
  type GameControls,
  type GameStatus,
  type OverviewResponse,
} from '../src/shared/catalogue';
import {
  avatarKeyFor,
  discardDoc,
  isMusicKey,
  pruneAvatars,
  publicAbout,
  publicContact,
  publicSocial,
  publishDoc,
  readAbout,
  readAppearance,
  readContact,
  readMusic,
  readSocial,
  resetContentToDefaults,
  resetMusicToDefaults,
  writeAppearance,
  writeDraft,
  writeMusic,
} from './lib/content';
import {
  BUNDLED_TRACK,
  MUSIC_LIMITS,
  MUSIC_MEDIA_PATH,
  musicStorageKey,
  publicMusic,
  type MusicConfig,
} from '../src/shared/music';
import {
  activateBuild,
  buildSummary,
  buildsForGame,
  countEventsSince,
  createBuild,
  deleteBuildRow,
  deleteGame,
  getOwnerAuth,
  getBuildFiles,
  getBuildRow,
  getGameRow,
  getGameWithBuilds,
  insertGame,
  listAllGames,
  listPublicGames,
  markBuildStatus,
  nowIso,
  parseJson,
  recordBuildFile,
  recordEvent,
  recentlyUpdated,
  setArtworkKey,
  setScreenshotKeys,
  slugExists,
  toPublicGame,
  touchGame,
  updateGame,
  type BuildRow,
  type GameRow,
  type SessionRow,
  type GameWrite,
} from './lib/db';
import {
  contentTypeFor,
  decodePathSegment,
  detectEntryPath,
  extensionOf,
  isHtmlPath,
  safeBuildPath,
  sniffImage,
  stripSingleRoot,
  fileCountExceedsLimit,
  type ArchiveEntry,
} from '../src/shared/build-files';

/* ------------------------------------------------------------------- types */

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB: D1Database;
  FILES: R2Bucket;
  APP_ORIGIN?: string;
  /** The administrator's login identity. Server-side only. */
  OWNER_LOGIN_EMAIL?: string;
  /** The private address that receives verification codes. Server-side only. */
  OWNER_OTP_EMAIL?: string;
  /** Older name for the OTP destination, still honoured. */
  OWNER_AUTH_EMAIL?: string;
  /** Historic name for OWNER_AUTH_EMAIL, still honoured. */
  OWNER_EMAIL?: string;
  /** Enables first-run owner provisioning. Refused once a password exists. */
  OWNER_SETUP_TOKEN?: string;
  /** Stable key for the single owner record. Defaults to `owner`. */
  OWNER_SUB?: string;
  DEV_OWNER_SUB?: string;
  DEV_OWNER_EMAIL?: string;
  /** Transactional email used for verification codes. */
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  EMAIL_APP_NAME?: string;
  RESEND_API_KEY?: string;
  MAX_BUILD_BYTES?: string;
  MAX_FILE_BYTES?: string;
  MAX_BUILD_FILES?: string;
  MAX_ZIP_BYTES?: string;
}

interface Limits {
  maxBuildBytes: number;
  maxFileBytes: number;
  maxBuildFiles: number;
  maxZipBytes: number;
}

const DEFAULTS: Limits = {
  maxBuildBytes: 512 * 1024 * 1024,
  maxFileBytes: 64 * 1024 * 1024,
  maxBuildFiles: 3000,
  maxZipBytes: 25 * 1024 * 1024,
};

const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
const MAX_SCREENSHOTS = 12;

const MAX_BUILD_INITS_PER_HOUR = 40;
const MAX_UPLOAD_EVENTS_PER_HOUR = 40000;
const MAX_JSON_BODY_BYTES = 128 * 1024;
const MAX_AUTH_EMAIL_LENGTH = 160;
const MAX_CHALLENGE_ID_LENGTH = 128;
const MAX_SETUP_TOKEN_LENGTH = 512;

function limits(env: Env): Limits {
  const read = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    maxBuildBytes: read(env.MAX_BUILD_BYTES, DEFAULTS.maxBuildBytes),
    maxFileBytes: read(env.MAX_FILE_BYTES, DEFAULTS.maxFileBytes),
    maxBuildFiles: read(env.MAX_BUILD_FILES, DEFAULTS.maxBuildFiles),
    maxZipBytes: read(env.MAX_ZIP_BYTES, DEFAULTS.maxZipBytes),
  };
}

/* --------------------------------------------------------------- responses */

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function fail(status: number, error: string, message: string, fields?: Record<string, string>): Response {
  const body: ApiError = fields ? { error, message, fields } : { error, message };
  return json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function noStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/* ------------------------------------------------------------ owner access */

/**
 * Owner identity lives in `lib/owner.ts`; the second factor lives in
 * `lib/owner-security.ts`. Both are re-exported here because this module is the
 * Worker's entry surface and the tests exercise it through `createApp`.
 */
export { resolveOwner, isLoopback } from './lib/owner';
export type { OwnerContext } from './lib/owner';

/* -------------------------------------------------------------- public data */

/**
 * A weak ETag for a small body. Cheap, dependency-free and stable for the same
 * catalogue, which is all the revalidation below needs.
 */
function weakEtag(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `W/"${(hash >>> 0).toString(36)}-${value.length.toString(36)}"`;
}

/**
 * Public JSON that always revalidates.
 *
 * The catalogue is the whole public site, and a publish has to show up on the
 * next request rather than whenever a shared cache expires — so responses are
 * `must-revalidate` and carry an ETag. An unchanged catalogue then costs a 304
 * instead of a full body, which is why this is not simply `no-store`.
 */
function cachedJson(request: Request, data: unknown): Response {
  const body = JSON.stringify(data);
  const etag = weakEtag(body);
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    ETag: etag,
  });

  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers });
}

async function serveCatalogue(request: Request, env: Env): Promise<Response> {
  const games = await listPublicGames(env.DB);
  /*
   * The timestamp describes the data, not the request. It used to be `nowIso()`,
   * which changed on every call and therefore changed the ETag too — so the
   * revalidation this endpoint advertises could never succeed. Deriving it from
   * the newest game makes an unchanged catalogue byte-identical, which is what
   * turns a repeat request into a 304. An empty catalogue gets the epoch rather
   * than today's date, so it is stable as well.
   */
  const body: CatalogueResponse = { games, updatedAt: latestGameUpdate(games) };
  return cachedJson(request, body);
}

async function serveGame(request: Request, env: Env, slug: string): Promise<Response> {
  const row = await getGameRow(env.DB, slug, 'slug');
  if (!row) return fail(404, 'not_found', 'No game with that address.');

  // Unpublished games are indistinguishable from missing ones to visitors.
  if (row.status === 'draft' || row.status === 'archived') return fail(404, 'not_found', 'No game with that address.');
  if (!isPubliclyVisible(row.status, row.listed === 1)) return fail(404, 'not_found', 'No game with that address.');

  const builds = await buildsForGame(env.DB, row.id);
  const game = toPublicGame(row, builds);
  // The public game route follows the catalogue: an announcement or a
  // published row without a working build has no public page either.
  if (!isCatalogueGame(game)) return fail(404, 'not_found', 'No game with that address.');
  return cachedJson(request, { game });
}

/* ------------------------------------------------------------ game delivery */

/**
 * Headers for every file of an uploaded build.
 *
 * Two constraints shape them:
 *   1. The build is untrusted code, so it runs in a sandboxed document with an
 *      opaque origin (`sandbox` here, plus the iframe's sandbox attribute). It
 *      cannot reach this site's origin, cookies, storage or the admin session.
 *   2. That opaque origin is technically cross-origin, so the build's own
 *      `fetch`/XHR calls for its assets need CORS. Everything served here is
 *      public build output, so `Access-Control-Allow-Origin: *` is safe and
 *      necessary — without it, engine loaders (Unity's `.data`, Godot's `.pck`)
 *      cannot read their own files.
 *
 * CSP sources are intentionally permissive inside the sandbox: builds may use
 * eval, blob workers and inline code, and `'self'` means nothing under an opaque
 * origin. The isolation guarantee is the sandbox, not the source list.
 */
function bodyHeaders(contentType: string, path: string): Headers {
  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('X-Content-Type-Options', 'nosniff');
  // Preflight support matters for real engine builds: Unity's loader and
  // anything using Range or custom headers triggers one, and a preflight that is
  // answered without CORS headers blocks the asset it was asking about.
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', '*');
  headers.set(
    'Content-Security-Policy',
    [
      'sandbox allow-scripts allow-pointer-lock allow-forms allow-modals allow-popups allow-downloads allow-orientation-lock allow-presentation',
      "default-src 'self' blob: data: *",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data: *",
      "style-src 'self' 'unsafe-inline' *",
      'img-src * data: blob:',
      'media-src * data: blob:',
      'font-src * data:',
      'connect-src * data: blob:',
      "worker-src 'self' blob: *",
      "frame-src 'self' blob: *",
      "frame-ancestors 'self'",
    ].join('; '),
  );
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  headers.set('Referrer-Policy', 'no-referrer');
  /*
   * Build URLs are stable across replacements — `/play/<slug>/main.js` is the
   * same URL for every build a game ever has — so a long `max-age` would keep
   * serving the previous build's script for up to an hour after the owner
   * activates a new one. That is a mixed, broken build, not a cache win: the
   * entry document is revalidated and the old script is not. Every build file
   * therefore revalidates and answers with the stored object's ETag, which is
   * what keeps a replacement immediate without giving up conditional requests.
   */
  headers.set('Cache-Control', isHtmlPath(path) || extensionOf(path) === 'json' ? 'no-cache' : 'public, max-age=0, must-revalidate');
  return headers;
}

/**
 * The owner record plus a *verified* session.
 *
 * `resolveOwner()` only reports that an owner is configured, which is not the
 * same as being signed in. Anything private — a draft build, unpublished
 * artwork, an unpublished page — goes through this instead, so the check is the
 * session row the server wrote after an accepted code.
 */
async function verifiedOwner(request: Request, env: Env) {
  const context = await resolveOwner(request, env);
  if (!context.owner) return null;
  const session = await readSession(request, env, context.owner.sub);
  return session ? context.owner : null;
}

async function serveBuild(request: Request, env: Env, slug: string, rest: string): Promise<Response> {
  // Answer preflights before anything else: a build asset must not be blocked
  // because the browser asked permission first.
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const row = await getGameRow(env.DB, slug, 'slug');
  if (!row) return fail(404, 'not_found', 'No such game.');

  const url = new URL(request.url);
  const previewBuildId = url.searchParams.get('preview');

  let buildRow: BuildRow | null;
  if (previewBuildId) {
    // Previewing an unactivated build needs a verified owner session.
    if (!(await verifiedOwner(request, env))) {
      return fail(403, 'forbidden', 'Sign in as the owner to preview a build.');
    }
    const candidate = await getBuildRow(env.DB, previewBuildId);
    if (!candidate || candidate.game_id !== row.id) return fail(404, 'not_found', 'No such build.');
    buildRow = candidate;
  } else {
    const builds = await buildsForGame(env.DB, row.id);
    const game = toPublicGame(row, builds);
    // A game that is not publicly playable exists only for the owner.
    if (!game.playable && !(await verifiedOwner(request, env))) {
      return fail(404, 'not_found', 'This game is not available to play.');
    }
    buildRow = builds.find((build) => build.id === row.active_build_id) ?? null;
    if (!buildRow || !isActivatableBuild(buildRow.status)) {
      return fail(404, 'not_found', 'This game has no active build.');
    }
  }

  const rawPath = rest === '' ? (buildRow.entry_path ?? 'index.html') : rest;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return fail(400, 'bad_path', 'Malformed path.');
  }
  const path = safeBuildPath(decoded);
  if (!path) return fail(404, 'not_found', 'No such file in this build.');

  const record = await getBuildFiles(env.DB, buildRow.id).then((files) => files.find((file) => file.path === path));
  if (!record) return fail(404, 'not_found', 'No such file in this build.');

  const object = await env.FILES.get(`builds/${row.id}/${buildRow.id}/${path}`);
  if (!object) return fail(404, 'not_found', 'That build file is missing from storage.');

  const headers = bodyHeaders(record.content_type, path);
  const etag = object.httpEtag ?? weakEtag(`${record.content_type}:${object.size}`);
  headers.set('ETag', etag);
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(object.body, { status: 200, headers });
}

async function serveArtwork(
  request: Request,
  env: Env,
  gameId: string,
  kind: string,
  index: string | null,
): Promise<Response> {
  const row = await getGameRow(env.DB, gameId, 'id');
  if (!row) return fail(404, 'not_found', 'No such artwork.');

  // Artwork for a game that is not public is only for the owner.
  if (!isPubliclyVisible(row.status, row.listed === 1) && !(await verifiedOwner(request, env))) {
    return fail(404, 'not_found', 'No such artwork.');
  }

  let key: string | null;
  if (index === null) {
    if (kind !== 'thumbnail' && kind !== 'banner') return fail(404, 'not_found', 'No such artwork.');
    key = kind === 'thumbnail' ? row.thumbnail_key : row.banner_key;
  } else {
    const shots = parseJson<string[]>(row.screenshots, []);
    const position = Number(index);
    key = Number.isInteger(position) && position >= 0 && position < shots.length ? shots[position] : null;
  }
  if (!key) return fail(404, 'not_found', 'No such artwork.');

  const object = await env.FILES.get(key);
  if (!object) return fail(404, 'not_found', 'That artwork is missing from storage.');

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream');
  headers.set('X-Content-Type-Options', 'nosniff');
  // Artwork URLs are stable, so replacement has to be visible immediately:
  // revalidate every time and let the stored object's ETag answer with a 304.
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  const etag = object.httpEtag ?? weakEtag(String(object.etag ?? object.size));
  headers.set('ETag', etag);
  headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(object.body, { status: 200, headers });
}

/* ------------------------------------------------------------ sitemap + seo */

/* ---------------------------------------------------- editable content API */

/**
 * Public settings: the decorative background.
 *
 * This response is public by design and contains only presentation values. The
 * owner's private authentication address is not part of it and is never joined
 * to it.
 */
async function serveSettings(request: Request, env: Env): Promise<Response> {
  return cachedJson(request, { appearance: await readAppearance(env.DB) });
}

/* --------------------------------------------------------------- music */

/**
 * The uploaded audio's real format, sniffed from its leading bytes.
 *
 * The browser-supplied `Content-Type` is a hint, not evidence: it is trivial to
 * label a ZIP as `audio/mpeg`. Only the signatures below are accepted, and the
 * extension and content type are derived from the bytes — never the request.
 */
function sniffAudio(bytes: Uint8Array): { extension: string; contentType: string } | null {
  if (bytes.byteLength < 12) return null;
  const tag = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));

  if (tag(0, 4) === 'RIFF' && tag(8, 12) === 'WAVE') return { extension: 'wav', contentType: 'audio/wav' };
  if (tag(0, 4) === 'OggS') return { extension: 'ogg', contentType: 'audio/ogg' };
  if (tag(0, 4) === 'fLaC') return { extension: 'flac', contentType: 'audio/flac' };
  if (tag(4, 8) === 'ftyp') return { extension: 'm4a', contentType: 'audio/mp4' };
  if (tag(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return { extension: 'mp3', contentType: 'audio/mpeg' };
  }
  return null;
}

/** True when the enabled track can actually be fetched. The bundled file is a
 *  build asset, so only an uploaded object needs a storage check. */
async function musicFileExists(env: Env, config: MusicConfig): Promise<boolean> {
  if (!config.storageKey) return config.source === 'bundled';
  return Boolean(await env.FILES.head(config.storageKey));
}

/** Where the dashboard's preview player should point, if anywhere. */
function musicPreviewUrl(config: MusicConfig): string | null {
  if (config.source === 'bundled') return BUNDLED_TRACK;
  if (config.source === 'uploaded' && config.storageKey) {
    const version = config.updatedAt ? `?v=${encodeURIComponent(config.updatedAt)}` : '';
    return `${MUSIC_MEDIA_PATH}${version}`;
  }
  return null;
}

/**
 * The public music configuration.
 *
 * Deliberately no-store: when the owner publishes a new track, the next page
 * load has to see it. The URL is same-origin and cache-busted by `updatedAt`,
 * so a long-lived audio cache cannot keep serving the previous file. If the
 * configured object is gone the answer is simply "no music" — the public site
 * never shows an error for it.
 */
async function serveMusic(env: Env): Promise<Response> {
  const config = await readMusic(env.DB);
  const available = config.enabled && config.source === 'uploaded' ? await musicFileExists(env, config) : true;
  return noStore(json({ music: publicMusic(config, available) }));
}

/**
 * Streams the uploaded track, with byte-range support so a long file starts
 * playing without downloading all of it. Only ever serves the one object the
 * configuration points at — there is no key in the URL to traverse.
 */
async function serveMusicFile(request: Request, env: Env): Promise<Response> {
  const config = await readMusic(env.DB);
  if (config.source !== 'uploaded' || !config.storageKey) {
    return fail(404, 'no_music', 'No uploaded track is configured.');
  }

  const key = config.storageKey;
  const contentType = config.contentType ?? 'audio/mpeg';
  const range = request.headers.get('range');
  const headers = new Headers({
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=300',
  });

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      // The object's own size is the only trustworthy total here: R2 returns
      // the full object size even for a ranged read, so deriving the end of the
      // response from it would claim the whole file in every Content-Range.
      const head = await env.FILES.head(key);
      if (!head) return fail(404, 'not_found', 'That track is missing from storage.');
      const total = config.byteSize ?? head.size;
      // `bytes=-500` asks for the last 500 bytes, not for a range starting at 0.
      const suffix = !match[1] && match[2] ? Number(match[2]) : null;
      const start = suffix !== null ? Math.max(0, total - suffix) : match[1] ? Number(match[1]) : 0;
      const end = suffix !== null ? total - 1 : Math.min(match[2] ? Number(match[2]) : total - 1, total - 1);

      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end) {
        // RFC 7233: an unsatisfiable range answers 416 and states the real
        // length, rather than silently sending the whole file as a 206.
        headers.set('Content-Range', `bytes */${total}`);
        return new Response(null, { status: 416, headers });
      }

      const length = end - start + 1;
      const object = await env.FILES.get(key, { range: { offset: start, length } });
      if (!object) return fail(404, 'not_found', 'That track is missing from storage.');
      headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
      headers.set('Content-Length', String(length));
      return new Response(object.body, { status: 206, headers });
    }
  }

  const object = await env.FILES.get(key);
  if (!object) return fail(404, 'not_found', 'That track is missing from storage.');
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}

/**
 * The published Contact content, which by definition is public — including the
 * contact address. This is the *public* address from the content document, never
 * the owner's authentication address.
 */
async function serveContactContent(request: Request, env: Env): Promise<Response> {
  const published = await publicContact(env.DB);
  return cachedJson(request, { contact: published.content, updatedAt: published.updatedAt });
}

/**
 * The social section: heading, intro and the ordered list of links.
 *
 * Public by design — these are addresses the owner has chosen to publish — and
 * it never contains an authentication address or anything from the admin side.
 * A disabled link is still in this document; the public component filters, so
 * toggling one back on needs no second write.
 */
async function serveSocialContent(request: Request, env: Env): Promise<Response> {
  const published = await publicSocial(env.DB);
  return cachedJson(request, { social: published.content, updatedAt: published.updatedAt });
}

/** The About page, exactly as visitors should see it (or the owner's draft). */
async function serveAboutContent(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const wantsPreview = url.searchParams.get('preview') === '1';

  if (wantsPreview) {
    if (!(await verifiedOwner(request, env))) {
      return fail(403, 'forbidden', 'Sign in as the owner to preview unpublished changes.');
    }
    const stored = await readAbout(env.DB);
    return noStore(
      json({
        about: stored.draft,
        avatar: avatarFor(stored.draft, true),
        updatedAt: stored.publishedAt ?? stored.draftAt,
        preview: true,
      }),
    );
  }

  const published = await publicAbout(env.DB);
  return cachedJson(request, {
    about: published.content,
    avatar: avatarFor(published.content, false),
    updatedAt: published.updatedAt,
    preview: false,
  });
}

function avatarFor(content: AboutContent, preview: boolean): { url: string; alt: string } | null {
  if (!content.avatarKey) return null;
  return {
    url: preview ? '/api/media/content/avatar?preview=1' : '/api/media/content/avatar',
    alt: content.avatarAlt || 'Portrait of the developer',
  };
}

/** The uploaded portrait. Draft copies need an owner session, like the draft text. */
async function serveAvatar(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const preview = url.searchParams.get('preview') === '1';

  if (preview && !(await verifiedOwner(request, env))) {
    return fail(403, 'forbidden', 'Sign in as the owner to preview this image.');
  }

  const key = await avatarKeyFor(env.DB, preview);
  if (!key) return fail(404, 'not_found', 'No image has been uploaded.');

  const object = await env.FILES.get(key);
  if (!object) return fail(404, 'not_found', 'That image is missing from storage.');

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  // Replacing the portrait has to be visible straight away.
  headers.set('Cache-Control', preview ? 'private, no-store' : 'public, max-age=0, must-revalidate');
  const etag = object.httpEtag ?? weakEtag(String(object.etag ?? object.size));
  headers.set('ETag', etag);
  if (!preview && request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(object.body, { status: 200, headers });
}

async function serveSitemap(env: Env): Promise<Response> {
  const origin = (env.APP_ORIGIN ?? '').replace(/\/+$/, '');
  const games = await listPublicGames(env.DB);
  const routes = ['/', '/games', '/about', '/contact', ...games.filter((game) => game.status === 'published').map((game) => game.path)];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes
  .map((route) => {
    const game = games.find((entry) => entry.path === route);
    return [`  <url>`, `    <loc>${origin}${route === '/' ? '/' : route}</loc>`, game?.updatedAt ? `    <lastmod>${game.updatedAt.slice(0, 10)}</lastmod>` : '', '  </url>']
      .filter(Boolean)
      .join('\n');
  })
  .join('\n')}
</urlset>
`;

  return new Response(origin ? xml : '', {
    status: origin ? 200 : 404,
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' },
  });
}

/* ------------------------------------------------------------------ helpers */

class JsonBodyTooLarge extends Error {
  constructor() {
    super('JSON request body is too large.');
    this.name = 'JsonBodyTooLarge';
  }
}

async function readJson<T>(request: Request): Promise<T | null> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_JSON_BODY_BYTES) throw new JsonBodyTooLarge();

  if (!request.body) return null;

  try {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BODY_BYTES) {
        await reader.cancel();
        throw new JsonBodyTooLarge();
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as T;
  } catch (error) {
    if (error instanceof JsonBodyTooLarge) throw error;
    return null;
  }
}

function boundedText(value: unknown, maxLength: number, required = false): value is string {
  return typeof value === 'string' && value.length <= maxLength && (!required || value.length > 0);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function strList(value: unknown, limit = 30): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    const text = str(entry);
    if (text && text.length <= 80) seen.add(text);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

function controls(value: unknown): GameControls {
  const source = (value ?? {}) as Record<string, unknown>;
  const clean = (input: unknown) => strList(input, 12).map((line) => line.slice(0, 200));
  return { keyboard: clean(source.keyboard), mouse: clean(source.mouse), touch: clean(source.touch) };
}

function toWrite(body: Record<string, unknown>, fallbackSlug: string): GameWrite {
  const status = GAME_STATUSES.includes(body.status as GameStatus) ? (body.status as GameStatus) : 'draft';
  const accent = ACCENTS.includes(body.accent as Accent) ? (body.accent as Accent) : 'cyan';
  const categories = strList(body.categories, 6);
  const date = str(body.releaseDate);

  return {
    slug: slugify(str(body.slug) || fallbackSlug),
    title: str(body.title),
    shortDescription: str(body.shortDescription),
    description: str(body.description),
    categories,
    tags: strList(body.tags, 20).map((tag) => tag.toLowerCase().slice(0, 40)),
    instructions: str(body.instructions).slice(0, 8000),
    controls: controls(body.controls),
    estimatedPlaytime: str(body.estimatedPlaytime) || null,
    version: str(body.version) || null,
    updateNotes: str(body.updateNotes) || null,
    releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    coverAlt: str(body.coverAlt).slice(0, 200),
    accent,
    status,
    listed: body.listed === true,
    featured: body.featured === true,
    itchUrl: str(body.itchUrl) || null,
    itchEmbedUrl: str(body.itchEmbedUrl) || null,
  };
}

/**
 * What still stops a published game from going live.
 *
 * The same four facts the dashboard checks — title, page address, embed
 * address, cover art — are enforced here, because the API is reachable without
 * the dashboard. itch.io addresses are already validated by
 * `validateGameInput`; this adds the two facts that depend on stored artwork and
 * returns them keyed by field so the editor can point at the right input.
 */
function publicationBlockers(
  write: GameWrite,
  row: { thumbnail_key: string | null; banner_key: string | null } | null,
): Record<string, string> {
  if (write.status !== 'published') return {};
  const blockers: Record<string, string> = {};
  if (!write.title.trim()) blockers.title = 'A published game needs a title.';
  if (!write.itchUrl) blockers.itchUrl = 'Add the game’s itch.io page address before publishing.';
  if (!write.itchEmbedUrl) blockers.itchEmbedUrl = 'Add the playable itch.io embed address before publishing.';
  if (!row || (!row.thumbnail_key && !row.banner_key)) {
    blockers.artwork = 'Upload cover art (Step C) before publishing.';
  }
  return blockers;
}

/* -------------------------------------------------------------- build ingest */

async function storeBuildFile(
  env: Env,
  build: BuildRow,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  await env.FILES.put(`builds/${build.game_id}/${build.id}/${path}`, bytes, {
    httpMetadata: { contentType, cacheControl: 'public, max-age=3600' },
  });
  await recordBuildFile(env.DB, build.id, { path, size: bytes.byteLength, contentType });
}

interface ZipResult {
  stored: number;
  skipped: { path: string; reason: string }[];
}

async function ingestZip(env: Env, build: BuildRow, bytes: Uint8Array, config: Limits): Promise<ZipResult> {
  const skipped: { path: string; reason: string }[] = [];
  let declared = 0;
  let acceptedFiles = 0;
  let countOverflow = false;

  const files = unzipSync(bytes, {
    filter: (file) => {
      if (file.name.endsWith('/')) return false;
      const safe = safeBuildPath(file.name);
      if (!safe) {
        skipped.push({ path: file.name, reason: 'unsupported file type or unsafe path' });
        return false;
      }
      if (file.originalSize > config.maxFileBytes) {
        skipped.push({ path: file.name, reason: 'larger than the per-file limit' });
        return false;
      }
      if (fileCountExceedsLimit(acceptedFiles + 1, config.maxBuildFiles)) {
        if (!countOverflow) {
          skipped.push({ path: file.name, reason: `archive contains more than ${Math.floor(config.maxBuildFiles)} files` });
          countOverflow = true;
        }
        return false;
      }
      acceptedFiles += 1;
      declared += file.originalSize;
      if (declared > config.maxBuildBytes) {
        skipped.push({ path: file.name, reason: 'archive expands past the build size limit' });
        return false;
      }
      return true;
    },
  });

  const entries: ArchiveEntry[] = [];
  for (const [name, data] of Object.entries(files)) {
    const safe = safeBuildPath(name);
    if (!safe) continue;
    // The central directory can lie about sizes; these are the real numbers.
    if (data.byteLength > config.maxFileBytes) {
      skipped.push({ path: name, reason: 'larger than the per-file limit' });
      continue;
    }
    entries.push({ path: safe, bytes: data });
  }

  // The filter normally catches this before extraction. Keep the post-extract
  // check as a defence against a decompressor or metadata discrepancy: the
  // server must reject an overflowing archive, never publish a prefix of it.
  if (fileCountExceedsLimit(entries.length, config.maxBuildFiles) && !countOverflow) {
    skipped.push({ path: '…', reason: `archive contains more than ${Math.floor(config.maxBuildFiles)} files` });
  }

  /* Never silently publish a partial archive. The browser uploader validates
     each file before sending it; the server-side ZIP path must enforce the same
     contract instead of quietly dropping unsafe or oversized entries. */
  if (skipped.length > 0) {
    await markBuildStatus(
      env.DB,
      build.id,
      'failed',
      null,
      `Archive validation failed: ${skipped.map((entry) => `${entry.path} (${entry.reason})`).join('; ')}`.slice(0, 2000),
    );
    return { stored: 0, skipped };
  }

  const { files: trimmed, strippedPrefix } = stripSingleRoot(entries, config.maxBuildFiles);
  const selected = trimmed.slice(0, config.maxBuildFiles);
  if (trimmed.length > selected.length) skipped.push({ path: '…', reason: `archive contains more than ${Math.floor(config.maxBuildFiles)} files` });

  if (skipped.length > 0) {
    await markBuildStatus(
      env.DB,
      build.id,
      'failed',
      null,
      `Archive validation failed: ${skipped.map((entry) => `${entry.path} (${entry.reason})`).join('; ')}`.slice(0, 2000),
    );
    return { stored: 0, skipped };
  }

  let stored = 0;
  for (const entry of selected) {
    await storeBuildFile(env, build, entry.path, entry.bytes, contentTypeFor(entry.path));
    stored += 1;
  }

  const paths = selected.map((entry) => entry.path);
  const detection = detectEntryPath(paths);
  if (detection.entry) await markBuildStatus(env.DB, build.id, 'ready', detection.entry, strippedPrefix ? `stripped folder "${strippedPrefix}"` : null);
  else {
    await markBuildStatus(
      env.DB,
      build.id,
      'failed',
      null,
      detection.candidates.length === 0
        ? 'No HTML file found in the archive.'
        : 'Several HTML files found — choose the entry file explicitly.',
    );
  }
  return { stored, skipped };
}

/* ---------------------------------------------------------------- the router */

export function createApp() {
  return async function handle(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const config = limits(env);

    /* -------------------------------------------------------- public routes */

    if (path === '/api/health') {
      /*
       * Public, so it reports what the public catalogue actually contains, not
       * how many rows the database happens to hold: drafts, archives and test
       * records are owner data, and their count is not a visitor's business.
       */
      const games = await listPublicGames(env.DB);
      return json({ ok: true, games: games.length, storage: 'r2', time: nowIso() }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (path === '/api/catalogue' && request.method === 'GET') return serveCatalogue(request, env);

    if (path.startsWith('/api/catalogue/') && request.method === 'GET') {
      const slug = decodePathSegment(path.slice('/api/catalogue/'.length));
      if (slug === null) return fail(400, 'bad_path', 'Malformed game address.');
      return serveGame(request, env, slug);
    }

    if (path.startsWith('/api/media/artwork/') && request.method === 'GET') {
      const [, , , , gameId, kind] = path.split('/');
      return serveArtwork(request, env, gameId ?? '', kind ?? '', null);
    }

    if (path.startsWith('/api/media/screenshot/') && request.method === 'GET') {
      const [, , , , gameId, index] = path.split('/');
      return serveArtwork(request, env, gameId ?? '', 'screenshot', index ?? null);
    }

    if (path.startsWith('/play/')) {
      const rest = path.slice('/play/'.length);
      const slash = rest.indexOf('/');
      const slug = decodePathSegment(slash === -1 ? rest : rest.slice(0, slash));
      if (slug === null) return fail(400, 'bad_path', 'Malformed game address.');
      return serveBuild(request, env, slug, slash === -1 ? '' : rest.slice(slash + 1));
    }

    if (path === '/api/settings' && request.method === 'GET') return serveSettings(request, env);

    /* The background-music document, and the audio it points at. Both are
       public by design; neither carries a storage key or anything private. */
    if (path === '/api/music' && request.method === 'GET') return serveMusic(env);

    if (path === MUSIC_MEDIA_PATH && request.method === 'GET') return serveMusicFile(request, env);

    if (path === '/api/content/about' && request.method === 'GET') return serveAboutContent(request, env);

    if (path === '/api/content/contact' && request.method === 'GET') return serveContactContent(request, env);

    if (path === '/api/content/social' && request.method === 'GET') return serveSocialContent(request, env);

    if (path === '/api/media/content/avatar' && request.method === 'GET') return serveAvatar(request, env);

    if (path === '/sitemap.xml') return serveSitemap(env);

    /* --------------------------------------------------------- admin routes */

    if (path.startsWith('/api/admin/')) {
      const context = await resolveOwner(request, env);
      /* An owner record is *configuration*, not authentication. The session
         below is the only thing that unlocks admin data, and it is created by
         an accepted verification code. */
      const session = context.owner ? await readSession(request, env, context.owner.sub) : null;

      if (path === '/api/admin/session') {
        return noStore(
          json({
            /*
             * The identity and its factors are reported only to a session that
             * passed both factors. An anonymous visitor gets just enough to
             * render the gate: whether an owner exists, whether setup is
             * possible, and whether a code could be delivered. No address, in
             * any form, is included before verification.
             */
            owner:
              context.owner && session
                ? { sub: context.owner.sub, email: context.owner.email ? maskEmail(context.owner.email) : null }
                : null,
            ownerConfigured: context.ownerConfigured,
            /** True when first-run provisioning is available on this deploy. */
            setupEnabled: context.setupEnabled,
            gate: context.owner && !session ? await gateState(env, request, context.owner) : null,
            // Masked addresses and factor status, for a verified session only.
            security: context.owner && session ? await securityState(env, request, context.owner, session) : null,
            // The dashboard reads these once per session to size its uploader.
            limits: {
              maxBuildBytes: config.maxBuildBytes,
              maxFileBytes: config.maxFileBytes,
              maxBuildFiles: config.maxBuildFiles,
              maxZipBytes: config.maxZipBytes,
            },
          }),
        );
      }

      const mutating = request.method !== 'GET' && request.method !== 'HEAD';
      if (mutating && !isSameOriginRequest(request, env.APP_ORIGIN ?? '')) {
        return fail(403, 'bad_origin', 'This request did not come from the site itself.');
      }

      /* Local development only. It clears the sticky rate-limit state so the
         verification harness can be re-run; the guard is the seam itself, which
         requires DEV_OWNER_SUB plus a loopback origin and request — none of
         which a deployment can satisfy.

         An optional body narrows the scope: the harness clears challenges and
         the audit trail between steps that deliberately trip a limit, while
         leaving its session alone. `authEmail: true` additionally points
         verification back at the configured OTP destination, so a run that
         ended early cannot leave the next one starting from a temporary
         address. */
      if (path === '/api/admin/dev/security-reset' && request.method === 'POST') {
        if (!context.devSeam) {
          return fail(403, 'forbidden', 'This local development endpoint is not available here.');
        }
        const scope =
          (await readJson<{ sessions?: boolean; challenges?: boolean; events?: boolean; authEmail?: boolean; uploads?: boolean }>(
            request,
          )) ?? {};
        const target = context.owner?.sub ?? (await resolveOwnerSub(env));
        return noStore(
          json({
            cleared: await resetSecurityState(env, target, {
              challenges: scope.challenges,
              events: scope.events,
              sessions: scope.sessions,
              authEmail: scope.authEmail,
              uploads: scope.uploads,
            }),
          }),
        );
      }

      /* Also local development only, behind the same seam: the verification
         harness edits the About page and the social links and must start each
         run from the shipped defaults. It rewrites draft and published, so a
         run that ended early cannot leave the next one comparing against its
         own leftovers. The same reset restores the bundled soundtrack and
         deletes uploaded audio, so a harness that exercised the music editor
         cannot leave the next run playing its test file. */
      if (path === '/api/admin/dev/content-reset' && request.method === 'POST') {
        if (!context.devSeam) {
          return fail(403, 'forbidden', 'This local development endpoint is not available here.');
        }
        const musicObjects = await resetMusicToDefaults(env);
        return noStore(json({ reset: await resetContentToDefaults(env.DB), music: { reset: 'bundled', objects: musicObjects } }));
      }

      if (!context.owner) {
        return fail(
          503,
          'owner_unconfigured',
          'This deployment has no owner configured yet. An operator must set OWNER_LOGIN_EMAIL, an OTP destination and OWNER_SETUP_TOKEN in the Worker environment.',
        );
      }

      /* The password and code endpoints are how a session is established, so
         they are reachable without one; every other admin route is not. */
      const auth = await authRoutes(request, env, context.owner, session, { url, path });
      if (auth) return noStore(auth);

      if (!session) {
        return fail(
          401,
          'verification_required',
          'Verify your identity with the code sent to your authentication address before using the dashboard.',
        );
      }

      return noStore(await adminRoutes(request, env, { url, path, actor: context.owner.sub, config, session, owner: context.owner }));
    }

    /* ------------------------------------------------------------ static app */

    // An unknown path under the API namespace must not fall through to the SPA,
    // which would answer 200 with an HTML page where JSON was expected.
    if (path.startsWith('/api/')) return fail(404, 'not_found', 'Unknown API endpoint.');

      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof JsonBodyTooLarge) return fail(413, 'too_large', 'JSON request bodies are limited to 128 KB.');
      throw error;
    }
  };
}

interface AdminContext {
  url: URL;
  path: string;
  actor: string;
  config: Limits;
  /** A verified session: without one, no admin route is reachable. */
  session: SessionRow;
  owner: { sub: string; email: string | null };
}

/** The public contact address must never overlap any private owner address. */
async function isPrivateOwnerEmail(env: Env, actor: string, email: string): Promise<boolean> {
  const auth = await getOwnerAuth(env.DB, actor);
  const privateAddresses = [
    configuredLoginEmail(env),
    configuredOtpEmail(env),
    seedOtpEmail(env),
    auth?.login_email,
    auth?.auth_email,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  return privateAddresses.includes(email.trim().toLowerCase());
}

function failureResponse(failure: Failure): Response {
  const response = fail(failure.status, failure.code, failure.message, {
    ...(failure.fields ?? {}),
    ...(failure.detail ? { provider: failure.detail } : {}),
  });
  if (failure.retryAfterSeconds) response.headers.set('Retry-After', String(failure.retryAfterSeconds));
  return response;
}

/**
 * The password factor and the second factor.
 *
 * These routes are deliberately reachable without a session: they are how one is
 * created. Everything else under /api/admin requires the session they produce,
 * and no route here returns admin data before a code has been accepted.
 */
async function authRoutes(
  request: Request,
  env: Env,
  owner: { sub: string; email: string | null },
  session: SessionRow | null,
  ctx: { url: URL; path: string },
): Promise<Response | null> {
  const method = request.method;

  /*
   * Deliberately *not* here: `/api/admin/security/state`. It reports which
   * factors exist and where a masked code would go, which is private
   * configuration — it lives with the session-protected routes, and the
   * sign-in gate reads only `/api/admin/session` (which masks everything).
   */

  if (ctx.path === '/api/admin/auth/login' && method === 'POST') {
    const body = await readJson<{ email?: string; password?: string }>(request);
    if (!body) return fail(400, 'bad_body', 'Expected a JSON body.');
    if (!boundedText(body.email, MAX_AUTH_EMAIL_LENGTH, true) || !boundedText(body.password, PASSWORD_MAX_LENGTH, true)) {
      return fail(422, 'invalid', 'Enter your administrator address and password.', {
        email: 'Enter your administrator address.',
        password: 'Enter your password.',
      });
    }

    const outcome = await startChallenge(
      env,
      request,
      owner,
      { purpose: 'login', email: body.email, password: body.password },
      null,
    );
    return outcome.ok ? json(outcome.value) : failureResponse(outcome);
  }

  if (ctx.path === '/api/admin/auth/challenge' && method === 'POST') {
    const body = await readJson<{ purpose?: string; password?: string; newEmail?: string; email?: string }>(request);
    if (!body) return fail(400, 'bad_body', 'Expected a JSON body.');
    const purpose = CHALLENGE_PURPOSES.find((entry) => entry === body.purpose);
    if (!purpose) return fail(422, 'bad_purpose', 'Unknown verification purpose.');

    const fields: Record<string, string> = {};
    if (!boundedText(body.password, PASSWORD_MAX_LENGTH, true)) fields.password = 'Enter a password of 200 characters or fewer.';
    if (purpose === 'login' && !boundedText(body.email, MAX_AUTH_EMAIL_LENGTH, true)) {
      fields.email = 'Enter an administrator address of 160 characters or fewer.';
    }
    if (purpose === 'email-change' && !boundedText(body.newEmail, MAX_AUTH_EMAIL_LENGTH, true)) {
      fields.newEmail = 'Enter an email address of 160 characters or fewer.';
    }
    if (Object.keys(fields).length > 0) return fail(422, 'invalid', 'Some fields need attention.', fields);

    const outcome = await startChallenge(
      env,
      request,
      owner,
      { purpose, password: body.password, newEmail: body.newEmail, email: body.email },
      session,
    );
    return outcome.ok ? json(outcome.value) : failureResponse(outcome);
  }

  if (ctx.path === '/api/admin/auth/verify' && method === 'POST') {
    const body = await readJson<{ challengeId?: string; code?: string }>(request);
    if (!boundedText(body?.challengeId, MAX_CHALLENGE_ID_LENGTH, true) || !isOtpCode(body?.code)) {
      return fail(422, 'invalid', 'A verification request and code are required.', { code: 'Enter the six-digit code.' });
    }

    const outcome = await verifyChallenge(env, request, owner, body.challengeId, body.code);
    if (!outcome.ok) return failureResponse(outcome);

    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' });
    if (outcome.value.sessionCookie) headers.append('Set-Cookie', outcome.value.sessionCookie);
    if (outcome.value.changeCookie) headers.append('Set-Cookie', outcome.value.changeCookie);

    return json(
      {
        verified: true,
        purpose: outcome.value.challenge.purpose,
        appliedEmail: outcome.value.appliedEmail ? maskEmail(outcome.value.appliedEmail) : null,
        sessionEstablished: Boolean(outcome.value.sessionId),
        changeAuthorised: Boolean(outcome.value.changeTicket),
      },
      { headers },
    );
  }

  if (ctx.path === '/api/admin/auth/setup' && method === 'POST') {
    const body = await readJson<{ email?: string; password?: string; confirm?: string; setupToken?: string }>(request);
    if (!body) return fail(400, 'bad_body', 'Expected a JSON body.');
    const fields: Record<string, string> = {};
    if (!boundedText(body.email, MAX_AUTH_EMAIL_LENGTH, true)) fields.email = 'Enter an email address of 160 characters or fewer.';
    if (!boundedText(body.password, PASSWORD_MAX_LENGTH, true)) fields.password = 'Enter a password of 200 characters or fewer.';
    if (!boundedText(body.confirm, PASSWORD_MAX_LENGTH, true)) fields.confirm = 'Re-enter a password of 200 characters or fewer.';
    if (!boundedText(body.setupToken, MAX_SETUP_TOKEN_LENGTH, true)) fields.setupToken = 'Enter a setup token of 512 characters or fewer.';
    if (Object.keys(fields).length > 0) return fail(422, 'invalid', 'Some fields need attention.', fields);
    const outcome = await startSetup(env, request, owner, {
      email: body.email ?? '',
      password: body.password ?? '',
      confirm: body.confirm ?? '',
      setupToken: body.setupToken ?? '',
    });
    return outcome.ok ? json(outcome.value) : failureResponse(outcome);
  }

  if (ctx.path === '/api/admin/auth/signout' && method === 'POST') {
    await signOut(env, owner, session);
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' });
    headers.append('Set-Cookie', clearSessionCookie(request));
    headers.append('Set-Cookie', clearChangeCookie(request));
    return json({ signedOut: true }, { headers });
  }

  return null;
}

async function adminRoutes(request: Request, env: Env, ctx: AdminContext): Promise<Response> {
  const { url, path, actor, config } = ctx;
  const method = request.method;
  const segments = path.split('/').filter(Boolean); // api, admin, ...

  /* --------------------------------------------------------- security state */

  if (path === '/api/admin/security/state' && method === 'GET') {
    return json({ security: await securityState(env, request, ctx.owner, ctx.session) });
  }

  /* -------------------------------------------------------------- overview */

  if (path === '/api/admin/overview' && method === 'GET') {
    const games = await listAllGames(env.DB);
    const counts = {
      total: games.length,
      published: 0,
      inDevelopment: 0,
      comingSoon: 0,
      draft: 0,
      unavailable: 0,
      archived: 0,
      publishedWithoutPlayer: 0,
      withPlayer: 0,
    };
    for (const game of games) {
      if (game.status === 'published') {
        counts.published += 1;
        if (!game.playable) counts.publishedWithoutPlayer += 1;
      }
      if (game.status === 'in-development') counts.inDevelopment += 1;
      if (game.status === 'coming-soon') counts.comingSoon += 1;
      if (game.status === 'draft') counts.draft += 1;
      if (game.status === 'unavailable') counts.unavailable += 1;
      if (game.status === 'archived') counts.archived += 1;
      if (game.itch.embedUrl) counts.withPlayer += 1;
    }
    const body: OverviewResponse = { counts, recent: await recentlyUpdated(env.DB, 6) };
    return json(body);
  }

  /* ----------------------------------------------------------------- games */

  if (path === '/api/admin/games' && method === 'GET') {
    const games = await listAllGames(env.DB);
    return json({ games });
  }

  if (path === '/api/admin/games' && method === 'POST') {
    const body = await readJson<Record<string, unknown>>(request);
    if (!body) return fail(400, 'bad_body', 'Expected a JSON body.');

    const write = toWrite(body, `game-${Date.now()}`);
    const errors = validateGameInput({ ...write, status: write.status });
    if (Object.keys(errors).length > 0) return fail(422, 'invalid', 'Some fields need attention.', errors);
    if (await slugExists(env.DB, write.slug)) return fail(409, 'slug_taken', `The address /games/${write.slug} is already used.`, { slug: 'That slug is taken.' });

    // Publishing needs stored artwork, and a new row has none yet.
    const createBlockers = publicationBlockers(write, null);
    if (Object.keys(createBlockers).length > 0) {
      return fail(409, 'not_ready', 'Save the listing as a draft first, then add artwork and connect itch.io.', createBlockers);
    }

    const id = crypto.randomUUID();
    await insertGame(env.DB, id, write);
    const game = await getGameWithBuilds(env.DB, id, 'id');
    return json({ game }, { status: 201 });
  }

  if (segments.length >= 4 && segments[2] === 'games') {
    const id = segments[3];

    if (path === `/api/admin/games/${id}` && method === 'GET') {
      const game = await getGameWithBuilds(env.DB, id, 'id');
      return game ? json({ game }) : fail(404, 'not_found', 'No such game.');
    }

    if (path === `/api/admin/games/${id}` && method === 'PATCH') {
      const row = await getGameRow(env.DB, id, 'id');
      if (!row) return fail(404, 'not_found', 'No such game.');

      const body = await readJson<Record<string, unknown>>(request);
      if (!body) return fail(400, 'bad_body', 'Expected a JSON body.');

      // Absent fields keep their stored value; the body only overrides what it sends.
      const merged = toWrite({ ...rowToWriteSource(row), ...body }, row.slug);
      const errors = validateGameInput(merged);
      if (Object.keys(errors).length > 0) return fail(422, 'invalid', 'Some fields need attention.', errors);
      if (await slugExists(env.DB, merged.slug, id)) return fail(409, 'slug_taken', `The address /games/${merged.slug} is already used.`, { slug: 'That slug is taken.' });

      // Validation catches missing addresses; this adds cover art, which lives
      // in storage rather than in the submitted body.
      const blockers = publicationBlockers(merged, row);
      if (Object.keys(blockers).length > 0) {
        return fail(409, 'not_ready', 'Connect itch.io and add cover art before publishing this game.', blockers);
      }

      await updateGame(env.DB, id, merged, row.status);
      const game = await getGameWithBuilds(env.DB, id, 'id');
      return json({ game });
    }

    if (path === `/api/admin/games/${id}` && method === 'DELETE') {
      const row = await getGameRow(env.DB, id, 'id');
      if (!row) return fail(404, 'not_found', 'No such game.');

      const mode = url.searchParams.get('mode') === 'purge' ? 'purge' : 'archive';
      if (mode === 'archive') {
        if (row.status === 'archived') return json({ archived: true, game: await getGameWithBuilds(env.DB, id, 'id') });
        await env.DB.prepare("UPDATE games SET status = 'archived', listed = 0, archived_at = ?, updated_at = ? WHERE id = ?")
          .bind(nowIso(), nowIso(), id)
          .run();
        await recordEvent(env.DB, { actor, kind: 'delete', gameId: id, detail: 'archived' });
        return json({ archived: true, game: await getGameWithBuilds(env.DB, id, 'id') });
      }

      // Permanent delete: remove this game's objects and nothing else.
      const builds = await buildsForGame(env.DB, id);
      const keys: string[] = [];
      for (const build of builds) {
        const files = await getBuildFiles(env.DB, build.id);
        for (const file of files) keys.push(`builds/${id}/${build.id}/${file.path}`);
      }
      if (row.thumbnail_key) keys.push(row.thumbnail_key);
      if (row.banner_key) keys.push(row.banner_key);
      keys.push(...parseJson<string[]>(row.screenshots, []));

      for (let index = 0; index < keys.length; index += 500) {
        await env.FILES.delete(keys.slice(index, index + 500));
      }
      await deleteGame(env.DB, id);
      await recordEvent(env.DB, { actor, kind: 'delete', gameId: id, detail: `purged ${keys.length} objects` });
      return json({ deleted: true, objects: keys.length });
    }

    if (path === `/api/admin/games/${id}/duplicate` && method === 'POST') {
      const row = await getGameRow(env.DB, id, 'id');
      if (!row) return fail(404, 'not_found', 'No such game.');

      const base = slugify(`${row.slug}-copy`);
      let slug = base;
      for (let attempt = 2; await slugExists(env.DB, slug); attempt += 1) slug = `${base}-${attempt}`;

      const copyId = crypto.randomUUID();
      // Metadata only: a duplicate starts as a draft with no build or artwork.
      await insertGame(env.DB, copyId, {
        ...toWrite(rowToWriteSource(row), slug),
        title: `${row.title} (copy)`,
        slug,
        status: 'draft',
        listed: false,
        featured: false,
      });
      return json({ game: await getGameWithBuilds(env.DB, copyId, 'id') }, { status: 201 });
    }

    if (path === `/api/admin/games/${id}/builds` && method === 'POST') {
      const row = await getGameRow(env.DB, id, 'id');
      if (!row) return fail(404, 'not_found', 'No such game.');

      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      /*
       * One budget for both upload paths. Counting only browser-initiated builds
       * let a script skip the limit entirely by posting ZIPs, even though each
       * one creates a build record and writes objects.
       */
      if ((await countEventsSince(env.DB, actor, ['build.init', 'build.zip'], since)) >= MAX_BUILD_INITS_PER_HOUR) {
        return fail(429, 'rate_limited', 'Too many build uploads in the last hour. Try again shortly.');
      }

      const contentType = request.headers.get('content-type') ?? '';
      const buildId = crypto.randomUUID();
      const buildVersion = str(url.searchParams.get('version')) || row.version || null;

      if (contentType.includes('application/zip') || contentType.includes('application/octet-stream')) {
        const declared = Number(request.headers.get('content-length') ?? '0');
        if (declared > config.maxZipBytes) return fail(413, 'too_large', `ZIP uploads are limited to ${Math.round(config.maxZipBytes / 1024 / 1024)} MB. Use the browser uploader for larger builds.`);

        const buffer = new Uint8Array(await request.arrayBuffer());
        if (buffer.byteLength === 0) return fail(400, 'empty', 'That upload was empty.');
        if (buffer.byteLength > config.maxZipBytes) return fail(413, 'too_large', 'That archive is larger than the server-side limit.');

        await createBuild(env.DB, { id: buildId, gameId: id, version: buildVersion, notes: 'server-side ZIP extraction' });
        const build = await getBuildRow(env.DB, buildId);
        if (!build) return fail(500, 'create_failed', 'Could not create the build record.');

        let result: ZipResult;
        try {
          result = await ingestZip(env, build, buffer, config);
        } catch (error) {
          await markBuildStatus(env.DB, buildId, 'failed', null, `Extraction failed: ${(error as Error).message}`);
          return fail(422, 'bad_archive', 'That file could not be read as a ZIP archive.');
        }

        await recordEvent(env.DB, { actor, kind: 'build.zip', gameId: id, buildId, detail: `${result.stored} files`, size: buffer.byteLength });
        const fresh = await buildsForGame(env.DB, id);
        const created = fresh.find((entry) => entry.id === buildId) ?? null;
        return json({ build: created ? buildSummary(created) : null, stored: result.stored, skipped: result.skipped });
      }

      await createBuild(env.DB, { id: buildId, gameId: id, version: buildVersion, notes: 'browser extraction' });
      await recordEvent(env.DB, { actor, kind: 'build.init', gameId: id, buildId });
      return json(
        {
          buildId,
          limits: { maxFileBytes: config.maxFileBytes, maxBuildBytes: config.maxBuildBytes, maxBuildFiles: config.maxBuildFiles },
        },
        { status: 201 },
      );
    }

    /* -------------------------------------------------------------- artwork */

    if (segments.length === 5 && segments[4] === 'artwork' && segments[2] === 'games') {
      const kind = url.searchParams.get('kind');
      if (method === 'PUT') {
        if (kind !== 'thumbnail' && kind !== 'banner') return fail(400, 'bad_kind', 'Artwork kind must be thumbnail or banner.');
        const row = await getGameRow(env.DB, id, 'id');
        if (!row) return fail(404, 'not_found', 'No such game.');

        const declared = Number(request.headers.get('content-length') ?? '0');
        if (declared > MAX_ARTWORK_BYTES) return fail(413, 'too_large', 'Artwork must be 8 MB or smaller.');

        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.byteLength === 0) return fail(400, 'empty', 'That upload was empty.');
        // Content-Length can be missing (chunked) or lie; the real bytes decide.
        if (bytes.byteLength > MAX_ARTWORK_BYTES) return fail(413, 'too_large', 'Artwork must be 8 MB or smaller.');
        const image = sniffImage(bytes);
        if (!image) return fail(415, 'unsupported_image', 'Upload a PNG, JPEG, WebP, GIF or AVIF image.');

        const key = `artwork/${id}/${kind}-${crypto.randomUUID()}.${image.extension}`;
        await env.FILES.put(key, bytes, { httpMetadata: { contentType: image.contentType, cacheControl: 'public, max-age=300' } });

        const previous = kind === 'thumbnail' ? row.thumbnail_key : row.banner_key;
        await setArtworkKey(env.DB, id, kind, key);
        if (previous && previous !== key) await env.FILES.delete(previous);
        await recordEvent(env.DB, { actor, kind: 'artwork', gameId: id, detail: kind, size: bytes.byteLength });

        return json({ game: await getGameWithBuilds(env.DB, id, 'id') });
      }

      if (method === 'DELETE') {
        if (kind !== 'thumbnail' && kind !== 'banner') return fail(400, 'bad_kind', 'Artwork kind must be thumbnail or banner.');
        const row = await getGameRow(env.DB, id, 'id');
        if (!row) return fail(404, 'not_found', 'No such game.');
        const previous = kind === 'thumbnail' ? row.thumbnail_key : row.banner_key;
        await setArtworkKey(env.DB, id, kind, null);
        if (previous) await env.FILES.delete(previous);
        return json({ game: await getGameWithBuilds(env.DB, id, 'id') });
      }
    }

    if (path === `/api/admin/games/${id}/screenshots` && method === 'POST') {
      const row = await getGameRow(env.DB, id, 'id');
      if (!row) return fail(404, 'not_found', 'No such game.');

      const shots = parseJson<string[]>(row.screenshots, []);
      if (shots.length >= MAX_SCREENSHOTS) return fail(409, 'too_many', `A game can have at most ${MAX_SCREENSHOTS} screenshots.`);

      const declared = Number(request.headers.get('content-length') ?? '0');
      if (declared > MAX_ARTWORK_BYTES) return fail(413, 'too_large', 'Screenshots must be 8 MB or smaller.');

      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength > MAX_ARTWORK_BYTES) return fail(413, 'too_large', 'Screenshots must be 8 MB or smaller.');
      const image = bytes.byteLength > 0 ? sniffImage(bytes) : null;
      if (!image) return fail(415, 'unsupported_image', 'Upload a PNG, JPEG, WebP, GIF or AVIF image.');

      const key = `artwork/${id}/shot-${crypto.randomUUID()}.${image.extension}`;
      await env.FILES.put(key, bytes, { httpMetadata: { contentType: image.contentType, cacheControl: 'public, max-age=300' } });
      await setScreenshotKeys(env.DB, id, [...shots, key]);
      await recordEvent(env.DB, { actor, kind: 'artwork', gameId: id, detail: 'screenshot', size: bytes.byteLength });
      return json({ game: await getGameWithBuilds(env.DB, id, 'id') }, { status: 201 });
    }

    if (segments.length === 5 && segments[4] === 'screenshots' && method === 'DELETE') {
      const row = await getGameRow(env.DB, id, 'id');
      if (!row) return fail(404, 'not_found', 'No such game.');
      const shots = parseJson<string[]>(row.screenshots, []);
      const index = Number(url.searchParams.get('index'));
      if (!Number.isInteger(index) || index < 0 || index >= shots.length) return fail(400, 'bad_index', 'Unknown screenshot.');

      const [removed] = shots.splice(index, 1);
      await setScreenshotKeys(env.DB, id, shots);
      if (removed) await env.FILES.delete(removed);
      return json({ game: await getGameWithBuilds(env.DB, id, 'id') });
    }
  }

  /* ---------------------------------------------------------------- builds */

  if (segments.length >= 4 && segments[2] === 'builds') {
    const buildId = segments[3];
    const build = await getBuildRow(env.DB, buildId);
    if (!build) return fail(404, 'not_found', 'No such build.');

    if (path === `/api/admin/builds/${buildId}` && method === 'GET') {
      const [files, game] = await Promise.all([getBuildFiles(env.DB, buildId), getGameWithBuilds(env.DB, build.game_id, 'id')]);
      return json({ build: buildSummary(build), files, game });
    }

    if (path === `/api/admin/builds/${buildId}/files` && method === 'PUT') {
      if (build.status !== 'uploading') return fail(409, 'build_closed', 'This build is no longer accepting files.');
      if (method === 'PUT' && !url.searchParams.get('path')) return fail(400, 'missing_path', 'A path query parameter is required.');

      const safe = safeBuildPath(url.searchParams.get('path') ?? '');
      if (!safe) return fail(415, 'unsupported_file', 'That file type or path is not allowed in a game build.');

      const declared = Number(request.headers.get('content-length') ?? '0');
      if (declared > config.maxFileBytes) return fail(413, 'too_large', 'That file is larger than the per-file limit.');

      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      if ((await countEventsSince(env.DB, actor, 'build.file', since)) >= MAX_UPLOAD_EVENTS_PER_HOUR) {
        return fail(429, 'rate_limited', 'Too many upload requests in the last hour.');
      }

      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength === 0) return fail(400, 'empty', 'That file was empty.');
      if (bytes.byteLength > config.maxFileBytes) return fail(413, 'too_large', 'That file is larger than the per-file limit.');

      const existing = await getBuildFiles(env.DB, buildId);
      const alreadyStored = existing.some((file) => file.path === safe);
      const currentBytes = existing.reduce((total, file) => total + file.size, 0);
      if (!alreadyStored && existing.length >= config.maxBuildFiles) return fail(413, 'too_many_files', 'This build has reached its file limit.');
      if (!alreadyStored && currentBytes + bytes.byteLength > config.maxBuildBytes) return fail(413, 'too_large', 'This build has reached its total size limit.');

      await storeBuildFile(env, build, safe, bytes, contentTypeFor(safe));
      await recordEvent(env.DB, { actor, kind: 'build.file', gameId: build.game_id, buildId, detail: safe, size: bytes.byteLength });

      const updated = await getBuildRow(env.DB, buildId);
      return json({ path: safe, size: bytes.byteLength, fileCount: updated?.file_count ?? 0, totalBytes: updated?.total_bytes ?? 0 });
    }

    if (path === `/api/admin/builds/${buildId}/files` && method === 'GET') {
      return json({ files: await getBuildFiles(env.DB, buildId) });
    }

    if (path === `/api/admin/builds/${buildId}/finalize` && method === 'POST') {
      if (build.status !== 'uploading') return fail(409, 'build_closed', 'This build was already finalised.');

      const files = await getBuildFiles(env.DB, buildId);
      if (files.length === 0) return fail(422, 'empty_build', 'No files were uploaded for this build.');

      const body = (await readJson<{ entry?: string }>(request)) ?? {};
      const requested = body.entry ? safeBuildPath(body.entry) : null;
      const paths = files.map((file) => file.path);

      let entry: string | null;
      if (requested) entry = requested;
      else entry = detectEntryPath(paths).entry;

      if (!entry) {
        return fail(422, 'entry_ambiguous', 'Choose which HTML file launches the game.', {
          entry: 'No single index.html was found — pick the entry file.',
        });
      }
      if (!isHtmlPath(entry)) return fail(422, 'bad_entry', 'The entry file must be an HTML file.');
      if (!paths.includes(entry)) return fail(422, 'missing_entry', 'That entry file was not uploaded.');

      await markBuildStatus(env.DB, buildId, 'ready', entry);
      const fresh = await getBuildRow(env.DB, buildId);
      return json({ build: fresh ? buildSummary(fresh) : null });
    }

    if (path === `/api/admin/builds/${buildId}/activate` && method === 'POST') {
      if (!build.entry_path) return fail(422, 'no_entry', 'Finalise the build (and pick its entry file) before activating it.');
      /*
       * Only a finished build may go live. `failed`, `uploading` and `rejected`
       * can still carry an old entry path from an earlier state, and activating
       * one would make the public page point at an incomplete upload.
       */
      if (!isActivatableBuild(build.status)) {
        return fail(422, 'build_not_ready', 'This build is not ready to activate. Finalise it first.');
      }

      await activateBuild(env.DB, build.game_id, buildId);
      const game = await getGameWithBuilds(env.DB, build.game_id, 'id');
      return json({ game });
    }

    if (path === `/api/admin/builds/${buildId}` && method === 'DELETE') {
      const game = await getGameRow(env.DB, build.game_id, 'id');
      if (game?.active_build_id === buildId) {
        return fail(409, 'build_active', 'This build is live. Activate another build first, or delete the game.');
      }
      const files = await getBuildFiles(env.DB, buildId);
      const keys = files.map((file) => `builds/${build.game_id}/${buildId}/${file.path}`);
      for (let index = 0; index < keys.length; index += 500) await env.FILES.delete(keys.slice(index, index + 500));
      await deleteBuildRow(env.DB, buildId);
      await touchGame(env.DB, build.game_id);
      await recordEvent(env.DB, { actor, kind: 'delete', gameId: build.game_id, buildId, detail: `build removed (${keys.length} files)` });
      return json({ deleted: true, game: await getGameWithBuilds(env.DB, build.game_id, 'id') });
    }
  }

  /* ------------------------------------------------------- site content */

  if (path === '/api/admin/content' && method === 'GET') {
    const [about, contact, social, appearance] = await Promise.all([
      readAbout(env.DB),
      readContact(env.DB),
      readSocial(env.DB),
      readAppearance(env.DB),
    ]);
    return json({ about, contact, social, appearance });
  }

  if (segments.length >= 4 && segments[2] === 'content') {
    const kind = segments[3];
    const action = segments[4]; // absent for the plain draft save: /content/about
    if (kind !== 'about' && kind !== 'contact' && kind !== 'social') {
      return fail(404, 'not_found', 'Unknown content document.');
    }

    if (!action && method === 'PUT') {
      const body = await readJson<Record<string, unknown>>(request);
      if (!body) return fail(400, 'bad_body', 'Expected a JSON body.');

      if (kind === 'about') {
        const validation = validateAbout(body);
        if (Object.keys(validation.errors).length > 0) {
          return fail(422, 'invalid', 'Some fields need attention.', validation.errors);
        }
        return json({ document: await writeDraft(env.DB, 'about', normaliseAbout(body)) });
      }

      if (kind === 'social') {
        // Same contract as About and Contact: validate, then normalise, then
        // store a draft. The public site only ever reads the published copy.
        const validation = validateSocial(body);
        if (Object.keys(validation.errors).length > 0) {
          return fail(422, 'invalid', 'Some fields need attention.', validation.errors);
        }
        return json({ document: await writeDraft(env.DB, 'social', normaliseSocial(body)) });
      }

      const validation = validateContact(body);
      if (Object.keys(validation.errors).length > 0) {
        return fail(422, 'invalid', 'Some fields need attention.', validation.errors);
      }

      const draft = normaliseContact(body);
      // The two addresses are independent records. Refusing to publish the
      // private one here is what keeps them from ever collapsing into one.
       if (draft.email && (await isPrivateOwnerEmail(env, actor, draft.email))) {
         return fail(422, 'email_conflict', 'That is your private authentication address.', {
           email: 'Use a different public address — a private owner address must never appear on the site.',
         });
       }
      return json({ document: await writeDraft(env.DB, 'contact', draft) });
    }

    if (action === 'publish' && method === 'POST') {
      if (kind === 'about') {
        const stored = await publishDoc<AboutContent>(env.DB, 'about');
        // The portrait the draft replaced is no longer referenced by anything.
        await pruneAvatars(env, [stored.draft.avatarKey, stored.published?.avatarKey]);
        await recordEvent(env.DB, { actor, kind: 'content.publish', detail: kind });
        return json({ document: stored });
      }
      if (kind === 'social') {
        const stored = await publishDoc<SocialContent>(env.DB, 'social');
        await recordEvent(env.DB, { actor, kind: 'content.publish', detail: kind });
        return json({ document: stored });
      }
       const draft = (await readContact(env.DB)).draft;
       if (draft.email && (await isPrivateOwnerEmail(env, actor, draft.email))) {
         return fail(422, 'email_conflict', 'That is your private authentication address.', {
           email: 'Use a different public address — a private owner address must never appear on the site.',
         });
       }
       const stored = await publishDoc<ContactContent>(env.DB, 'contact');
      await recordEvent(env.DB, { actor, kind: 'content.publish', detail: kind });
      return json({ document: stored });
    }

    if (action === 'discard' && method === 'POST') {
      if (kind === 'about') {
        const stored = await discardDoc<AboutContent>(env.DB, 'about');
        await pruneAvatars(env, [stored.draft.avatarKey, stored.published?.avatarKey]);
        return json({ document: stored });
      }
      if (kind === 'social') {
        return json({ document: await discardDoc<SocialContent>(env.DB, 'social') });
      }
      return json({ document: await discardDoc<ContactContent>(env.DB, 'contact') });
    }

    if (kind === 'about' && action === 'avatar') {
      const stored = await readAbout(env.DB);

      if (method === 'PUT') {
        const declared = Number(request.headers.get('content-length') ?? '0');
        if (declared > MAX_ARTWORK_BYTES) return fail(413, 'too_large', 'The portrait must be 8 MB or smaller.');

        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.byteLength === 0) return fail(400, 'empty', 'That upload was empty.');
        // Enforced against the bytes actually received, not the declared length.
        if (bytes.byteLength > MAX_ARTWORK_BYTES) return fail(413, 'too_large', 'The portrait must be 8 MB or smaller.');
        const image = sniffImage(bytes);
        if (!image) return fail(415, 'unsupported_image', 'Upload a PNG, JPEG, WebP, GIF or AVIF image.');

        const key = `content/avatar/${crypto.randomUUID()}.${image.extension}`;
        await env.FILES.put(key, bytes, {
          httpMetadata: { contentType: image.contentType, cacheControl: 'public, max-age=300' },
        });

        const next = { ...stored.draft, avatarKey: key };
        const saved = await writeDraft<typeof next>(env.DB, 'about', next);
        await pruneAvatars(env, [key, stored.published?.avatarKey]);
        await recordEvent(env.DB, { actor, kind: 'content.avatar', detail: kind, size: bytes.byteLength });
        return json({ document: saved });
      }

      if (method === 'DELETE') {
        const next = { ...stored.draft, avatarKey: null };
        const saved = await writeDraft<typeof next>(env.DB, 'about', next);
        await pruneAvatars(env, [stored.published?.avatarKey]);
        return json({ document: saved });
      }
    }
  }

  /* ------------------------------------------------- live appearance */

  if (path === '/api/admin/settings/appearance' && method === 'PUT') {
    const body = await readJson<Record<string, unknown>>(request);
    if (!body) return fail(400, 'bad_body', 'Expected a JSON body.');
    const appearance = await writeAppearance(env.DB, body);
    return json({ appearance });
  }

  /* ------------------------------------------------------ background music */

  /**
   * The owner's view of the music document. It adds the two facts the public
   * answer hides: whether the stored object actually exists, and a preview URL
   * that works even while playback is disabled.
   */
  if (path === '/api/admin/music' && method === 'GET') {
    const current = await readMusic(env.DB);
    return noStore(
      json({
        music: current,
        available: await musicFileExists(env, current),
        previewUrl: musicPreviewUrl(current),
        limits: MUSIC_LIMITS,
      }),
    );
  }

  if (path === '/api/admin/music' && method === 'PUT') {
    const body = await readJson<{ title?: unknown; enabled?: unknown }>(request);
    if (!body) return fail(400, 'bad_body', 'Expected a JSON body.');

    const current = await readMusic(env.DB);
    const title = typeof body.title === 'string' ? body.title.trim().replace(/\s+/g, ' ') : current.title;
    if (title.length === 0 || title.length > MUSIC_LIMITS.maxTitle) {
      return fail(422, 'invalid', 'Some fields need attention.', {
        title: `Give the track a name of 1–${MUSIC_LIMITS.maxTitle} characters.`,
      });
    }
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : current.enabled;
    if (enabled && current.source === 'none') {
      return fail(409, 'no_track', 'Upload a track before turning background music on.');
    }

    const music = await writeMusic(env.DB, { ...current, title, enabled, updatedAt: nowIso() });
    await recordEvent(env.DB, { actor, kind: 'music.update', detail: `${enabled ? 'enabled' : 'disabled'} · ${title}` });
    return json({
      music,
      available: await musicFileExists(env, music),
      previewUrl: musicPreviewUrl(music),
      limits: MUSIC_LIMITS,
    });
  }

  if (path === '/api/admin/music/file' && method === 'PUT') {
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MUSIC_LIMITS.maxBytes) {
      return fail(413, 'too_large', `That file is larger than ${Math.round(MUSIC_LIMITS.maxBytes / (1024 * 1024))} MB.`);
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) return fail(400, 'empty', 'That upload was empty.');
    // Measured against the bytes actually received, not the declared length.
    if (bytes.byteLength > MUSIC_LIMITS.maxBytes) {
      return fail(413, 'too_large', `That file is larger than ${Math.round(MUSIC_LIMITS.maxBytes / (1024 * 1024))} MB.`);
    }
    const format = sniffAudio(bytes);
    if (!format) return fail(415, 'unsupported_audio', 'Upload an MP3, OGG, WAV, M4A or FLAC file.');

    const current = await readMusic(env.DB);
    const requestedTitle = url.searchParams.get('title')?.trim().replace(/\s+/g, ' ') ?? '';
    const title = (requestedTitle || current.title).slice(0, MUSIC_LIMITS.maxTitle) || 'Ambient theme';
    const key = musicStorageKey(format.extension);

    await env.FILES.put(key, bytes, {
      httpMetadata: { contentType: format.contentType, cacheControl: 'public, max-age=300' },
    });

    const music = await writeMusic(env.DB, {
      title,
      source: 'uploaded',
      storageKey: key,
      contentType: format.contentType,
      byteSize: bytes.byteLength,
      enabled: true,
      updatedAt: nowIso(),
    });

    // The replaced object is no longer referenced by the document. Only a
    // `music/` key is ever deleted, so builds and artwork are untouchable here.
    if (current.storageKey && current.storageKey !== key && isMusicKey(current.storageKey)) {
      await env.FILES.delete(current.storageKey);
    }
    await recordEvent(env.DB, { actor, kind: 'music.upload', detail: `${title} (${format.extension})`, size: bytes.byteLength });

    return json({
      music,
      available: true,
      previewUrl: musicPreviewUrl(music),
      limits: MUSIC_LIMITS,
    });
  }

  if (path === '/api/admin/music/file' && method === 'DELETE') {
    const current = await readMusic(env.DB);
    if (current.storageKey && isMusicKey(current.storageKey)) await env.FILES.delete(current.storageKey);

    const music = await writeMusic(env.DB, {
      title: current.title,
      source: 'none',
      storageKey: null,
      contentType: null,
      byteSize: null,
      enabled: false,
      updatedAt: nowIso(),
    });
    await recordEvent(env.DB, { actor, kind: 'music.remove', detail: current.title });
    return json({ music, available: false, previewUrl: null, limits: MUSIC_LIMITS });
  }

  /* ---------------------------------------------------- account security */

  if (segments.length >= 4 && segments[2] === 'security') {
    const action = segments[3];

    if (action === 'password' && method === 'POST') {
      const body = await readJson<{ currentPassword?: string; newPassword?: string; confirm?: string }>(request);
      if (!body) return fail(400, 'bad_body', 'Expected a JSON body.');
      const fields: Record<string, string> = {};
      if (!boundedText(body.currentPassword, PASSWORD_MAX_LENGTH, true)) fields.currentPassword = 'Enter a password of 200 characters or fewer.';
      if (!boundedText(body.newPassword, PASSWORD_MAX_LENGTH, true)) fields.newPassword = 'Enter a password of 200 characters or fewer.';
      if (!boundedText(body.confirm, PASSWORD_MAX_LENGTH, true)) fields.confirm = 'Re-enter a password of 200 characters or fewer.';
      if (Object.keys(fields).length > 0) return fail(422, 'invalid', 'Some fields need attention.', fields);
      const outcome = await changePassword(env, request, ctx.owner, ctx.session, {
        currentPassword: body.currentPassword ?? '',
        newPassword: body.newPassword ?? '',
        confirm: body.confirm ?? '',
      });
      if (!outcome.ok) return failureResponse(outcome);

      const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' });
      // The ticket authorised one change; it is gone either way.
      headers.append('Set-Cookie', clearChangeCookie(request));
      return json({ changed: true, revokedSessions: outcome.value.revoked }, { headers });
    }

    if (action === 'email' && method === 'POST') {
      const body = await readJson<{ newEmail?: string; password?: string }>(request);
      if (!body) return fail(400, 'bad_body', 'Expected a JSON body.');
      const fields: Record<string, string> = {};
      if (!boundedText(body.newEmail, MAX_AUTH_EMAIL_LENGTH, true)) fields.newEmail = 'Enter an email address of 160 characters or fewer.';
      if (!boundedText(body.password, PASSWORD_MAX_LENGTH, true)) fields.password = 'Enter a password of 200 characters or fewer.';
      if (Object.keys(fields).length > 0) return fail(422, 'invalid', 'Some fields need attention.', fields);
      const outcome = await applyEmailChange(
        env,
        request,
        ctx.owner,
        (body.newEmail ?? '').trim(),
        body.password ?? '',
        ctx.session,
      );
      return outcome.ok ? json(outcome.value) : failureResponse(outcome);
    }

    if (action === 'sessions' && method === 'POST') {
      const body = (await readJson<{ target?: string }>(request)) ?? {};
      const target = body.target === 'all' ? 'all' : 'others';
      const outcome = await revokeSessionsForOwner(env, ctx.owner, ctx.session, target);
      if (!outcome.ok) return failureResponse(outcome);
      const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' });
      if (outcome.value.clearedCurrent) headers.append('Set-Cookie', clearSessionCookie(request));
      return json(outcome.value, { headers });
    }

    if (action === 'events' && method === 'GET') {
      const [events, sessions] = await Promise.all([recentEvents(env, actor), activeSessions(env, actor)]);
      return json({ events, sessions, currentSessionId: ctx.session.id });
    }

    if (action === 'recovery' && method === 'GET') {
      return json({ recovery: await recoveryGuidance(env, ctx.owner) });
    }
  }

  return fail(404, 'not_found', 'Unknown admin endpoint.');
}

/** Rebuilds the write shape from a stored row, for partial updates. */
function rowToWriteSource(row: GameRow): Record<string, unknown> {
  return {
    slug: row.slug,
    title: row.title,
    shortDescription: row.short_description,
    description: row.description,
    categories: parseJson<string[]>(row.genres, []),
    tags: parseJson<string[]>(row.tags, []),
    instructions: row.instructions,
    controls: parseJson<GameControls>(row.controls, {}),
    estimatedPlaytime: row.playtime ?? '',
    version: row.version ?? '',
    updateNotes: row.update_notes ?? '',
    releaseDate: row.release_date ?? '',
    coverAlt: row.cover_alt,
    accent: row.accent,
    status: row.status,
    listed: row.listed === 1,
    featured: row.featured === 1,
    itchUrl: row.itch_url ?? '',
    itchEmbedUrl: row.itch_embed_url ?? '',
  };
}
