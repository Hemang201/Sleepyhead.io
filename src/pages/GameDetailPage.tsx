import { Link, useParams } from 'react-router-dom';

import { STATUS_META, categoryLabel } from '../shared/catalogue';
import { useGame, useCatalogue } from '../lib/catalogue';
import { formatDate, relatedGames } from '../lib/library';
import { site } from '../data/site';
import { CategoryChips, StatusBadge, TagChips, accentColor } from '../components/Badges';
import { CopyLinkButton } from '../components/CopyLinkButton';
import { FavouriteButton } from '../components/FavouriteButton';
import { GameCard } from '../components/GameCard';
import { GamePlayer } from '../components/GamePlayer';
import { GameThumb } from '../components/GameThumb';
import { Seo } from '../components/Seo';
import { ErrorState, GameCardSkeleton, PageState } from '../components/States';
import { IconArrowRight, IconPlay, IconRestart } from '../components/Icons';

/** Controls grouped the way the dashboard collects them. */
const CONTROL_GROUPS: { key: 'keyboard' | 'mouse' | 'touch'; label: string }[] = [
  { key: 'keyboard', label: 'Keyboard' },
  { key: 'mouse', label: 'Mouse' },
  { key: 'touch', label: 'Touch' },
];

export default function GameDetailPage() {
  const { slug } = useParams();
  const { games, status, reload } = useCatalogue();
  const { game, status: loadStatus, error } = useGame(slug);

  if (status === 'loading' && !game) {
    return (
      <div className="container page">
        <GameCardSkeleton count={1} />
      </div>
    );
  }

  if (status === 'error' && !game) {
    return (
      <div className="container page">
        <ErrorState title="This game page could not load" body={<p>{error}</p>} onRetry={reload} />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="container page">
        <PageState
          title={loadStatus === 'loading' ? 'Loading this game…' : 'No game lives at that address'}
          body={
            <p>
              The link may be old, or the game may have been renamed or unpublished. {games.length} games are listed in
              the library right now.
            </p>
          }
          actions={
            <Link className="btn btn--primary" to="/games">
              Back to the library
              <IconArrowRight size={18} />
            </Link>
          }
        />
      </div>
    );
  }

  const meta = STATUS_META[game.status];
  const related = relatedGames(games, game, 3);
  const releaseDate = formatDate(game.releaseDate);
  const updated = formatDate(game.updatedAt);
  const controls = CONTROL_GROUPS.map((group) => ({ ...group, lines: game.controls[group.key] ?? [] })).filter(
    (group) => group.lines.length > 0,
  );

  return (
    <div className="page" style={{ ['--card-accent' as string]: accentColor(game.accent) }}>
      <Seo
        title={`${game.title} — play in your browser | ${site.developerName}`}
        description={game.shortDescription || game.description.slice(0, 160)}
        path={game.path}
        image={game.artwork.banner ?? game.artwork.thumbnail ?? undefined}
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'VideoGame',
          name: game.title,
          description: game.shortDescription,
          genre: game.categories.map(categoryLabel),
          author: { '@type': 'Person', name: site.developerName },
          ...(game.releaseDate ? { datePublished: game.releaseDate } : {}),
          ...(game.version ? { softwareVersion: game.version } : {}),
        }}
      />

      {/* ---------------------------------------------------------- detail hero
          The launch page uses the arcade scheme: violet and electric blue, with
          the game's own accent carried by the artwork frame and the primary
          action rather than by the page chrome. */}
      <section className="container detail-hero scheme--arcade">
        <nav aria-label="Breadcrumb">
          <ol className="breadcrumbs">
            <li>
              <Link to="/">Home</Link>
            </li>
            <li>
              <Link to="/games">Games</Link>
            </li>
            <li aria-current="page">{game.title}</li>
          </ol>
        </nav>

        {/* Mono specification rail: the launch-page equivalent of a product
            sticker — what this is, which version, when it last changed. */}
        <div className="detail-hero__rail">
          <span className="stamp stamp--ink" aria-hidden="true">
            Game
          </span>
          <span className="stamp stamp--ghost">{meta.label}</span>
          {game.version ? <span className="stamp stamp--ghost">v{game.version.replace(/^v/i, '')}</span> : null}
          {updated ? <span className="rail">Updated {updated}</span> : null}
          <span className="rail__sep" aria-hidden="true" />
          {game.featured ? <span className="mark mark--accent mark--lg" aria-hidden="true" /> : null}
        </div>

        <div className="details">
          <div className="stack stack--md">
            <div className="cluster">
              <StatusBadge status={game.status} />
              {game.featured ? <span className="badge badge--live">Featured</span> : null}
            </div>

            <h1 className="detail-hero__title">{game.title}</h1>
            <p className="detail-hero__summary">{game.shortDescription}</p>

            <CategoryChips categories={game.categories} />

            <div className="detail-hero__actions">
              {game.playable ? (
                <a className="btn btn--primary btn--lg" href="#play">
                  <IconPlay size={18} />
                  Play now
                </a>
              ) : (
                <span className="btn btn--lg" aria-disabled="true" title={meta.hint}>
                  {game.status === 'coming-soon'
                    ? 'Coming soon'
                    : game.status === 'in-development'
                      ? 'In development'
                      : game.status === 'unavailable'
                        ? 'Temporarily unavailable'
                        : 'No public player yet'}
                </span>
              )}
              {game.playable && game.itch.projectUrl ? (
                <a
                  className="btn btn--secondary btn--lg"
                  href={game.itch.projectUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open on itch.io
                </a>
              ) : null}
              <Link className="btn btn--secondary btn--lg" to="/games">
                Back to the library
              </Link>
              <FavouriteButton slug={game.slug} title={game.title} />
              <CopyLinkButton path={game.path} />
            </div>
          </div>

          <div className="detail-hero__art">
            <span className="frame__corners" aria-hidden="true" />
            <GameThumb
              src={game.artwork.banner ?? game.artwork.thumbnail}
              alt={`Key art for ${game.title}`}
              width={1280}
              height={720}
              priority
            />
            {game.artwork.placeholder ? (
              <span className="detail-hero__art-badge">
                <span className="badge badge--placeholder">Placeholder art</span>
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- content */}
      <section className="container detail-layout">
        <div className="stack stack--xl">
          <GamePlayer game={game} />

          <div className="panel panel--chunky stack stack--md">
            <h2 className="section__title" style={{ fontSize: 'var(--step-2)' }}>
              About this game
            </h2>
            {game.description
              .split('\n')
              .filter((line) => line.trim().length > 0)
              .map((paragraph, index) => (
                <p key={index} style={{ color: 'var(--text-muted)' }}>
                  {paragraph}
                </p>
              ))}
            {!game.description ? <p style={{ color: 'var(--text-muted)' }}>No description has been added yet.</p> : null}
            {game.tags.length > 0 ? <TagChips tags={game.tags} /> : null}
          </div>

          {game.instructions ? (
            <div className="panel stack stack--sm">
              <h2 className="section__title" style={{ fontSize: 'var(--step-2)' }}>
                How to play
              </h2>
              <p style={{ color: 'var(--text-muted)', whiteSpace: 'pre-line' }}>{game.instructions}</p>
            </div>
          ) : null}

          {controls.length > 0 ? (
            <div className="panel stack stack--md">
              <h2 className="section__title" style={{ fontSize: 'var(--step-2)' }}>
                Controls
              </h2>
              <div className="controls-grid">
                {controls.map((group) => (
                  <div key={group.key}>
                    <span className="field__label">{group.label}</span>
                    <ul className="control-list">
                      {group.lines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {game.artwork.screenshots.length > 0 ? (
            <div className="stack stack--md">
              <h2 className="section__title" style={{ fontSize: 'var(--step-2)' }}>
                Screenshots
              </h2>
              <div className="gallery">
                {game.artwork.screenshots.map((shot) => (
                  <GameThumb key={shot.url} src={shot.url} alt={shot.alt} width={1280} height={720} />
                ))}
              </div>
            </div>
          ) : null}

          {game.updateNotes ? (
            <div className="panel stack stack--sm">
              <h2 className="section__title" style={{ fontSize: 'var(--step-2)' }}>
                Latest update
              </h2>
              <p style={{ color: 'var(--text-muted)', whiteSpace: 'pre-line' }}>{game.updateNotes}</p>
            </div>
          ) : null}
        </div>

        <aside className="detail-aside">
          <dl className="meta-list">
            <div className="meta-list__row">
              <dt>Status</dt>
              <dd>{meta.label}</dd>
            </div>
            {game.version ? (
              <div className="meta-list__row">
                <dt>Version</dt>
                <dd>{game.version}</dd>
              </div>
            ) : null}
            {game.estimatedPlaytime ? (
              <div className="meta-list__row">
                <dt>Playtime</dt>
                <dd>{game.estimatedPlaytime}</dd>
              </div>
            ) : null}
            <div className="meta-list__row">
              <dt>Genres</dt>
              <dd>{game.categories.map(categoryLabel).join(', ') || '—'}</dd>
            </div>
            {releaseDate ? (
              <div className="meta-list__row">
                <dt>Released</dt>
                <dd>{releaseDate}</dd>
              </div>
            ) : null}
            {updated ? (
              <div className="meta-list__row">
                <dt>Updated</dt>
                <dd>{updated}</dd>
              </div>
            ) : null}
            <div className="meta-list__row">
              <dt>Developer</dt>
              <dd>{site.developerName}</dd>
            </div>
          </dl>

          <div className="callout">
            <span className="callout__title">Playable here, hosted on itch.io</span>
            <span>
              The game runs in a frame served by itch.io, so it cannot see this site, your session or anything stored in
              your browser here. Its own page on itch.io is always available if the embed gives you trouble.
            </span>
          </div>

          <div className="stack stack--sm">
            <span className="field__label">Something wrong with the game?</span>
            <div className="cluster">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  window.location.reload();
                }}
              >
                <IconRestart size={16} />
                Reload the page
              </button>
              <Link className="btn btn--ghost btn--sm" to="/contact">
                Report it
              </Link>
            </div>
          </div>
        </aside>
      </section>

      {/* ------------------------------------------------------------- related */}
      {related.length > 0 ? (
        <section
          className="container section scheme--arcade"
          aria-labelledby="related-heading"
        >
          <header className="sec-head" data-reveal>
            <span className="sec-head__index" aria-hidden="true">
              04
            </span>
            <div className="sec-head__body">
              <p className="section__eyebrow">Keep playing</p>
              <h2 className="section__title" id="related-heading">
                More from the arcade
              </h2>
            </div>
            <div className="sec-head__aside">
              <Link className="btn btn--ghost" to="/games">
                All games
                <IconArrowRight size={18} />
              </Link>
            </div>
          </header>
          <div className="grid grid--games" data-reveal-group>
            {related.map((entry) => (
              <GameCard key={entry.slug} game={entry} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
