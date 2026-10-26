import { STATUS_META, categoryLabel, type PublicGame } from '../shared/catalogue';
import { normalizeText, queryTerms, scoreGame } from './games-query';

/**
 * The index behind the site-wide search overlay.
 *
 * It is built from real content — whatever the API returned plus the site's own
 * pages — and never from hardcoded sample results. Each hit carries a route, a
 * type and an optional thumbnail so results render consistently.
 */

export type SearchResultType = 'game' | 'page';

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  /** Route to navigate to. */
  to: string;
  description: string;
  thumbnail?: string | null;
  /** Small metadata line, e.g. "Puzzle · In development". */
  meta: string;
  status?: PublicGame['status'];
  playable?: boolean;
}

const staticPages: SearchResult[] = [
  {
    id: 'page-home',
    type: 'page',
    title: 'Home',
    to: '/',
    description: 'Small games, big ideas — start here.',
    meta: 'Page',
  },
  {
    id: 'page-games',
    type: 'page',
    title: 'Games library',
    to: '/games',
    description: 'Browse, filter and search every browser game in the arcade.',
    meta: 'Page',
  },
  {
    id: 'page-about',
    type: 'page',
    title: 'About Hemang Gupta',
    to: '/about',
    description: 'How I build games, what I am experimenting with, and the tools I use.',
    meta: 'Page',
  },
  {
    id: 'page-contact',
    type: 'page',
    title: 'Contact',
    to: '/contact',
    description: 'Feedback, collaboration, technical discussions and project enquiries.',
    meta: 'Page',
  },
  {
    id: 'page-privacy',
    type: 'page',
    title: 'Privacy and storage',
    to: '/privacy',
    description: 'Exactly what this site stores in your browser, and why.',
    meta: 'Page',
  },
];

export function gameToSearchResult(game: PublicGame): SearchResult {
  const status = STATUS_META[game.status];
  return {
    id: `game-${game.slug}`,
    type: 'game',
    title: game.title,
    to: game.path,
    description: game.shortDescription,
    thumbnail: game.artwork.thumbnail,
    meta: `${game.categories.map(categoryLabel).join(' · ')} · ${status.label}`,
    status: game.status,
    playable: game.playable,
  };
}

function scoreResult(result: SearchResult, terms: string[]): number | null {
  if (terms.length === 0) return 0;

  const title = normalizeText(result.title);
  const description = normalizeText(result.description);
  const meta = normalizeText(result.meta);

  let score = 0;
  for (const term of terms) {
    let termScore = 0;
    if (title.includes(term)) termScore += 4;
    if (title === term) termScore += 5;
    if (description.includes(term)) termScore += 2;
    if (meta.includes(term)) termScore += 1.5;
    if (termScore === 0) return null;
    score += termScore;
  }

  // Games that can actually be played right now rank above everything else.
  if (result.playable) score += 3;
  if (result.type === 'game') score += 1;
  return score;
}

/**
 * Searches games (title, short + long description, categories, tags, slug) and
 * the site's own pages. Games rank above pages for equally good matches.
 */
export function searchSite(games: PublicGame[], query: string, limit = 12): SearchResult[] {
  const terms = queryTerms(query);

  const gameHits = games
    .map((game) => ({ game, score: scoreGame(game, terms) }))
    .filter((entry): entry is { game: PublicGame; score: number } => entry.score !== null)
    .map((entry) => ({ result: gameToSearchResult(entry.game), score: entry.score + 1 }));

  const pageHits = staticPages
    .map((page) => ({ result: page, score: scoreResult(page, terms) }))
    .filter((entry): entry is { result: SearchResult; score: number } => entry.score !== null);

  return [...gameHits, ...pageHits]
    .sort((a, b) => b.score - a.score || a.result.title.localeCompare(b.result.title))
    .slice(0, limit)
    .map((entry) => entry.result);
}
