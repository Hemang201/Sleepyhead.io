import { describe, expect, it } from 'vitest';
import type { PublicGame } from '../src/shared/catalogue';
import { sampleGames as games } from './fixtures';
import {
  categoryCounts,
  defaultQuery,
  filterByCategories,
  highlightParts,
  normalizeText,
  queryTerms,
  runGameQuery,
  sortGames,
} from '../src/lib/games-query';
import { searchSite } from '../src/lib/search';

describe('query parsing', () => {
  it('normalises case, accents and punctuation', () => {
    expect(normalizeText('  Grid-Runner!  ')).toBe('grid runner');
    expect(normalizeText('Mémoire')).toBe('memoire');
  });

  it('drops single characters so one-letter noise does not filter everything out', () => {
    expect(queryTerms('a grid x')).toEqual(['grid']);
  });
});

describe('runGameQuery', () => {
  it('returns every game for an empty query', () => {
    expect(runGameQuery(games, defaultQuery)).toHaveLength(games.length);
  });

  it('finds games by title, description and tag', () => {
    const byTitle = runGameQuery(games, { ...defaultQuery, query: 'grid runner' });
    expect(byTitle.map((game) => game.slug)).toContain('grid-runner');

    const byDescription = runGameQuery(games, { ...defaultQuery, query: 'nested' });
    expect(byDescription.map((game) => game.slug)).toContain('grid-runner');

    const byTag = runGameQuery(games, { ...defaultQuery, query: 'canvas' });
    expect(byTag.map((game) => game.slug)).toEqual(['grid-runner']);
  });

  it('ranks exact title matches first', () => {
    const results = runGameQuery(games, { ...defaultQuery, query: 'grid' });
    expect(results[0].slug).toBe('grid-runner');
  });

  it('requires every term to match, so combinations narrow rather than widen', () => {
    const broad = runGameQuery(games, { ...defaultQuery, query: 'fixture' });
    const narrow = runGameQuery(games, { ...defaultQuery, query: 'fixture draft' });
    expect(narrow.length).toBeLessThan(broad.length);
    expect(narrow.every((game) => broad.includes(game))).toBe(true);
  });

  it('combines category filters with search without breaking either', () => {
    const filtered = runGameQuery(games, { ...defaultQuery, query: 'grid', categories: ['experimental'] });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((game) => game.categories.includes('experimental'))).toBe(true);

    const conflicting = runGameQuery(games, { ...defaultQuery, query: 'grid', categories: ['horror'] });
    expect(conflicting).toHaveLength(0);
  });

  it('supports several categories at once', () => {
    const results = runGameQuery(games, { ...defaultQuery, categories: ['roguelite', 'horror'] });
    const slugs = results.map((game) => game.slug).sort();
    expect(slugs).toEqual(['archived-fixture', 'unavailable-fixture']);
  });

  it('keeps sorting applied on top of search results', () => {
    const results = runGameQuery(games, { ...defaultQuery, query: 'fixture', sort: 'alphabetical' });
    const titles = results.map((game) => game.title);
    expect(titles.length).toBeGreaterThan(1);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
  });

  it('returns an empty list (not an error) when nothing matches', () => {
    expect(runGameQuery(games, { ...defaultQuery, query: 'zzzzzz' })).toEqual([]);
  });
});

describe('sortGames', () => {
  const mini: PublicGame[] = [
    { ...games[0], slug: 'a', title: 'Alpha', featured: false, releaseDate: null, updatedAt: null },
    { ...games[1], slug: 'b', title: 'Beta', featured: true, releaseDate: '2024-01-01', updatedAt: '2024-05-01' },
    { ...games[2], slug: 'c', title: 'Gamma', featured: false, releaseDate: '2023-01-01', updatedAt: null },
  ];

  it('puts featured games first by default', () => {
    expect(sortGames(mini, 'featured')[0].slug).toBe('b');
  });

  it('sorts newest first and pushes undated games to the end', () => {
    expect(sortGames(mini, 'newest').map((game) => game.slug)).toEqual(['b', 'c', 'a']);
  });

  it('sorts alphabetically', () => {
    expect(sortGames(mini, 'alphabetical').map((game) => game.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('sorts by last update and tolerates missing dates', () => {
    expect(sortGames(mini, 'updated').map((game) => game.slug)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the input list', () => {
    const input = [...mini];
    sortGames(input, 'alphabetical');
    expect(input.map((game) => game.slug)).toEqual(mini.map((game) => game.slug));
  });
});

describe('category helpers', () => {
  it('counts games per genre', () => {
    const counts = categoryCounts(games);
    expect(counts.puzzle).toBeGreaterThanOrEqual(2);
    expect(counts.horror).toBe(1);
    expect(counts.experimental).toBeGreaterThanOrEqual(2);
  });

  it('treats an empty category list as no filter', () => {
    expect(filterByCategories(games, [])).toHaveLength(games.length);
  });
});

describe('searchSite', () => {
  it('finds games and pages from real content', () => {
    const results = searchSite(games, 'puzzle');
    expect(results.some((result) => result.type === 'game')).toBe(true);

    const contact = searchSite(games, 'contact');
    expect(contact.some((result) => result.to === '/contact')).toBe(true);
  });

  it('ranks playable games above pages for a title match', () => {
    const results = searchSite(games, 'grid');
    expect(results[0].to).toBe('/games/grid-runner');
    expect(results[0].playable).toBe(true);
  });

  it('returns nothing (rather than everything) for a miss', () => {
    expect(searchSite(games, 'qqqqqqq')).toEqual([]);
  });

  it('never links to a route that does not exist', () => {
    const known = new Set([
      '/',
      '/games',
      '/about',
      '/contact',
      '/privacy',
      ...games.map((game) => `/games/${game.slug}`),
    ]);
    for (const result of searchSite(games, 'a')) {
      if (result.type === 'game') expect(known.has(result.to)).toBe(true);
    }
  });
});

describe('highlightParts', () => {
  it('marks matched terms without changing the text', () => {
    const parts = highlightParts('Grid Runner', ['runner']);
    expect(parts.map((part) => part.text).join('')).toBe('Grid Runner');
    expect(parts.find((part) => part.match)?.text.toLowerCase()).toBe('runner');
  });

  it('returns a single unmatched part when there are no terms', () => {
    expect(highlightParts('Grid Runner', [])).toEqual([{ text: 'Grid Runner', match: false }]);
  });
});
