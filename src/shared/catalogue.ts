/**
 * The contract shared by all three parts of the platform: the Worker API (which
 * is the source of truth), the public site and the admin dashboard.
 *
 * Nothing here is game-specific. The catalogue is whatever the owner uploaded
 * through the dashboard; this file only describes its shape.
 */

import { parseItchEmbedUrl, parseItchProjectUrl } from './itch';

export type Accent = 'cyan' | 'violet' | 'pink' | 'lime' | 'orange' | 'blue';

/** Genre list. Ids are stored on games; labels and accents are presentational. */
export const CATEGORIES: { id: string; label: string; accent: Accent }[] = [
  { id: 'puzzle', label: 'Puzzle', accent: 'cyan' },
  { id: 'physics', label: 'Physics', accent: 'violet' },
  { id: 'action', label: 'Action', accent: 'pink' },
  { id: 'roguelite', label: 'Roguelite', accent: 'orange' },
  { id: 'adventure', label: 'Adventure', accent: 'blue' },
  { id: 'horror', label: 'Horror', accent: 'violet' },
  { id: 'educational', label: 'Educational', accent: 'lime' },
  { id: 'experimental', label: 'Experimental', accent: 'lime' },
  { id: 'arcade', label: 'Arcade', accent: 'orange' },
  { id: 'strategy', label: 'Strategy', accent: 'blue' },
  { id: 'narrative', label: 'Narrative', accent: 'pink' },
];

export type CategoryId = string;

export const ACCENTS: Accent[] = ['cyan', 'violet', 'pink', 'lime', 'orange', 'blue'];

/* ------------------------------------------------------------------ statuses */

export const GAME_STATUSES = [
  'draft',
  'in-development',
  'coming-soon',
  'published',
  'unavailable',
  'archived',
] as const;

export type GameStatus = (typeof GAME_STATUSES)[number];

export type StatusTone = 'live' | 'wip' | 'soon' | 'down' | 'draft' | 'archived';

export interface StatusMeta {
  label: string;
  /** CSS tone for the status badge. */
  tone: StatusTone;
  /** What the owner is choosing, in the dashboard. */
  hint: string;
  /** Draft and archived never appear publicly, whatever `listed` says. */
  canBePublic: boolean;
  /** Only a published game with a valid build gets a Play button. */
  playable: boolean;
  /** Non-published public statuses are opt-in through `listed`. */
  optIn: boolean;
}

export const STATUS_META: Record<GameStatus, StatusMeta> = {
  draft: { label: 'Draft', tone: 'draft', hint: 'Private. Only you can see it.', canBePublic: false, playable: false, optIn: false },
  'in-development': {
    label: 'In development',
    tone: 'wip',
    hint: 'Not playable publicly. You can list it as a preview.',
    canBePublic: true,
    playable: false,
    optIn: true,
  },
  'coming-soon': {
    label: 'Coming soon',
    tone: 'soon',
    hint: 'Public announcement with no Play button.',
    canBePublic: true,
    playable: false,
    optIn: true,
  },
  published: {
    label: 'Published',
    tone: 'live',
    hint: 'Public and playable once its itch.io player is connected.',
    canBePublic: true,
    playable: true,
    optIn: false,
  },
  unavailable: {
    label: 'Temporarily unavailable',
    tone: 'down',
    hint: 'Playing disabled. Keep it listed or hide it.',
    canBePublic: true,
    playable: false,
    optIn: true,
  },
  archived: { label: 'Archived', tone: 'archived', hint: 'Hidden from the public site, kept here.', canBePublic: false, playable: false, optIn: false },
};

/** Human-readable genre label for an id, for anywhere that shows one on its own. */
export function categoryLabel(id: string): string {
  return CATEGORIES.find((entry) => entry.id === id)?.label ?? id;
}

/** Accent for a genre id, used by filter chips and tags. */
export function categoryAccent(id: string): Accent {
  return CATEGORIES.find((entry) => entry.id === id)?.accent ?? 'cyan';
}

/** The single rule that decides public visibility, shared by API and UI. */
export function isPubliclyVisible(status: GameStatus, listed: boolean): boolean {
  const meta = STATUS_META[status];
  if (!meta.canBePublic) return false;
  if (!meta.optIn) return true;
  return listed;
}

