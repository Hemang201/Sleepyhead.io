import { useCallback, useEffect, useState } from 'react';

import { hasItchPlayer } from '../../shared/catalogue';
import { Link } from 'react-router-dom';

import { STATUS_META, type AdminGame, type OverviewResponse } from '../../shared/catalogue';
import { api, ApiError } from '../../lib/api';
import { StatusBadge } from '../../components/Badges';
import { IconArchive, IconLayers, IconSparkle, IconArrowUp } from '../../components/Icons';

export default function AdminOverviewPage() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setOverview(await api.admin.overview());
      setStatus('ready');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The dashboard could not load.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = overview?.counts;

  return (
    <div className="stack stack--lg admin-page">
      <header className="admin-page__head">
        <div>
          <p className="section__eyebrow">Dashboard</p>
          <h1 className="section__title">Your arcade</h1>
          <p className="section__lead">
            Everything here is stored in the database and served to the public site. Nothing on the website is hardcoded:
            publish, edit or remove a game and the site follows.
          </p>
        </div>
        <div className="cluster">
          <Link className="btn btn--primary" to="/admin/games/new">
            <IconArrowUp size={16} />
            Upload new game
          </Link>
          <Link className="btn btn--secondary" to="/admin/games">
            <IconLayers size={16} />
            Manage games
          </Link>
        </div>
      </header>

      {status === 'loading' ? (
        <div className="stat-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="skeleton" key={index} style={{ height: 96 }} />
          ))}
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="callout callout--warn">
          <span className="callout__title">Could not load the overview</span>
          <span>{error}</span>
          <div className="cluster" style={{ marginTop: 'var(--space-3)' }}>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void load()}>
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {status === 'ready' && counts ? (
        <>
          <section aria-labelledby="counts-heading">
            <h2 className="visually-hidden" id="counts-heading">
              Catalogue summary
            </h2>
            <div className="stat-grid">
              <Stat label="Total games" value={counts.total} hint="Every record, published or not" />
              <Stat label="Published" value={counts.published} hint="Visible and playable" tone={counts.published > 0 ? 'ok' : 'neutral'} />
              <Stat label="In development" value={counts.inDevelopment} hint="Prototypes and works in progress" />
              <Stat label="Coming soon" value={counts.comingSoon} hint="Announced, not playable" />
              <Stat label="Drafts" value={counts.draft} hint="Private to you" />
              <Stat label="Unavailable" value={counts.unavailable} hint="Listed but not playable" />
              <Stat label="Archived" value={counts.archived} hint="Hidden, kept for reference" />
              <Stat label="With a player" value={counts.withPlayer} hint="itch.io embed connected" />
            </div>
          </section>

          {counts.publishedWithoutPlayer > 0 ? (
            <div className="callout callout--warn">
              <span className="callout__title">
                {counts.publishedWithoutPlayer} published game(s) have no working itch.io player
              </span>
              <span>
                Visitors see the page and its honest status, but no Play button. Open the editor, add the itch.io page and
                embed addresses in Step A, then save.
              </span>
            </div>
          ) : null}

          <section aria-labelledby="recent-heading" className="stack stack--sm">
            <h2 className="section__title" id="recent-heading" style={{ fontSize: 'var(--step-2)' }}>
              Recently updated
            </h2>
            {overview && overview.recent.length > 0 ? (
              <div className="table-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Game</th>
                      <th scope="col">Status</th>
                      <th scope="col">Player</th>
                      <th scope="col">Updated</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.recent.map((game) => (
                      <RecentRow key={game.id} game={game} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)' }}>
                Nothing here yet. Add your first game and connect its itch.io player to get started — the dashboard will
                fill up as you publish.
              </p>
            )}
          </section>

          <section className="stack stack--sm">
            <h2 className="section__title" style={{ fontSize: 'var(--step-2)' }}>
              Quick actions
            </h2>
            <div className="cluster">
              <Link className="btn btn--ghost" to="/admin/games/new">
                <IconSparkle size={16} />
                Add new game
              </Link>
              <Link className="btn btn--ghost" to="/admin/games">
                <IconLayers size={16} />
                Manage games
              </Link>
              <Link className="btn btn--ghost" to="/admin/games?focus=artwork">
                <IconArchive size={16} />
                Manage artwork
              </Link>
              <Link className="btn btn--ghost" to="/" target="_blank" rel="noreferrer">
                View published website
              </Link>

            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value, hint, tone = 'neutral' }: { label: string; value: number; hint: string; tone?: 'neutral' | 'ok' }) {
  return (
    <div className={`stat stat--${tone}`}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
      <span className="stat__hint">{hint}</span>
    </div>
  );
}

function RecentRow({ game }: { game: AdminGame }) {
  return (
    <tr>
      <td>
        <Link to={`/admin/games/${game.id}`}>{game.title}</Link>
        <div className="field__hint">/games/{game.slug}</div>
      </td>
      <td>
        <StatusBadge status={game.status} />
      </td>
      <td>
        {hasItchPlayer(game) ? (
          <>
            itch.io <span className="field__hint">{STATUS_META[game.status].label}</span>
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
      </td>
    </tr>
  );
}
