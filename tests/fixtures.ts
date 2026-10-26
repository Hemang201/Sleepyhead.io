import type { PublicGame } from '../src/shared/catalogue';

/**
 * Sample records in the exact shape the API returns.
 *
 * These are deliberately named as fixtures: this project ships no games, ships
 * no game data, and the public catalogue is whatever the owner uploads through
 * the dashboard. The test suite therefore describes its own synthetic records
 * rather than reaching into a manifest — the same records `npm run seed`
 * installs on a local machine.
 */

function game(
  overrides: Partial<PublicGame> &
    Pick<PublicGame, 'slug' | 'title' | 'categories' | 'status' | 'shortDescription' | 'description'>,
): PublicGame {
  const { slug, ...rest } = overrides;
  return {
    id: `id-${slug}`,
    slug,
    tags: [],
    featured: false,
    accent: 'cyan',
    releaseDate: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: null,
    updateNotes: null,
    instructions: '',
    controls: {},
    estimatedPlaytime: null,
    artwork: { thumbnail: null, banner: null, screenshots: [], placeholder: true },
    itch: { projectUrl: null, embedUrl: null },
    playable: false,
    playUrl: null,
    path: `/games/${slug}`,
    ...rest,
  };
}

export const sampleGames: PublicGame[] = [
  game({
    slug: 'grid-runner',
    title: 'Grid Runner',
    shortDescription: 'A synthetic published game used by the query tests.',
    description:
      'Grid Runner is a fixture record, never seeded into the public site: a canvas card that loads nested CSS, JavaScript, JSON and image assets. It exists so the query helpers can be tested end to end.',
    categories: ['experimental'],
    tags: ['canvas', 'grid', 'test'],
    status: 'published',
    featured: true,
    accent: 'lime',
    playable: true,
    version: '1.0.0',
    itch: {
      projectUrl: 'https://fixture-studio.itch.io/grid-runner',
      embedUrl: 'https://itch.io/embed-upload/7654321?color=202124',
    },
    playUrl: 'https://itch.io/embed-upload/7654321?color=202124',
    releaseDate: '2026-01-02',
  }),
  game({
    slug: 'announcement-fixture',
    title: 'Announcement Fixture',
    shortDescription: 'A coming-soon placeholder used to check the publication states.',
    description:
      'Announcement Fixture is listed publicly as an announcement. It has no build, so it must never show a Play button.',
    categories: ['puzzle', 'strategy'],
    tags: ['announcement', 'placeholder'],
    status: 'coming-soon',
    featured: true,
    accent: 'blue',
  }),
  game({
    slug: 'unlisted-fixture',
    title: 'Unlisted Fixture',
    shortDescription: 'An in-development placeholder that is deliberately not listed.',
    description:
      'Unlisted Fixture exercises the private preview state: it is in development and the owner has not opted it into any public listing.',
    categories: ['puzzle', 'experimental'],
    tags: ['prototype'],
    status: 'in-development',
    accent: 'violet',
  }),
  game({
    slug: 'unavailable-fixture',
    title: 'Unavailable Fixture',
    shortDescription: 'A temporarily unavailable placeholder that stays listed.',
    description:
      'Unavailable Fixture is listed while playback is disabled, which is the state that must show an explanation instead of a Play button.',
    categories: ['action', 'roguelite'],
    tags: ['rework'],
    status: 'unavailable',
    featured: true,
    accent: 'orange',
  }),
  game({
    slug: 'draft-fixture',
    title: 'Draft Fixture',
    shortDescription: 'A private draft that must never reach the public site.',
    description:
      'Draft Fixture verifies that unpublished rows never leak into the catalogue, search results or the sitemap.',
    categories: ['puzzle', 'narrative'],
    status: 'draft',
    accent: 'pink',
  }),
  game({
    slug: 'archived-fixture',
    title: 'Archived Fixture',
    shortDescription: 'An archived placeholder kept only for administration.',
    description:
      'Archived Fixture is retained in the dashboard and hidden from the public catalogue, whatever its listed flag says.',
    categories: ['horror'],
    tags: ['archive'],
    status: 'archived',
    accent: 'violet',
  }),
];
