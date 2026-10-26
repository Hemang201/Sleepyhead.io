/**
 * itch.io addresses, parsed strictly.
 *
 * The site no longer hosts game builds: a game is played through the iframe
 * that itch.io itself generates. That means two owner-supplied URLs cross a
 * trust boundary, so they are parsed here — in one place, shared by the
 * dashboard and the Worker — rather than trusted as strings.
 *
 * There are two different addresses and they are not interchangeable:
 *
 *   project  https://<creator>.itch.io/<game>
 *            The public page a visitor would land on.
 *
 *   embed    https://itch.io/embed-upload/<id>[?color=<hex>]
 *            The playable frame. itch.io generates it under
 *            "Edit game → Embed" for the uploaded HTML5 file; the numeric id is
 *            specific to that file, so it cannot be derived from the project
 *            address and is never guessed here.
 *
 * Anything else — a widget URL (which is a store card, not a game), a lookalike
 * domain, `javascript:`, `data:`, credentials, ports, extra query parameters —
 * is refused with a message the owner can act on.
 */

export interface ItchProject {
  /** Canonical address, no trailing slash, no query. */
  url: string;
  /** Creator subdomain, lower-case. */
  username: string;
  /** Game path segment, lower-case. */
  game: string;
}

export interface ItchEmbed {
  /** Canonical address, with the optional itch colour parameter kept. */
  url: string;
  /** The numeric embed-upload id. */
  id: string;
}

export type ItchResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** itch.io usernames are a single DNS label. */
const USERNAME = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
/** Game path segments: letters, numbers, dots, underscores and hyphens. */
const GAME_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const EMBED_ID = /^\d{1,20}$/;
const HEX_COLOUR = /^[0-9a-f]{6}$/;

/** Subdomains that are itch.io infrastructure, never a creator. */
const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'itch', 'static', 'assets', 'community', 'docs', 'support', 'help']);

/** Path segments on a creator subdomain that are not games. */
const RESERVED_GAMES = new Set(['edit', 'dashboard', 'login', 'logout', 'signup', 'settings', 'embed', 'download']);

export const ITCH_PROJECT_EXAMPLE = 'https://yourusername.itch.io/your-game';
export const ITCH_EMBED_EXAMPLE = 'https://itch.io/embed-upload/1234567?color=202124';

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * Parses a public itch.io project address.
 *
 * Only `https://<creator>.itch.io/<game>` is accepted. A trailing slash is
 * normalised away; a query string or fragment is refused rather than silently
 * dropped, because `?utm=…` on a stored canonical URL is almost always a sign
 * the owner pasted something other than the project address.
 */
export function parseItchProjectUrl(raw: string | null | undefined): ItchResult<ItchProject> {
  const input = (raw ?? '').trim();
  if (!input) return fail('Paste the game’s itch.io page address.');
  if (input.length > 300) return fail('That address is too long to be an itch.io game URL.');

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return fail(`Use a full address, like ${ITCH_PROJECT_EXAMPLE}.`);
  }

  if (url.protocol !== 'https:') return fail('itch.io links must start with https://.');
  if (url.username || url.password) return fail('Remove the username and password from the address.');
  if (url.port) return fail('Remove the port number from the address.');
  if (url.search) return fail('Remove the query string — paste the plain game address.');
  if (url.hash) return fail('Remove the #fragment from the address.');

  const host = url.hostname.toLowerCase();
  if (!host.endsWith('.itch.io')) {
    return fail(`That is not an itch.io game address. It should look like ${ITCH_PROJECT_EXAMPLE}.`);
  }
  const username = host.slice(0, -'.itch.io'.length);
  if (!USERNAME.test(username) || RESERVED_SUBDOMAINS.has(username)) {
    return fail(`That is not a creator address on itch.io. It should look like ${ITCH_PROJECT_EXAMPLE}.`);
  }

  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.length !== 1) {
    return fail(`Link to the game itself, not a page inside it: ${ITCH_PROJECT_EXAMPLE}.`);
  }

  const game = decodeURIComponent(segments[0]).toLowerCase();
  if (!GAME_SEGMENT.test(game) || RESERVED_GAMES.has(game) || game === '.' || game === '..') {
    return fail(`That does not look like a game address. It should look like ${ITCH_PROJECT_EXAMPLE}.`);
  }

  return { ok: true, value: { url: `https://${username}.itch.io/${game}`, username, game } };
}

