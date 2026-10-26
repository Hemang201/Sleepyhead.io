/**
 * Media storage.
 *
 * Cover art, screenshots, the About portrait and the background track are the
 * only things this site stores that are not database rows. New uploads go to
 * Get Pronto (the account cannot enable Cloudflare R2 billing); rows written
 * while R2 was the store keep working, because a stored reference says which
 * provider it came from — see `src/shared/media.ts`.
 *
 * Get Pronto's documented flow is three calls, none of which needs a Node-only
 * API, so this runs unchanged in the Workers runtime:
 *
 *   1. `POST /v1/upload/presign`  { filename, mimetype, size }
 *        → { uploadUrl, pendingUploadId }
 *   2. `PUT  {uploadUrl}`         the bytes, with the MIME type we presigned
 *   3. `POST /v1/upload/confirm`  { pendingUploadId }
 *        → { file: { id, secureUrl, rawUrl, … } }
 *
 * `GETPRONTO_API_KEY` must be a **secret key** (`pronto_sk_…`). A public key can
 * only upload, and this module also deletes and checks files. The key is read
 * from the environment on every call and never leaves this file: it is not in a
 * response, a log line, or the client bundle.
 */

import { isProntoUrl, mediaRefUrl, parseMediaRef, type MediaRef } from '../../src/shared/media';

/** Get Pronto's API origin. Fixed on purpose: no environment variable can redirect the key. */
const PRONTO_API = 'https://api.getpronto.io/v1';

/**
 * The free plan's per-file ceiling.
 *
 * Enforced here as well as at the provider so an oversized image fails with a
 * sentence the owner can act on, instead of an opaque upstream error after the
 * whole body has been uploaded.
 */
export const PRONTO_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** A presigned upload that never answers must not hold a request open. */
const PRONTO_TIMEOUT_MS = 20_000;

export interface MediaEnv {
  GETPRONTO_API_KEY?: string;
  /** Present locally (`wrangler dev` emulates R2) and in any deployment that still has one. */
  FILES?: R2Bucket;
}

export type MediaStoreErrorCode =
  | 'unconfigured'
  | 'too_large'
  | 'rejected'
  | 'rate_limited'
  | 'upstream'
  | 'throttled';

export class MediaStoreError extends Error {
  readonly code: MediaStoreErrorCode;

  constructor(code: MediaStoreErrorCode, message: string) {
    super(message);
    this.name = 'MediaStoreError';
    this.code = code;
  }
}

/** `getpronto` when a secret key is configured; `r2` only as the local emulated store. */
export type MediaProvider = 'getpronto' | 'r2';

export function mediaProvider(env: MediaEnv): MediaProvider | null {
  const key = env.GETPRONTO_API_KEY?.trim();
  if (key) return 'getpronto';
  if (env.FILES) return 'r2';
  return null;
}

/** The largest file this deployment can accept, so endpoints can say so up front. */
export function mediaLimitBytes(env: MediaEnv): number {
  return mediaProvider(env) === 'getpronto' ? PRONTO_MAX_FILE_BYTES : Number.POSITIVE_INFINITY;
}

function apiKey(env: MediaEnv): string {
  const key = env.GETPRONTO_API_KEY?.trim();
  if (!key) throw new MediaStoreError('unconfigured', 'The Get Pronto API key is missing.');
  return key;
}

/** One authenticated call to the Get Pronto API. */
async function prontoRequest(env: MediaEnv, path: string, init: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${PRONTO_API}${path}`, {
      ...init,
      headers: {
        Authorization: `ApiKey ${apiKey(env)}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(PRONTO_TIMEOUT_MS),
    });
  } catch {
    // No URL, no key, no body: a network failure says nothing worth logging.
    throw new MediaStoreError('upstream', 'Get Pronto could not be reached. Try again in a moment.');
  }

  if (response.status === 429) {
    throw new MediaStoreError('rate_limited', 'Get Pronto is rate limiting uploads. Wait a minute and try again.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new MediaStoreError('rejected', 'Get Pronto refused the API key. Check the GETPRONTO_API_KEY secret.');
  }
  if (!response.ok) {
    throw new MediaStoreError('upstream', `Get Pronto rejected that upload (HTTP ${response.status}).`);
  }

  try {
    const body = (await response.json()) as unknown;
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    throw new MediaStoreError('upstream', 'Get Pronto sent a response that could not be read.');
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Uploads one file and returns the reference to store.
 *
 * The filename is generated here, never taken from the browser: it is an
 * address on a CDN, and trusting a client-supplied name is how two uploads end
 * up overwriting each other.
 */
async function prontoUpload(env: MediaEnv, input: UploadInput): Promise<MediaRef> {
  if (input.bytes.byteLength > PRONTO_MAX_FILE_BYTES) {
    throw new MediaStoreError(
      'too_large',
      `That file is ${(input.bytes.byteLength / 1024 / 1024).toFixed(1)} MB. The free plan accepts up to 10 MB per file.`,
    );
  }

  const presigned = await prontoRequest(env, '/upload/presign', {
    method: 'POST',
    body: JSON.stringify({
      filename: input.filename,
      mimetype: input.contentType,
      size: input.bytes.byteLength,
    }),
  });

  const uploadUrl = text(presigned.uploadUrl);
  const pendingUploadId = text(presigned.pendingUploadId);
  if (!uploadUrl || !pendingUploadId) {
    throw new MediaStoreError('upstream', 'Get Pronto did not return an upload address.');
  }
  // The presigned address is a storage URL on the provider's own infrastructure.
  if (!uploadUrl.startsWith('https://')) {
    throw new MediaStoreError('upstream', 'Get Pronto returned a non-HTTPS upload address.');
  }

  let stored: Response;
  try {
    stored = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': input.contentType },
      // A Blob keeps the byte array out of the type's `BodyInit` ambiguity and
      // carries the MIME type the presigned upload was signed for.
      body: new Blob([input.bytes], { type: input.contentType }),
      signal: AbortSignal.timeout(PRONTO_TIMEOUT_MS),
    });
  } catch {
    throw new MediaStoreError('upstream', 'The file could not be sent to storage. Try again in a moment.');
  }
  if (!stored.ok) {
    throw new MediaStoreError('upstream', `Storage refused the file (HTTP ${stored.status}).`);
  }

  const confirmed = await prontoRequest(env, '/upload/confirm', {
    method: 'POST',
    body: JSON.stringify({ pendingUploadId }),
  });

  const file = typeof confirmed.file === 'object' && confirmed.file !== null ? (confirmed.file as Record<string, unknown>) : null;
  const id = file ? text(file.id) : null;
  // `rawUrl` is the CDN address; `secureUrl` is the API's own delivery address.
  // Either is public and permanent, but the CDN one is the intended hot path.
  const url = file ? [text(file.rawUrl), text(file.secureUrl)].find((value): value is string => Boolean(value && isProntoUrl(value))) ?? null : null;

  if (!id || !url) {
    throw new MediaStoreError('upstream', 'Get Pronto confirmed the upload without a usable address.');
  }

  return { provider: 'getpronto', id, url };
}

