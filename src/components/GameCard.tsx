import { Link } from 'react-router-dom';

import { STATUS_META, type PublicGame } from '../shared/catalogue';
import { accentColor, CategoryChips, PlaceholderBadge, StatusBadge } from './Badges';
import { FavouriteButton } from './FavouriteButton';
import { GameThumb } from './GameThumb';
import { IconClock, IconExternal, IconPlay } from './Icons';

/** What a non-playable game says instead of a Play button. */
const NOT_PLAYABLE_LABEL: Partial<Record<PublicGame['status'], string>> = {
  'coming-soon': 'Coming soon',
  'in-development': 'In development',
  unavailable: 'Unavailable',
  draft: 'Draft',
  archived: 'Archived',
  published: 'No player yet',
};

/** Which shape a card takes in the layout. */
export type GameCardVariant = 'default' | 'banner' | 'row';

/**
 * One card for every game, driven entirely by the catalogue the API returned.
 *
 * Three shapes, one component — a card that says something different about the
 * game in each slot would drift out of sync with the others:
 *
 *   default  artwork above the copy; the library and the related-games strip.
 *   banner   artwork *behind* the copy. The single entry point on the home page.
 *   row      a compact horizontal row: thumbnail, title, chips. The 2x2 field
 *            beside the banner.
 *
 * Availability is stated honestly in all three: only a published game with a
 * validated, active build gets a "Play Now" action. Everything else states its
 * status as plain (non-clickable) text, so there are no dead buttons anywhere.
 */
export function GameCard({
  game,
  priority = false,
  lead = false,
  variant = 'default',
  flag,
}: {
  game: PublicGame;
  priority?: boolean;
  /** The wider, taller slot used for the first featured game. */
  lead?: boolean;
  variant?: GameCardVariant;
  /** A short coloured tag in the corner of the banner card. */
  flag?: string;
}) {
  const detailPath = game.path;
  const meta = STATUS_META[game.status];
  const shape = lead && variant === 'default' ? 'default' : variant;

  return (
    <article
      className={`card card--chunky card--interactive game-card game-card--${shape}${lead ? ' game-card--lead' : ''}`}
      style={{ ['--card-accent' as string]: accentColor(game.accent) }}
    >
      {/* The lead card is the one heavy frame in the featured band: crop marks
          sit just outside its border, purely decorative. */}
      {lead && shape === 'default' ? <span className="frame__corners" aria-hidden="true" /> : null}

      {shape === 'banner' && flag ? <span className="game-card__flag">{flag}</span> : null}

      <div className="game-card__media">
        <GameThumb
          className="game-card__art"
          src={shape === 'banner' ? game.artwork.banner ?? game.artwork.thumbnail : game.artwork.thumbnail}
          alt={shape === 'banner' ? `Artwork for ${game.title}` : `Cover art for ${game.title}`}
          priority={priority}
        />
        <div className="game-card__badges">
          <StatusBadge status={game.status} />
          {game.artwork.placeholder ? <PlaceholderBadge /> : null}
        </div>
        <div className="game-card__fav">
          <FavouriteButton slug={game.slug} title={game.title} size="sm" />
        </div>
        {/* Decorative affordance over the artwork: the accessible Play action is
            the labelled link in the action row below. */}
        {game.playable ? (
          <span className="game-card__play" aria-hidden="true">
            <IconPlay size={14} />
            Play now
          </span>
        ) : null}
      </div>

      <div className="game-card__body">
        <h3 className="game-card__title">
          <Link to={detailPath}>{game.title}</Link>
        </h3>

        {/* The row shape is title-and-chips only: at 6rem of thumbnail there is
            no room for a description, and a trimmed one would read as damage
            rather than as editing. */}
        {shape !== 'row' ? <p className="game-card__description">{game.shortDescription}</p> : null}

        {shape === 'row' ? (
          <StatusBadge
            status={game.status}
            className="game-card__row-status"
            label={game.playable ? 'Playable now' : undefined}
          />
        ) : null}

        <CategoryChips categories={game.categories} />

        <ul className="game-card__meta">
          {game.estimatedPlaytime ? (
            <li>
              <IconClock size={14} />
              <span className="visually-hidden">Estimated playtime: </span>
              {game.estimatedPlaytime}
            </li>
          ) : null}
          {game.version ? <li>v{game.version.replace(/^v/i, '')}</li> : null}
        </ul>

        <div className="game-card__actions">
          {game.playable ? (
            <Link className="btn btn--primary btn--sm" to={`${detailPath}#play`}>
              <IconPlay size={16} />
              Play Now
            </Link>
          ) : (
            <span
              className="btn btn--sm"
              aria-disabled="true"
              title={meta.hint}
            >
              {NOT_PLAYABLE_LABEL[game.status] ?? 'Not playable yet'}
            </span>
          )}
          <Link className="btn btn--ghost btn--sm" to={detailPath}>
            Details
            <span className="visually-hidden"> for {game.title}</span>
          </Link>
        </div>
      </div>

      {/* In the row shape the card opens from its own surface, and this is the
          quiet affordance that says so. It is decoration: the title link above
          is the accessible target. */}
      {shape === 'row' ? (
        <span className="game-card__open" aria-hidden="true">
          <IconExternal size={14} />
        </span>
      ) : null}
    </article>
  );
}