/**
 * Parses the playable iframe address itch.io generates.
 *
 * The official playable form is `/embed-upload/<id>`, optionally with a single
 * `color` parameter. `/embed/<id>` is itch.io's *widget* (a store card with a
 * buy button) and cannot be played, so it is rejected with an explanation
 * instead of producing a dead player.
 */
export function parseItchEmbedUrl(raw: string | null | undefined): ItchResult<ItchEmbed> {
  const input = (raw ?? '').trim();
  if (!input) return fail('Paste the iframe address itch.io gives you under Embed game.');
  if (input.length > 300) return fail('That address is too long to be an itch.io embed URL.');

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return fail(`Use the full iframe address, like ${ITCH_EMBED_EXAMPLE}.`);
  }

  if (url.protocol !== 'https:') return fail('The embed address must start with https://.');
  if (url.username || url.password) return fail('Remove the username and password from the embed address.');
  if (url.port) return fail('Remove the port number from the embed address.');
  if (url.hash) return fail('Remove the #fragment from the embed address.');

  if (url.hostname.toLowerCase() !== 'itch.io') {
    return fail('Only official itch.io embed addresses (itch.io/embed-upload/…) are accepted.');
  }

  const match = /^\/embed-upload\/(\d+)\/?$/.exec(url.pathname);
  if (!match) {
    if (/^\/embed\/\d+\/?$/.test(url.pathname)) {
      return fail(
        'That is an itch.io widget (a store card), not a playable game. Open Edit game → Embed and copy the iframe src that starts with itch.io/embed-upload/.',
      );
    }
    return fail(`That is not an itch.io game embed. The address should look like ${ITCH_EMBED_EXAMPLE}.`);
  }

  const id = match[1];
  if (!EMBED_ID.test(id)) return fail('That embed id is not valid.');

  // Only the documented colour parameter is kept; anything else could change
  // what itch serves and is refused rather than silently stripped.
  let colour: string | null = null;
  for (const [key, value] of url.searchParams) {
    if (key !== 'color') return fail(`Remove the “${key}” parameter — the embed address only needs its colour, if any.`);
    if (colour !== null) return fail('The embed address has more than one colour parameter.');
    if (!HEX_COLOUR.test(value)) return fail('The embed colour must be a six-digit hex value, like 202124.');
    colour = value.toLowerCase();
  }

  const suffix = colour ? `?color=${colour}` : '';
  return { ok: true, value: { url: `https://itch.io/embed-upload/${id}${suffix}`, id } };
}

/** The host the site's `frame-src` has to allow. Kept next to the parser. */
export const ITCH_EMBED_ORIGIN = 'https://itch.io';

/** A readable label for a project address, e.g. `pixelpine.itch.io/drift`. */
export function itchProjectLabel(project: ItchProject | null): string | null {
  return project ? `${project.username}.itch.io/${project.game}` : null;
}

/**
 * The exact string a stored project URL should become, or null when it is not
 * one. Used by the Worker before writing, so a bad value never reaches D1.
 */
export function canonicalItchProjectUrl(raw: string | null | undefined): string | null {
  const parsed = parseItchProjectUrl(raw);
  return parsed.ok ? parsed.value.url : null;
}

export function canonicalItchEmbedUrl(raw: string | null | undefined): string | null {
  const parsed = parseItchEmbedUrl(raw);
  return parsed.ok ? parsed.value.url : null;
}