/**
 * The names the repository gives its own development doubles.
 *
 * `seed-dev.mjs` creates one record per unpublished state as `…-fixture`, the
 * browser suite creates and then purges `verify-build-…`, and early versions of
 * the pipeline left a `pipeline-check` row behind. They are not games, so no
 * surface may present them as one — even if one is published by hand in a local
 * dashboard. This is a public-visibility guard only: the owner still sees these
 * records in the dashboard and can delete them.
 */
const FIXTURE_SLUGS = new Set(['pipeline-check']);

export function isFixtureSlug(slug: string): boolean {
  return FIXTURE_SLUGS.has(slug) || slug.endsWith('-fixture') || slug.startsWith('verify-build-');
}

/**
 * The catalogue rule: a card only exists when the game is published, a visitor
 * can actually play it, and it is a real game rather than a development double.
 * Announcements, drafts, archives, published rows with a missing or failed build
 * and fixture records stay out of the public list entirely.
 */
export function isCatalogueGame(game: Pick<PublicGame, 'status' | 'playable' | 'slug'>): boolean {
  return game.status === 'published' && game.playable && !isFixtureSlug(game.slug);
}

/**
 * The newest `updatedAt` in a catalogue, or the epoch when it has no games.
 *
 * This is the value the public API uses as its ETag input and its `updatedAt`
 * field. It must depend only on the data — deriving it from the clock made every
 * response unique, so a client's `If-None-Match` could never match and the
 * catalogue was re-sent in full every time.
 */
export function latestGameUpdate(games: Pick<PublicGame, 'updatedAt'>[]): string {
  return games.reduce(
    (latest, game) => (game.updatedAt && game.updatedAt > latest ? game.updatedAt : latest),
    new Date(0).toISOString(),
  );
}

/** The itch.io configuration a game is played through. */
export interface ItchPlayerConfig {
  /** Canonical public project address, when one is saved. */
  projectUrl: string | null;
  /** Canonical playable iframe address, when one is saved. */
  embedUrl: string | null;
}

/**
 * Everything the owner still has to supply before a game can go public.
 *
 * The dashboard shows this list and the Worker enforces the same rules, so the
 * two can never disagree about why Publish is refused. Cover artwork is part of
 * it: the public site is a portfolio first, and a published card with no art
 * (or no player behind it) is not a finished listing.
 */
export function publishBlockers(
  game: Pick<PublicGame, 'title' | 'itch' | 'artwork'>,
): { itchUrl?: string; itchEmbedUrl?: string; artwork?: string } {
  const blockers: { itchUrl?: string; itchEmbedUrl?: string; artwork?: string } = {};
  if (!parseItchProjectUrl(game.itch.projectUrl).ok) {
    blockers.itchUrl = 'Add the game’s itch.io page address.';
  }
  if (!parseItchEmbedUrl(game.itch.embedUrl).ok) {
    blockers.itchEmbedUrl = 'Add the playable itch.io embed address.';
  }
  if (!game.artwork.thumbnail && !game.artwork.banner) {
    blockers.artwork = 'Upload a thumbnail or banner so the listing has cover art.';
  }
  return blockers;
}

/** True when a game has a saved, valid itch.io player. */
export function hasItchPlayer(game: Pick<PublicGame, 'itch'>): boolean {
  return parseItchEmbedUrl(game.itch.embedUrl).ok && parseItchProjectUrl(game.itch.projectUrl).ok;
}

/* --------------------------------------------------------------------- games */

export interface GameControls {
  keyboard?: string[];
  mouse?: string[];
  touch?: string[];
}

export type Screenshot = { url: string; alt: string };

export interface GameArtwork {
  /** Absolute paths on this site, or null when nothing was uploaded. */
  thumbnail: string | null;
  banner: string | null;
  screenshots: Screenshot[];
  /** True when the owner has uploaded no cover, so the site draws placeholder art. */
  placeholder: boolean;
}

/** A game exactly as the public site is allowed to see it. */
export interface PublicGame {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  description: string;
  /** Genre ids; label + accent come from CATEGORIES. */
  categories: CategoryId[];
  tags: string[];
  status: GameStatus;
  featured: boolean;
  accent: Accent;
  releaseDate: string | null;
  updatedAt: string | null;
  version: string | null;
  updateNotes: string | null;
  instructions: string;
  controls: GameControls;
  estimatedPlaytime: string | null;
  artwork: GameArtwork;
  /** The itch.io game this listing launches, parsed and canonicalised. */
  itch: ItchPlayerConfig;
  /** Only ever true for a published game with a saved itch.io player. */
  playable: boolean;
  /** Absolute itch.io embed address, when playable. */
  playUrl: string | null;
  /** Route to the game's page. */
  path: string;
}

