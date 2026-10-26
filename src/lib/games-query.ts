import type { CategoryId, PublicGame } from '../shared/catalogue';

/**
 * Pure query helpers for the game library: search, filter and sort.
 * Kept free of React so they can be unit tested directly.
 */

export type SortKey = 'featured' | 'newest' | 'alphabetical' | 'updated';

export const SORT_OPTIONS: { id: SortKey; label: string; hint: string }[] = [
  { id: 'featured', label: 'Featured', hint: 'Hand-picked order' },
  { id: 'newest', label: 'Newest', hint: 'By release date, newest first' },
  { id: 'alphabetical', label: 'A–Z', hint: 'Alphabetical by title' },
  { id: 'updated', label: 'Recently updated', hint: 'Most recently changed first' },
];

export interface GameQuery {
  /** Free text. Matched against title, description, categories, tags and more. */
  query: string;
  /** Selected genres. Empty means "all genres". */
  categories: CategoryId[];
  sort: SortKey;
  /** When true, unplayable games are still listed (they always are — this is for future use). */
  includeUnpublished?: boolean;
}

export const defaultQuery: GameQuery = { query: '', categories: [], sort: 'featured' };

export function isSortKey(value: unknown): value is SortKey {
  return typeof value === 'string' && SORT_OPTIONS.some((option) => option.id === value);
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function queryTerms(query: string): string[] {
  return Array.from(new Set(normalizeText(query).split(' ').filter((term) => term.length > 1)));
}

/** The text a game is searchable by, assembled once per call. */
export function searchableText(game: PublicGame): string {
  return normalizeText(
    [game.title, game.shortDescription, game.description, ...game.categories, ...game.tags, game.slug].join(' '),
  );
}

/**
 * Relevance score for a game against a set of terms, or null when any term is
 * missing (all terms must match — this keeps combined queries predictable).
 */
export function scoreGame(game: PublicGame, terms: string[]): number | null {
  if (terms.length === 0) return 0;

  const title = normalizeText(game.title);
  const tags = normalizeText(game.tags.join(' '));
  const categories = normalizeText(game.categories.join(' '));
  const shortDescription = normalizeText(game.shortDescription);
  const haystack = searchableText(game);

  let score = 0;

  for (const term of terms) {
    let termScore = 0;
    if (haystack.includes(term)) termScore += 1;
    if (shortDescription.includes(term)) termScore += 1.5;
    if (categories.includes(term)) termScore += 2;
    if (tags.includes(term)) termScore += 2.5;
    if (title.includes(term)) termScore += 4;
    if (title === term) termScore += 6;

    if (termScore === 0) return null;
    score += termScore;
  }

  if (game.featured) score += 0.5;
  return score;
}

export function filterByCategories(list: PublicGame[], categories: CategoryId[]): PublicGame[] {
  if (categories.length === 0) return list;
  return list.filter((game) => categories.some((category) => game.categories.includes(category)));
}

function newestFirst(a: PublicGame, b: PublicGame): number {
  const aDate = a.releaseDate ?? '';
  const bDate = b.releaseDate ?? '';
  if (aDate === bDate) return 0;
  if (!aDate) return 1;
  if (!bDate) return -1;
  return aDate < bDate ? 1 : -1;
}

function updatedFirst(a: PublicGame, b: PublicGame): number {
  const aDate = a.updatedAt ?? '';
  const bDate = b.updatedAt ?? '';
  if (aDate === bDate) return 0;
  if (!aDate) return 1;
  if (!bDate) return -1;
  return aDate < bDate ? 1 : -1;
}

export function sortGames(list: PublicGame[], sort: SortKey): PublicGame[] {
  const sorted = [...list];
  switch (sort) {
    case 'alphabetical':
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    case 'newest':
      return sorted.sort((a, b) => newestFirst(a, b) || a.title.localeCompare(b.title));
    case 'updated':
      return sorted.sort((a, b) => updatedFirst(a, b) || newestFirst(a, b) || a.title.localeCompare(b.title));
    case 'featured':
    default:
      return sorted.sort((a, b) => {
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        const aPlayable = a.status === 'published' ? 1 : 0;
        const bPlayable = b.status === 'published' ? 1 : 0;
        if (aPlayable !== bPlayable) return bPlayable - aPlayable;
        return updatedFirst(a, b) || a.title.localeCompare(b.title);
      });
  }
}

/**
 * The one entry point used by the library page: search + filter + sort applied
 * together, so the three controls can never fight each other.
 */
export function runGameQuery(list: PublicGame[], query: GameQuery): PublicGame[] {
  const terms = queryTerms(query.query);

  const scored = list
    .map((game) => ({ game, score: scoreGame(game, terms) }))
    .filter((entry): entry is { game: PublicGame; score: number } => entry.score !== null)
    .filter((entry) => filterByCategories([entry.game], query.categories).length > 0);

  if (terms.length > 0 && query.sort === 'featured') {
    // Relevance wins over the default ordering while the visitor is searching.
    scored.sort((a, b) => b.score - a.score || a.game.title.localeCompare(b.game.title));
    return scored.map((entry) => entry.game);
  }

  return sortGames(
    scored.map((entry) => entry.game),
    query.sort,
  );
}

/** Total number of games in each genre, for filter chip counts. */
export function categoryCounts(list: PublicGame[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const game of list) {
    for (const category of game.categories) {
      counts[category] = (counts[category] ?? 0) + 1;
    }
  }
  return counts;
}

export interface HighlightPart {
  text: string;
  match: boolean;
}

/** Splits text into matched/unmatched parts for search-result highlighting. */
export function highlightParts(text: string, terms: string[]): HighlightPart[] {
  if (terms.length === 0) return [{ text, match: false }];

  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'ig');
  const parts = text.split(pattern).filter((part) => part.length > 0);

  return parts.map((part) => ({ text: part, match: terms.some((term) => term.toLowerCase() === part.toLowerCase()) }));
}
