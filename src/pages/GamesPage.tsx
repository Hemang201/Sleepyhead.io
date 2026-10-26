import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { site } from '../data/site';
import { CATEGORIES, type CategoryId } from '../shared/catalogue';
import { useCatalogue } from '../lib/catalogue';
import { SORT_OPTIONS, categoryCounts, isSortKey, runGameQuery, type SortKey } from '../lib/games-query';
import { favouritesStore, filtersStore, emptyFilters } from '../lib/preferences';
import { useStore } from '../lib/hooks';
import { track } from '../lib/analytics';
import { GameCard } from '../components/GameCard';
import { ArcadeEmptyState, ErrorState, GameCardSkeleton, NoResultsState } from '../components/States';
import { Seo } from '../components/Seo';
import { accentColor } from '../components/Badges';
import { IconClose, IconHeart, IconSearch } from '../components/Icons';

function parseCategories(value: string | null): CategoryId[] {
  if (!value) return [];
  const known = new Set<string>(CATEGORIES.map((category) => category.id));
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is CategoryId => known.has(item));
}

export default function GamesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { games, status, error, reload } = useCatalogue();

  // URL state wins on load (shareable filtered views); otherwise the stored
  // preferences from the last visit are restored.
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const [categories, setCategories] = useState<CategoryId[]>(() => {
    const fromUrl = parseCategories(searchParams.get('genre'));
    return fromUrl.length > 0 ? fromUrl : filtersStore.get().categories;
  });
  const [sort, setSort] = useState<SortKey>(() => {
    const fromUrl = searchParams.get('sort');
    return isSortKey(fromUrl) ? fromUrl : filtersStore.get().sort;
  });
  const [savedOnly, setSavedOnly] = useState(false);

  const favourites = useStore(favouritesStore);

  // Persist only non-sensitive UI preferences.
  useEffect(() => {
    filtersStore.set({ categories, sort });
  }, [categories, sort]);

  // Keep the URL in step so a filtered library can be linked or bookmarked.
  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (categories.length > 0) params.set('genre', categories.join(','));
    if (sort !== 'featured') params.set('sort', sort);
    setSearchParams(params, { replace: true });
  }, [categories, query, setSearchParams, sort]);

  const source = useMemo(
    () => (savedOnly ? games.filter((game) => favourites.includes(game.slug)) : games),
    [favourites, games, savedOnly],
  );

  const results = useMemo(() => runGameQuery(source, { query, categories, sort }), [categories, query, sort, source]);
  const counts = useMemo(() => categoryCounts(games), [games]);
  const publishedCount = useMemo(() => games.filter((game) => game.playable).length, [games]);

  const filtersActive = query.trim().length > 0 || categories.length > 0 || sort !== 'featured' || savedOnly;

  const reset = () => {
    setQuery('');
    setCategories([]);
    setSort('featured');
    setSavedOnly(false);
    filtersStore.set(emptyFilters);
    track('filter_changed', { action: 'reset' });
  };

  const toggleCategory = (category: CategoryId) => {
    setCategories((current) =>
      current.includes(category) ? current.filter((item) => item !== category) : [...current, category],
    );
    track('filter_changed', { action: 'category', category });
  };

  return (
    /* The library is the cool band: cyan, ice and blue, and a quieter dot grid
       than the hero's halftone so the artwork carries the colour. */
    <div className="page scheme--library">
      <Seo
        title={
          games.length > 0
            ? `Games library — ${games.length} browser games | Hemang Gupta`
            : `Games library | ${site.developerName}`
        }
        description={
          games.length > 0
            ? `Browse every browser game in the arcade: filter by genre, search by mechanic, and play ${publishedCount} published games instantly in your browser.`
            : 'The arcade is getting ready. The first browser game is in development and will appear here when it is published.'
        }
        path="/games"
      />

      <div className="container">
        <nav aria-label="Breadcrumb">
          <ol className="breadcrumbs">
            <li>
              <Link to="/">Home</Link>
            </li>
            <li aria-current="page">Games</li>
          </ol>
        </nav>

        <header className="sec-head" data-reveal>
          <span className="sec-head__index" aria-hidden="true">
            01
          </span>
          <div className="sec-head__body">
            <p className="section__eyebrow">The library</p>
            <h1 className="section__title">Every game in the arcade</h1>
            <p className="section__lead">
              {games.length > 0
                ? `${games.length} ${games.length === 1 ? 'game' : 'games'}, each one played through its itch.io release. Everything here runs in the page — nothing pretends to be further along than it is.`
                : 'The library opens the moment the first game is published. Nothing is listed until it is real.'}
            </p>
          </div>
          {games.length > 0 ? (
            <div className="sec-head__aside">
              <span className="stamp stamp--ghost">{games.length} in catalogue</span>
              <span className="stamp stamp--accent">{publishedCount} playable</span>
            </div>
          ) : null}
        </header>

        {/* ----------------------------------------------------- filter bar */}
        {/* No games means no filters: an empty control panel would suggest there
            is something to search, and it is quieter without one. */}
        {games.length > 0 ? (
        <section className="filter-bar" aria-labelledby="filters-heading">
          <h2 className="visually-hidden" id="filters-heading">
            Search and filter the games library
          </h2>

          <div className="toolbar">
            <div className="field" style={{ flex: '1 1 320px', minWidth: 0 }}>
              <label className="field__label" htmlFor="library-search">
                <IconSearch size={14} /> Search this library
              </label>
              <input
                id="library-search"
                className="input"
                type="search"
                value={query}
                placeholder="Try “puzzle”, “arcade”, “physics”…"
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            <div className="toolbar__group">
              <div className="field">
                <label className="field__label" htmlFor="library-sort">
                  Sort by
                </label>
                <select
                  id="library-sort"
                  className="select"
                  value={sort}
                  onChange={(event) => {
                    const next = event.target.value as SortKey;
                    setSort(next);
                    track('filter_changed', { action: 'sort', sort: next });
                  }}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {favourites.length > 0 ? (
                <button
                  type="button"
                  className="chip chip--selectable"
                  aria-pressed={savedOnly}
                  onClick={() => setSavedOnly((current) => !current)}
                  style={{ minHeight: 46 }}
                >
                  <IconHeart size={15} filled={savedOnly} />
                  Saved only
                  <span className="chip__count">{favourites.length}</span>
                </button>
              ) : null}
            </div>
          </div>

          <div>
            <p className="filter-bar__legend" id="genre-legend">
              Genres {categories.length > 0 ? `· ${categories.length} selected` : '· all'}
            </p>
            <div className="filter-bar__row" style={{ marginTop: 'var(--space-2)' }} role="group" aria-labelledby="genre-legend">
              {CATEGORIES.map((category) => {
                const pressed = categories.includes(category.id);
                const count = counts[category.id] ?? 0;
                return (
                  <button
                    key={category.id}
                    type="button"
                    className="chip chip--selectable"
                    style={{ ['--chip-accent' as string]: accentColor(category.accent) }}
                    aria-pressed={pressed}
                    disabled={count === 0}
                    title={count === 0 ? `Nothing tagged ${category.label} yet` : undefined}
                    onClick={() => toggleCategory(category.id)}
                  >
                    {category.label}
                    <span className="chip__count">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="filter-bar__row" style={{ justifyContent: 'space-between' }}>
            <p className="result-count" role="status" aria-live="polite">
              Showing <strong>{results.length}</strong> of <strong>{games.length}</strong> games
              {savedOnly ? ' (saved only)' : ''}
            </p>
            {filtersActive ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={reset}>
                <IconClose size={16} />
                Reset filters
              </button>
            ) : null}
          </div>
        </section>
        ) : null}

        {/* --------------------------------------------------------- results */}
        <section className="section section--tight" aria-label="Game results">
          {status === 'loading' ? <GameCardSkeleton count={6} /> : null}

          {status === 'error' ? (
            <ErrorState
              title="The library could not load"
              body={<p>{error ?? 'The catalogue is unavailable right now.'}</p>}
              onRetry={reload}
            />
          ) : null}

          {status !== 'loading' && status !== 'error' ? (
            games.length === 0 ? (
              <ArcadeEmptyState className="arcade-empty--wide" />
            ) : results.length > 0 ? (
              <div className="grid grid--games" data-reveal-group>
                {results.map((game, index) => (
                  <GameCard key={game.slug} game={game} priority={index < 3} />
                ))}
              </div>
            ) : savedOnly && favourites.length === 0 ? (
              <NoResultsState query={`saved games`} onReset={reset} />
            ) : (
              <NoResultsState query={query || categories.join(', ') || 'your filters'} onReset={reset} />
            )
          ) : null}
        </section>

        {games.length > 0 ? (
          <div className="callout callout--info">
            <span className="callout__title">Published means playable</span>
            <span>
              Only a game with a working itch.io player is listed. There are no announcements, placeholders or dead
              Play buttons in this library.
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
