import { describe, expect, it } from 'vitest';

import {
  CATEGORIES,
  GAME_STATUSES,
  STATUS_META,
  hasItchPlayer,
  isActivatableBuild,
  publishBlockers,
  isCatalogueGame,
  isFixtureSlug,
  isPubliclyVisible,
  latestGameUpdate,
  slugify,
  validateGameInput,
} from '../src/shared/catalogue';

/**
 * These are the rules the public site and the API both rely on: what a valid
 * game looks like, and which publication states are visible to visitors.
 */

describe('slugify', () => {
  it('produces URL-safe slugs from titles', () => {
    expect(slugify('Pixel Painter')).toBe('pixel-painter');
    expect(slugify('  Tunnel   RUSH!!  ')).toBe('tunnel-rush');
    expect(slugify('Café Noir')).toBe('cafe-noir');
    expect(slugify('---')).toBe('');
  });

  it('keeps slugs within the allowed length', () => {
    expect(slugify('x'.repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe('validateGameInput', () => {
  const valid = {
    title: 'A Game',
    slug: 'a-game',
    shortDescription: 'Short.',
    description: 'Longer.',
    status: 'draft' as const,
  };

  it('accepts a complete, sane game', () => {
    expect(validateGameInput(valid)).toEqual({});
  });

  it('requires a title', () => {
    expect(validateGameInput({ ...valid, title: '   ' }).title).toBeTruthy();
  });

  it('rejects slugs that would break a URL', () => {
    for (const slug of ['Has Spaces', 'UPPER', 'trailing-', '-leading', 'double--dash', 'sym/bol', 'émphasis']) {
      expect(validateGameInput({ ...valid, slug }), slug).toHaveProperty('slug');
    }
  });

  it('rejects an unknown status', () => {
    expect(validateGameInput({ ...valid, status: 'launched' as never })).toHaveProperty('status');
  });

  it('rejects invented date formats', () => {
    expect(validateGameInput({ ...valid, releaseDate: '01/02/2026' })).toHaveProperty('releaseDate');
    expect(validateGameInput({ ...valid, releaseDate: '2026-02-01' })).toEqual({});
  });

  it('caps genres and tags so the UI cannot be flooded', () => {
    expect(validateGameInput({ ...valid, categories: Array(9).fill('puzzle') })).toHaveProperty('categories');
    expect(validateGameInput({ ...valid, tags: Array(30).fill('tag') })).toHaveProperty('tags');
  });
});

describe('publication status', () => {
  it('describes every status, with a badge tone', () => {
    for (const status of GAME_STATUSES) {
      const meta = STATUS_META[status];
      expect(meta.label, status).toBeTruthy();
      expect(meta.tone, status).toBeTruthy();
      expect(meta.hint, status).toBeTruthy();
    }
  });

  it('only lets a published game be playable', () => {
    const playable = GAME_STATUSES.filter((status) => STATUS_META[status].playable);
    expect(playable).toEqual(['published']);
  });

  it('never exposes drafts or archived games, whatever the listed flag says', () => {
    expect(isPubliclyVisible('draft', true)).toBe(false);
    expect(isPubliclyVisible('archived', true)).toBe(false);
  });

  it('publishes published games without needing an opt-in', () => {
    expect(isPubliclyVisible('published', false)).toBe(true);
  });

  it('makes announcements visible only when the owner opts in', () => {
    for (const status of ['coming-soon', 'in-development', 'unavailable'] as const) {
      expect(isPubliclyVisible(status, false), status).toBe(false);
      expect(isPubliclyVisible(status, true), status).toBe(true);
    }
  });

  it('puts only published, playable games in the public catalogue', () => {
    expect(isCatalogueGame({ status: 'published', playable: true, slug: 'neon-drift' })).toBe(true);
    expect(isCatalogueGame({ status: 'published', playable: false, slug: 'neon-drift' })).toBe(false);
    for (const status of ['draft', 'in-development', 'coming-soon', 'unavailable', 'archived'] as const) {
      expect(isCatalogueGame({ status, playable: true, slug: 'neon-drift' }), status).toBe(false);
    }
  });

  it('never presents a development double as a public game', () => {
    for (const slug of ['pipeline-check', 'draft-fixture', 'verify-build-1750000000']) {
      expect(isFixtureSlug(slug), slug).toBe(true);
      expect(isCatalogueGame({ status: 'published', playable: true, slug }), slug).toBe(false);
    }
    // A real game is not caught by the pattern just for using a similar word.
    for (const slug of ['fixtures', 'my-fixture-game', 'verify-the-build']) {
      expect(isFixtureSlug(slug), slug).toBe(false);
    }
  });

  it('keeps genre ids unique and non-empty', () => {
    const ids = CATEGORIES.map((category) => category.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z-]+$/.test(id))).toBe(true);
  });
});

describe('catalogue cache identity', () => {
  it('derives a stable timestamp from the data, not the clock', () => {
    const games = [
      { updatedAt: '2026-01-01T00:00:00.000Z' },
      { updatedAt: '2026-03-04T12:00:00.000Z' },
      { updatedAt: '2026-02-02T00:00:00.000Z' },
    ];
    expect(latestGameUpdate(games)).toBe('2026-03-04T12:00:00.000Z');
    expect(latestGameUpdate([...games].reverse())).toBe(latestGameUpdate(games));
  });

  it('is stable for an empty catalogue and ignores missing timestamps', () => {
    expect(latestGameUpdate([])).toBe('1970-01-01T00:00:00.000Z');
    expect(latestGameUpdate([{ updatedAt: null }, { updatedAt: '2026-04-01T00:00:00.000Z' }])).toBe(
      '2026-04-01T00:00:00.000Z',
    );
  });
});

describe('publishing needs a playable itch.io listing', () => {
  const itch = (projectUrl: string | null, embedUrl: string | null) => ({ projectUrl, embedUrl });
  const game = (overrides: { itch?: ReturnType<typeof itch>; art?: boolean } = {}) =>
    ({
      title: 'A Game',
      itch: overrides.itch ?? itch('https://studio.itch.io/game', 'https://itch.io/embed-upload/123?color=202124'),
      artwork: {
        thumbnail: overrides.art === false ? null : '/api/media/artwork/id/thumbnail',
        banner: null,
        screenshots: [],
        placeholder: false,
      },
    }) as unknown as Parameters<typeof publishBlockers>[0];

  it('accepts a complete listing', () => {
    expect(publishBlockers(game())).toEqual({});
  });

  it('needs both the page address and the embed address', () => {
    expect(publishBlockers(game({ itch: itch(null, 'https://itch.io/embed-upload/123') }))).toHaveProperty('itchUrl');
    expect(publishBlockers(game({ itch: itch('https://studio.itch.io/game', null) }))).toHaveProperty('itchEmbedUrl');
  });

  it('refuses a widget address as the player', () => {
    expect(publishBlockers(game({ itch: itch('https://studio.itch.io/game', 'https://itch.io/embed/123') }))).toHaveProperty(
      'itchEmbedUrl',
    );
  });

  it('needs cover art on this site', () => {
    expect(publishBlockers(game({ art: false }))).toHaveProperty('artwork');
  });

  it('only calls a game playable with a valid embed address', () => {
    expect(hasItchPlayer({ itch: itch('https://studio.itch.io/game', 'https://itch.io/embed-upload/123') })).toBe(true);
    expect(hasItchPlayer({ itch: itch('https://studio.itch.io/game', null) })).toBe(false);
    expect(hasItchPlayer({ itch: itch('https://elsewhere.example/game', 'https://itch.io/embed-upload/123') })).toBe(false);
  });
});

describe('build activation', () => {
  it('only lets a finished build go live', () => {
    expect(isActivatableBuild('ready')).toBe(true);
    expect(isActivatableBuild('active')).toBe(true);
    expect(isActivatableBuild('superseded')).toBe(true);
    expect(isActivatableBuild('uploading')).toBe(false);
    expect(isActivatableBuild('failed')).toBe(false);
    expect(isActivatableBuild('rejected')).toBe(false);
  });
});
