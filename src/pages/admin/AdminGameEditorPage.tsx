import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
  GAME_STATUSES,
  STATUS_META,
  hasItchPlayer,
  publishBlockers,
  type AdminGame,
  type GameStatus,
} from '../../shared/catalogue';
import { api, ApiError } from '../../lib/api';
import { useAdmin, useAdminAction } from '../../lib/admin';
import { GameForm, draftFromGame } from '../../components/admin/GameForm';
import { ItchManager } from '../../components/admin/ItchManager';
import { ArtworkManager } from '../../components/admin/ArtworkManager';
import { ConfirmDialog } from '../../components/admin/ConfirmDialog';
import { StatusBadge } from '../../components/Badges';
import { GameCard } from '../../components/GameCard';
import { ErrorState } from '../../components/States';
import { STEPS, Stepper, type StepId } from '../../components/admin/Stepper';
import { IconExternal, IconTrash } from '../../components/Icons';

export default function AdminGameEditorPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { notify } = useAdmin();
  const { run, busy } = useAdminAction();

  const [game, setGame] = useState<AdminGame | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);

  const stepParam = (searchParams.get('step') ?? 'info') as StepId;
  const step: StepId = STEPS.some((entry) => entry.id === stepParam) ? stepParam : 'info';

  const load = useCallback(async () => {
    if (!id) return;
    setStatus('loading');
    try {
      const data = await api.admin.game(id);
      setGame(data.game);
      setStatus('ready');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That game could not be loaded.');
      setStatus('error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === 'loading') {
    return (
      <div className="stack stack--md admin-page" aria-hidden="true">
        <div className="skeleton" style={{ height: 48, width: 'min(360px, 70%)' }} />
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    );
  }

  if (status === 'error' || !game) {
    return (
      <div className="admin-page">
        <ErrorState
          title="That game could not be loaded"
          body={<p>{error ?? 'It may have been deleted.'}</p>}
          onRetry={() => void load()}
        />
        <div className="cluster">
          <Link className="btn btn--ghost" to="/admin/games">
            Back to all games
          </Link>
        </div>
      </div>
    );
  }

  const hasPlayer = hasItchPlayer(game);
  const hasArtwork = Boolean(game.artwork.thumbnail ?? game.artwork.banner);
  const blockers = publishBlockers(game);
  const readyToPublish = Object.keys(blockers).length === 0;

  const changeStatus = async (next: GameStatus) => {
    const result = await run(() => api.admin.updateGame(game.id, { status: next }), {
      ok: `${game.title} is now ${STATUS_META[next].label.toLowerCase()}`,
    });
    if (result) setGame(result.game);
  };

  const purge = async () => {
    const result = await run(() => api.admin.purgeGame(game.id), {
      ok: 'Game deleted',
      okBody: 'Its artwork was removed from storage.',
    });
    setPendingDelete(false);
    if (result) {
      notify({ tone: 'ok', title: 'Deleted', body: 'The catalogue no longer contains this game.' });
      navigate('/admin/games');
    }
  };

  return (
    <div className="stack stack--lg admin-page">
      <header className="admin-page__head">
        <div className="stack stack--xs">
          <p className="section__eyebrow">
            <Link to="/admin/games">All games</Link> / editing
          </p>
          <h1 className="section__title">{game.title}</h1>
          <div className="cluster">
            <StatusBadge status={game.status} />
            <span className="field__hint">/games/{game.slug}</span>
            {hasPlayer ? (
              <span className="field__hint">
                itch.io player connected · {game.itch.projectUrl?.replace('https://', '')}
              </span>
            ) : (
              <span className="field__hint">no itch.io player yet</span>
            )}
          </div>
        </div>

        <div className="cluster">
          <Link className="btn btn--ghost btn--sm" to={game.path} target="_blank" rel="noreferrer">
            View landing page
          </Link>
          {hasPlayer && game.itch.projectUrl ? (
            <a
              className="btn btn--ghost btn--sm"
              href={game.itch.projectUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open on itch.io
              <IconExternal size={14} />
            </a>
          ) : null}
        </div>
      </header>

      <Stepper current={step} gameId={game.id} complete={{ itch: hasPlayer, artwork: hasArtwork }} />

      {step === 'info' ? (
        <GameForm
          initial={draftFromGame(game)}
          mode="edit"
          gameId={game.id}
          hasPlayer={hasPlayer}
          hasArtwork={hasArtwork}
          onSaved={(updated) => setGame(updated)}
        />
      ) : null}

      {step === 'itch' ? <ItchManager game={game} /> : null}
      {step === 'artwork' ? <ArtworkManager game={game} onUpdated={setGame} /> : null}

      {step === 'publish' ? (
        <div className="stack stack--lg">
          <section className="panel stack stack--md" aria-labelledby="preview-heading">
            <h2 className="section__title" id="preview-heading" style={{ fontSize: 'var(--step-2)' }}>
              How it will look
            </h2>
            <p style={{ color: 'var(--text-muted)' }}>
              This is the exact card the public library renders from the stored data.
            </p>
            <div style={{ maxWidth: 420 }}>
              <GameCard game={game} />
            </div>
            <div className="cluster">
              <Link className="btn btn--secondary btn--sm" to={game.path} target="_blank" rel="noreferrer">
                Open the landing page
              </Link>
              {hasPlayer ? (
                <Link className="btn btn--ghost btn--sm" to={`/admin/games/${game.id}?step=itch`}>
                  Preview the itch.io player
                </Link>
              ) : null}
            </div>
          </section>

          <section className="panel stack stack--md" aria-labelledby="status-heading">
            <h2 className="section__title" id="status-heading" style={{ fontSize: 'var(--step-2)' }}>
              Visibility and status
            </h2>
            <ul className="checklist">
              <li data-ok={hasPlayer}>{hasPlayer ? 'itch.io player connected' : 'No valid itch.io player saved'}</li>
              <li data-ok={hasArtwork}>{hasArtwork ? 'Cover art uploaded' : 'Cover art is required before publishing'}</li>
              <li data-ok={game.title.trim().length > 0 && game.shortDescription.trim().length > 0}>
                Title and short description written
              </li>
              <li data-ok={game.playable}>
                {game.playable
                  ? 'Playable on the public site'
                  : game.status === 'coming-soon'
                    ? 'Announced publicly without a Play button'
                    : 'Not playable publicly yet'}
              </li>
            </ul>

            {!readyToPublish ? (
              <p className="field__hint">
                Before publishing: {Object.values(blockers).join(' ')}
              </p>
            ) : null}

            <div className="cluster">
              {GAME_STATUSES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="chip chip--selectable"
                  aria-pressed={game.status === value}
                  disabled={busy || game.status === value || (value === 'published' && !readyToPublish)}
                  title={value === 'published' && !readyToPublish ? 'Connect itch.io and add cover art first' : STATUS_META[value].hint}
                  onClick={() => void changeStatus(value)}
                >
                  {STATUS_META[value].label}
                </button>
              ))}
            </div>
            <p className="field__hint">
              Status is enforced by the server: a published game needs a valid itch.io page, a playable embed address and
              cover art. Drafts never reach the public catalogue.
            </p>
          </section>

          <section className="panel panel--danger stack stack--sm" aria-labelledby="danger-heading">
            <h2 className="section__title" id="danger-heading" style={{ fontSize: 'var(--step-2)' }}>
              Remove this game
            </h2>
            <p style={{ color: 'var(--text-muted)' }}>
              Archiving hides it from the public site and keeps everything. Deleting removes the listing and its uploaded
              artwork for good. The game on itch.io is untouched either way.
            </p>
            <div className="cluster">
              <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void changeStatus('archived')}>
                Archive
              </button>
              <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => setPendingDelete(true)}>
                <IconTrash size={14} />
                Delete permanently
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingDelete}
        title={`Permanently delete ${game.title}?`}
        body={
          <>
            <p>This removes the database record and the artwork stored on this site. There is no undo.</p>
            <p className="field__hint">
              Archive the game instead if you only want it off the public site. Its itch.io project is not affected.
            </p>
          </>
        }
        confirmLabel="Delete permanently"
        busy={busy}
        onConfirm={purge}
        onCancel={() => setPendingDelete(false)}
      />
    </div>
  );
}