/** Everything the dashboard needs, including unpublished fields. */
export interface AdminGame extends PublicGame {
  listed: boolean;
  createdAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  /**
   * The stored storage references, so the editor can show what replacing an
   * asset will delete. Either a legacy R2 key or a Get Pronto reference.
   */
  artworkKeys: { thumbnail: string | null; banner: string | null; screenshots: string[] };
}

export interface CatalogueResponse {
  games: PublicGame[];
  updatedAt: string;
}

export interface OverviewResponse {
  counts: {
    total: number;
    published: number;
    inDevelopment: number;
    comingSoon: number;
    draft: number;
    unavailable: number;
    archived: number;
    /** Published games with no working itch.io player: nobody can play them. */
    publishedWithoutPlayer: number;
    /** Games with a saved, valid itch.io player. */
    withPlayer: number;
  };
  recent: AdminGame[];
}

export interface ApiError {
  error: string;
  message: string;
  /** Present for validation failures, keyed by field path. */
  fields?: Record<string, string>;
}

/* ------------------------------------------------------------------ validation */

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface GameInput {
  title: string;
  slug: string;
  shortDescription: string;
  description: string;
  categories: CategoryId[];
  tags: string[];
  instructions: string;
  controls: GameControls;
  /** Optional text fields are `null` when the database has no value for them. */
  estimatedPlaytime: string | null;
  version: string | null;
  releaseDate: string | null;
  updateNotes: string | null;
  accent: Accent;
  featured: boolean;
  listed: boolean;
  status: GameStatus;
  /** Canonical itch.io project address, or null when none is saved. */
  itchUrl: string | null;
  /** Canonical itch.io playable iframe address, or null when none is saved. */
  itchEmbedUrl: string | null;
}

/** Field-level validation shared by the dashboard and the server. */
export function validateGameInput(input: Partial<GameInput>): Record<string, string> {
  const errors: Record<string, string> = {};
  const title = (input.title ?? '').trim();

  if (!title) errors.title = 'A title is required.';
  else if (title.length > 120) errors.title = 'Keep the title under 120 characters.';

  const slug = (input.slug ?? '').trim();
  if (!slug) errors.slug = 'A URL slug is required.';
  else if (!SLUG_PATTERN.test(slug)) errors.slug = 'Use lowercase letters, numbers and single hyphens (e.g. pixel-painter).';
  else if (slug.length > 80) errors.slug = 'Keep the slug under 80 characters.';

  if ((input.shortDescription ?? '').length > 200) errors.shortDescription = 'Keep the summary under 200 characters.';
  if ((input.description ?? '').length > 20000) errors.description = 'That description is very long.';

  if (input.status && !GAME_STATUSES.includes(input.status)) errors.status = 'Unknown status.';
  if ((input.categories ?? []).length > 6) errors.categories = 'Pick at most 6 genres.';
  if ((input.tags ?? []).length > 20) errors.tags = 'Keep tags to 20 or fewer.';
  if (input.releaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.releaseDate)) {
    errors.releaseDate = 'Use a YYYY-MM-DD date, or leave it empty rather than inventing one.';
  }
  if (input.estimatedPlaytime && input.estimatedPlaytime.length > 40) errors.estimatedPlaytime = 'Keep that short (40 characters max).';
  if (input.version && input.version.length > 40) errors.version = 'Keep the version short.';

  /*
   * itch.io addresses are optional while the listing is a draft (the owner may
   * not have created the project yet), but a published game must have both: the
   * page address for the "open on itch.io" fallback, and the embed address for
   * the player itself. The Worker applies the same rule before writing.
   */
  const itchUrl = (input.itchUrl ?? '').trim();
  const itchEmbedUrl = (input.itchEmbedUrl ?? '').trim();
  if (itchUrl) {
    const parsed = parseItchProjectUrl(itchUrl);
    if (!parsed.ok) errors.itchUrl = parsed.error;
  }
  if (itchEmbedUrl) {
    const parsed = parseItchEmbedUrl(itchEmbedUrl);
    if (!parsed.ok) errors.itchEmbedUrl = parsed.error;
  }
  if (input.status === 'published') {
    if (!itchUrl) errors.itchUrl = 'A published game needs its itch.io page address.';
    if (!itchEmbedUrl) errors.itchEmbedUrl = 'A published game needs its playable itch.io embed address.';
  }

  return errors;
}

/** Turns a title into a candidate slug the owner can edit. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
