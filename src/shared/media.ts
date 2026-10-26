/**
 * Where an uploaded file lives.
 *
 * The database columns that hold artwork, the portrait and the audio track
 * (`games.thumbnail_key`, `games.banner_key`, `games.screenshots`,
 * `about.avatarKey`, `music.storageKey`) were written when Cloudflare R2 was the
 * only store, so they hold a plain object key like `artwork/<id>/shot-<uuid>.png`.
 * Those rows still exist and are never rewritten by a migration.
 *
 * New uploads go to Get Pronto, which returns an id *and* a public delivery
 * address, and whose delete endpoint needs the id. Neither is recoverable from
 * the other, so the reference has to carry both. It is stored as JSON in the same
 * column:
 *
 *   "artwork/abc/shot-1.png"
 *   {"provider":"getpronto","id":"1f0…","url":"https://cdn.getpronto.io/u/x.png"}
 *
 * A value that does not parse as a reference object is a legacy R2 key. That is
 * the whole compatibility rule, and `parseMediaRef` is the only function that
 * decides it.
 */

/** Delivery hosts this site will render from. Anything else is treated as data corruption. */
const PRONTO_HOSTS = new Set(['cdn.getpronto.io', 'api.getpronto.io']);

export type MediaRef =
  | { provider: 'r2'; key: string }
  | { provider: 'getpronto'; id: string; url: string };

export interface MediaRefObject {
  provider: 'getpronto';
  id: string;
  url: string;
}

/**
 * True when a stored string is a Get Pronto reference object.
 *
 * Deliberately strict: a malformed or off-host URL is rejected rather than
 * rendered, so a hand-edited row cannot point an `<img src>` at another domain.
 */
export function isMediaRefObject(value: unknown): value is MediaRefObject {
  if (typeof value !== 'string' || !value.startsWith('{')) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) return false;
  const candidate = parsed as Record<string, unknown>;
  if (candidate.provider !== 'getpronto') return false;
  if (typeof candidate.id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(candidate.id)) return false;
  if (typeof candidate.url !== 'string') return false;
  return isProntoUrl(candidate.url);
}

/** An https address on one of Get Pronto's own hosts. */
export function isProntoUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return PRONTO_HOSTS.has(parsed.hostname);
}

/**
 * The stored string for a new upload.
 *
 * R2 keys stay bare so nothing changes for the local development store; a Get
 * Pronto reference is the JSON object above.
 */
export function serialiseMediaRef(ref: MediaRef): string {
  return ref.provider === 'r2' ? ref.key : JSON.stringify({ provider: ref.provider, id: ref.id, url: ref.url });
}

/**
 * Reads a stored value back.
 *
 * `null` for an empty column. A legacy or unknown string becomes an R2 key —
 * including one that begins with `{` but is not a valid reference, which then
 * simply fails to resolve instead of being trusted.
 */
export function parseMediaRef(value: unknown): MediaRef | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (isMediaRefObject(value)) {
    const parsed = JSON.parse(value) as MediaRefObject;
    return { provider: 'getpronto', id: parsed.id, url: parsed.url };
  }
  return { provider: 'r2', key: value };
}

/** The absolute address to render, or `null` when the object is served by this Worker. */
export function mediaRefUrl(value: unknown): string | null {
  const ref = parseMediaRef(value);
  return ref?.provider === 'getpronto' ? ref.url : null;
}

/**
 * True when the value is a reference this site can delete again later.
 *
 * Used by the content normalisers, which throw away values that do not look
 * like storage. A bare key is accepted only when it carries the prefix that
 * belongs to that field, so `about.avatarKey` can never point at a game build.
 */
export function isMediaStorageValue(value: unknown, legacyPrefix?: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (isMediaRefObject(value)) return true;
  if (!legacyPrefix) return true;
  return value.startsWith(legacyPrefix) && !value.includes('..');
}
