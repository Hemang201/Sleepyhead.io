import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  CATEGORIES,
  GAME_STATUSES,
  STATUS_META,
  hasItchPlayer,
  publishBlockers,
  type AdminGame,
  type GameStatus,
} from '../../shared/catalogue';
import { api, ApiError } from '../../lib/api';
import { useAdmin, useAdminAction } from '../../lib/admin';
import { StatusBadge } from '../../components/Badges';
import { ConfirmDialog } from '../../components/admin/ConfirmDialog';
import { IconSearch, IconTrash } from '../../components/Icons';

const PAGE_SIZE = 10;
type SortKey = 'updated' | 'title' | 'status';

/** The management table: every game, including drafts and archived records. */
export default function AdminGamesPage() {
  const [searchParams] = useSearchParams();
  const { notify } = useAdmin();
  const { run, busy } = useAdminAction();

  const [games, setGames] = useState<AdminGame[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<GameStatus | 'all'>('all');
  const [genreFilter, setGenreFilter] = useState('all');
  const [sort, setSort] = useState<SortKey>('updated');
  const [page, setPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState<AdminGame | null>(null);
  const [pendingArchive, setPendingArchive] = useState<AdminGame | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const data = await api.admin.games();
      setGames(data.games);
      setStatus('ready');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The game list could not load.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = games.filter((game) => {
      if (statusFilter !== 'all' && game.status !== statusFilter) return false;
      if (genreFilter !== 'all' && !game.categories.includes(genreFilter)) return false;
      if (!needle) return true;
      return [game.title, game.slug, game.shortDescription, ...game.tags].join(' ').toLowerCase().includes(needle);
    });

    return matches.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title);
      if (sort === 'status') return STATUS_META[a.status].label.localeCompare(STATUS_META[b.status].label);
      return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
    });
  }, [games, genreFilter, query, sort, statusFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const applyGame = (game: AdminGame) => setGames((all) => all.map((entry) => (entry.id === game.id ? game : entry)));

  const setStatusFor = async (game: AdminGame, next: GameStatus) => {
    const result = await run(() => api.admin.updateGame(game.id, { status: next }), {
      ok: `${game.title} is now ${STATUS_META[next].label.toLowerCase()}`,
    });
    if (result) applyGame(result.game);
  };

  const publish = (game: AdminGame) => {
    const blockers = publishBlockers(game);
    if (Object.keys(blockers).length > 0) {
      notify({
        tone: 'error',
        title: 'Not ready to publish',
        body: `${Object.values(blockers).join(' ')} Open the editor to finish it, or use Coming soon to announce it.`,
      });
      return;
    }
    void setStatusFor(game, 'published');
  };

  const duplicate = async (game: AdminGame) => {
    const result = await run(() => api.admin.duplicateGame(game.id), {
      ok: 'Metadata duplicated',
      okBody: 'The copy is a private draft with no artwork yet.',
    });
    if (result) setGames((all) => [result.game, ...all]);
  };

  const archive = async () => {
    if (!pendingArchive) return;
    const target = pendingArchive;
    const result = await run(() => api.admin.archiveGame(target.id), { ok: `${target.title} archived` });
    setPendingArchive(null);
    if (result) applyGame(result.game);
  };

  const purge = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    const result = await run(() => api.admin.purgeGame(target.id), {
      ok: `${target.title} deleted permanently`,
      okBody: 'Its artwork was removed from storage.',
    });
    setPendingDelete(null);
    if (result) setGames((all) => all.filter((entry) => entry.id !== target.id));
  };

  const focusArtwork = searchParams.get('focus') === 'artwork';

  return (
    <div className="stack stack--lg admin-page">
      <header className="admin-page__head">
        <div>
          <p className="section__eyebrow">Catalogue</p>
          <h1 className="section__title">Manage games</h1>
          <p className="section__lead">
            {games.length} record(s). Drafts and archived games are only visible here — the public site shows nothing but
            what you publish.
          </p>
        </div>
        <Link className="btn btn--primary" to="/admin/games/new">
          Add new game
        </Link>
      </header>

      {focusArtwork ? (
        <div className="callout callout--info">
          <span className="callout__title">Managing artwork</span>
          <span>Open a game and use Step C to replace its thumbnail, banner or screenshots.</span>
        </div>
      ) : null}

      <section className="filter-bar" aria-labelledby="admin-filters">
        <h2 className="visually-hidden" id="admin-filters">
          Filter games
        </h2>
        <div className="toolbar">
          <div className="field" style={{ flex: '1 1 280px', minWidth: 0 }}>
            <label className="field__label" htmlFor="admin-search">
              <IconSearch size={14} /> Search games
            </label>
            <input
              id="admin-search"
              className="input"
              type="search"
              value={query}
              placeholder="Title, slug, tag…"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="admin-status">
              Status
            </label>
            <select
              id="admin-status"
              className="select"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as GameStatus | 'all');
                setPage(1);
              }}
            >
              <option value="all">All statuses</option>
              {GAME_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_META[value].label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="admin-genre">
              Genre
            </label>
            <select
              id="admin-genre"
              className="select"
              value={genreFilter}
              onChange={(event) => {
                setGenreFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All genres</option>
              {CATEGORIES.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="admin-sort">
              Sort
            </label>
            <select id="admin-sort" className="select" value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
              <option value="updated">Recently updated</option>
              <option value="title">Title A–Z</option>
              <option value="status">Status</option>
            </select>
          </div>
        </div>
        <p className="result-count" role="status" aria-live="polite">
          {filtered.length} of {games.length} games
        </p>
      </section>

      {status === 'loading' ? (
        <div className="stack stack--sm" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="skeleton" key={index} style={{ height: 64 }} />
          ))}
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="callout callout--warn">
          <span className="callout__title">Could not load your games</span>
          <span>{error}</span>
        </div>
      ) : null}

      {status === 'ready' && games.length === 0 ? (
        <div className="callout callout--info">
          <span className="callout__title">No games yet</span>
          <span>
            Add a game with its itch.io addresses and cover art and it will appear here — and on the public site once you
            publish it. Nothing is bundled with the website.
          </span>
        </div>
      ) : null}

      {status === 'ready' && games.length > 0 ? (
        <div className="table-scroll">
          <table className="admin-table admin-table--wide">
            <thead>
              <tr>
                <th scope="col">Art</th>
                <th scope="col">Game</th>
                <th scope="col">Status</th>
                <th scope="col">Player</th>
                <th scope="col">Updated</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((game) => (
                <tr key={game.id}>
                  <td>
                    {game.artwork.thumbnail ? (
                      <img className="admin-thumb" src={game.artwork.thumbnail} alt="" width={96} height={60} loading="lazy" />
                    ) : (
                      <span className="admin-thumb admin-thumb--empty" aria-hidden="true">
                        none
                      </span>
                    )}
                  </td>
                  <td>
                    <Link to={`/admin/games/${game.id}`}>{game.title}</Link>
                    <div className="field__hint">
                      /games/{game.slug}
                      {game.featured ? ' · featured' : ''}
                      {game.listed ? ' · listed' : ''}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={game.status} />
                  </td>
                  <td>
                    {hasItchPlayer(game) ? (
                      <>
                        itch.io
                        <div className="field__hint">{game.itch.projectUrl?.replace('https://', '')}</div>
                      </>
                    ) : (
                      <span className="field__hint">Not connected</span>
                    )}
                  </td>
                  <td>{new Date(game.updatedAt ?? '').toLocaleDateString()}</td>
                  <td className="admin-table__actions">
                    <Link className="btn btn--secondary btn--sm" to={`/admin/games/${game.id}`}>
                      Edit
                    </Link>
                    <Link className="btn btn--ghost btn--sm" to={game.path} target="_blank" rel="noreferrer">
                      Preview
                    </Link>
                    {game.status === 'published' ? (
                      <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void setStatusFor(game, 'draft')}>
                        Unpublish
                      </button>
                    ) : game.status !== 'archived' ? (
                      <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => publish(game)}>
                        Publish
                      </button>
                    ) : null}
                    <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void duplicate(game)}>
                      Duplicate
                    </button>
                    {game.status !== 'archived' ? (
                      <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setPendingArchive(game)}>
                        Archive
                      </button>
                    ) : (
                      <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void setStatusFor(game, 'draft')}>
                        Restore as draft
                      </button>
                    )}
                    <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setPendingDelete(game)}>
                      <IconTrash size={14} />
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {pages > 1 ? (
        <nav className="pagination" aria-label="Pagination">
          <button type="button" className="btn btn--ghost btn--sm" disabled={current === 1} onClick={() => setPage(current - 1)}>
            Previous
          </button>
          <span className="field__hint">
            Page {current} of {pages}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" disabled={current === pages} onClick={() => setPage(current + 1)}>
            Next
          </button>
        </nav>
      ) : null}

      <ConfirmDialog
        open={pendingArchive !== null}
        title={`Archive ${pendingArchive?.title ?? 'this game'}?`}
        body={<p>It disappears from the public site but stays here, with its artwork and itch.io addresses, until you decide otherwise.</p>}
        confirmLabel="Archive game"
        tone="primary"
        busy={busy}
        onConfirm={archive}
        onCancel={() => setPendingArchive(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Permanently delete ${pendingDelete?.title ?? 'this game'}?`}
        body={
          <>
            <p>
              This removes the database record and its uploaded artwork from storage. It does not touch the game on
              itch.io. There is no undo.
            </p>
            <p className="field__hint">Archive it instead if you might want it back.</p>
          </>
        }
        confirmLabel="Delete permanently"
        busy={busy}
        onConfirm={purge}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