export interface UploadInput {
  /** A plain byte array, not a shared buffer: it becomes the request body. */
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
  /** Object key for the R2 store, e.g. `artwork/<gameId>/shot-<uuid>.png`. */
  key: string;
  /** Generated filename sent to Get Pronto, e.g. `shot-<uuid>.png`. */
  filename: string;
}

/**
 * Stores one file and returns its reference.
 *
 * A reference is returned before the caller writes it to D1: a row is never
 * updated to point at a file that failed to upload.
 */
export async function putMedia(env: MediaEnv, input: UploadInput): Promise<MediaRef> {
  if (mediaProvider(env) === 'getpronto') {
    return prontoUpload(env, { ...input, bytes: input.bytes });
  }

  const bucket = env.FILES;
  if (!bucket) {
    throw new MediaStoreError(
      'unconfigured',
      'File storage is not configured for this deployment. Add the GETPRONTO_API_KEY secret, then try again.',
    );
  }
  await bucket.put(input.key, input.bytes, {
    httpMetadata: { contentType: input.contentType, cacheControl: 'public, max-age=300' },
  });
  return { provider: 'r2', key: input.key };
}

/**
 * Deletes a stored file. Never throws: a failed delete leaves an orphan, which
 * is harmless, while a thrown error would turn a successful edit into a 500.
 */
export async function deleteMedia(env: MediaEnv, value: unknown): Promise<boolean> {
  const ref = parseMediaRef(value);
  if (!ref) return false;

  try {
    if (ref.provider === 'getpronto') {
      if (!env.GETPRONTO_API_KEY) return false;
      const response = await fetch(`${PRONTO_API}/files/${encodeURIComponent(ref.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `ApiKey ${apiKey(env)}` },
        signal: AbortSignal.timeout(PRONTO_TIMEOUT_MS),
      });
      // 404 means it is already gone, which is the outcome asked for.
      return response.ok || response.status === 404;
    }
    if (!env.FILES) return false;
    await env.FILES.delete(ref.key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes every reference that is no longer used.
 *
 * Replaces the old "list the prefix and delete the rest" sweep: Get Pronto has a
 * paginated file list, but deleting by explicit reference is both cheaper and
 * smaller in blast radius — nothing outside the list can ever be removed.
 */
export async function retireMedia(env: MediaEnv, candidates: unknown[], keep: unknown[]): Promise<number> {
  const keepSet = new Set(keep.filter((value): value is string => typeof value === 'string' && value.length > 0));
  let removed = 0;
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || keepSet.has(candidate)) continue;
    if (await deleteMedia(env, candidate)) removed += 1;
  }
  return removed;
}

/**
 * True when the file can still be fetched.
 *
 * Get Pronto answers only through its CDN, so this is a `HEAD`. A network
 * failure is reported as present: hiding the owner's music because of one bad
 * moment upstream would be worse than a player that fails once.
 */
export async function mediaExists(env: MediaEnv, value: unknown): Promise<boolean> {
  const ref = parseMediaRef(value);
  if (!ref) return false;
  if (ref.provider === 'getpronto') {
    try {
      const response = await fetch(ref.url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(6_000),
      });
      if (response.status === 404 || response.status === 410) return false;
      return true;
    } catch {
      return true;
    }
  }
  if (!env.FILES) return false;
  return Boolean(await env.FILES.head(ref.key));
}

/** The public address for a stored file, or `null` when this Worker serves it. */
export function mediaUrl(value: unknown): string | null {
  return mediaRefUrl(value);
}

export type { MediaRef };
