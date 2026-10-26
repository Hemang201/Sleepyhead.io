import type { PublicGame } from '../shared/catalogue';

/**
 * Library-level helpers used by pages.
 *
 * These are plain functions over the list the API returned, so the ordering and
 * selection rules live in one place and are easy to unit test.
 */

export function playableGames(games: PublicGame[]): PublicGame[] {
  return games.filter((game) => game.playable);
}

/** Featured games first; when the owner has featured nothing, show the newest. */
export function featuredGames(games: PublicGame[], limit = 3): PublicGame[] {
  const featured = games.filter((game) => game.featured);
  const source = featured.length > 0 ? featured : games;
  return source.slice(0, limit);
}

/**
 * The band on the home page: what to point at first, then the rest.
 *
 * The order is the same featured-first rule as `featuredGames`, with one
 * addition — a game you can actually play comes first. A front page that opens
 * on something unplayable is telling a visitor this arcade is empty when it is
 * not. The playable group keeps its featured/newest order internally, so the
 * owner's choice still wins between two playable games.
 */
export function spotlightGames(games: PublicGame[], limit = 5): PublicGame[] {
  const chosen = featuredGames(games, games.length);
  const playable = chosen.filter((game) => game.playable);
  const rest = chosen.filter((game) => !game.playable);
  return [...playable, ...rest].slice(0, limit);
}

export function favouriteGames(games: PublicGame[], slugs: string[]): PublicGame[] {
  const bySlug = new Map(games.map((game) => [game.slug, game]));
  return slugs.map((slug) => bySlug.get(slug)).filter((game): game is PublicGame => Boolean(game));
}

export interface RecentGame {
  game: PublicGame;
  at: number;
}

export function recentlyPlayed(games: PublicGame[], entries: { slug: string; at: number }[], limit = 4): RecentGame[] {
  const bySlug = new Map(games.map((game) => [game.slug, game]));
  return entries
    .map((entry) => ({ game: bySlug.get(entry.slug), at: entry.at }))
    .filter((entry): entry is RecentGame => Boolean(entry.game))
    .slice(0, limit);
}

/** Games that share a genre with this one, most shared genres first. */
export function relatedGames(games: PublicGame[], game: PublicGame, limit = 3): PublicGame[] {
  return games
    .filter((entry) => entry.slug !== game.slug && entry.status !== 'draft' && entry.status !== 'archived')
    .map((entry) => ({
      entry,
      shared: entry.categories.filter((category) => game.categories.includes(category)).length,
    }))
    .filter((candidate) => candidate.shared > 0)
    .sort((a, b) => b.shared - a.shared || a.entry.title.localeCompare(b.entry.title))
    .slice(0, limit)
    .map((candidate) => candidate.entry);
}

/** Human-readable date, or null when the field is missing (never invented). */
export function formatDate(iso?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function relativeTime(timestamp: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
  ];

  try {
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    let value = seconds;
    for (const [unit, factor] of units) {
      if (value < factor) return formatter.format(-Math.round(value), unit);
      value /= factor;
    }
    return formatter.format(-Math.round(value), 'year');
  } catch {
    return 'recently';
  }
}
