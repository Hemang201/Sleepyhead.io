#!/usr/bin/env node
/**
 * Development seed — LOCAL ONLY.
 *
 * Installs neutral fixture records by calling the real admin API, so metadata,
 * artwork and publication state are exercised rather than faked in the database.
 *
 * This script installs **no published games**. The records it creates are
 * administration fixtures named "… Fixture" and cover the unpublished
 * publication states (announcement, unavailable, in development, draft,
 * archived). They exist so the dashboard can be checked; the public catalogue
 * ignores all of them because it only serves published games with a valid
 * itch.io player. The owner's first real game is added through the dashboard.
 *
 * It talks to `wrangler dev` on loopback using the local development owner seam
 * (`DEV_OWNER_SUB` in .dev.vars). That seam is refused unless APP_ORIGIN is a
 * loopback origin, so this script cannot work against a deployed site: the
 * published catalogue is only ever what the owner uploads through the dashboard.
 *
 *   npm run dev:full     # terminal 1
 *   npm run db:migrate   # terminal 2, first run only
 *   npm run seed         # terminal 2
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const API = process.env.API_ORIGIN ?? 'http://127.0.0.1:8787';

/* ------------------------------------------------------------------- setup */

function readDevVars() {
  const path = resolve(process.cwd(), '.dev.vars');
  if (!existsSync(path)) return {};
  const vars = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (match) vars[match[1]] = match[2].trim();
  }
  return vars;
}

const devVars = readDevVars();
const DEV_OWNER = process.env.DEV_OWNER_SUB ?? devVars.DEV_OWNER_SUB ?? '';
const OWNER_PASSWORD = process.env.DEV_OWNER_PASSWORD ?? devVars.DEV_OWNER_PASSWORD ?? '';
const OWNER_EMAIL =
  process.env.OWNER_LOGIN_EMAIL ??
  devVars.OWNER_LOGIN_EMAIL ??
  process.env.OWNER_AUTH_EMAIL ??
  devVars.OWNER_AUTH_EMAIL ??
  devVars.DEV_OWNER_EMAIL ??
  '';
const SETUP_TOKEN = process.env.OWNER_SETUP_TOKEN ?? devVars.OWNER_SETUP_TOKEN ?? '';

if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(API).hostname)) {
  console.error(`Refusing to seed ${API}: the development seed only runs against a local Worker.`);
  process.exit(1);
}
if (!DEV_OWNER) {
  console.error('DEV_OWNER_SUB is not set. Add it to .dev.vars (see docs/DEPLOYMENT.md).');
  process.exit(1);
}

/**
 * The verified session cookie, exactly as a browser would hold it.
 *
 * The dashboard's second factor is not bypassed for convenience here: the seed
 * completes the same challenge/verify flow the owner does. On a loopback origin
 * with the local email catcher the code comes back in the response; anywhere
 * else the flow needs a real mailbox, which is the point.
 */
let sessionCookie = '';

function rememberCookie(response) {
  const raw = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  for (const entry of raw) {
    const pair = entry.split(';')[0];
    if (pair.startsWith('hg_owner_session=')) sessionCookie = pair;
  }
}

async function api(path, init = {}) {
  // The header is only used by the local reset seam; sign-in itself is the real
  // password + emailed code flow, never a short cut.
  const headers = { 'x-dev-owner': DEV_OWNER, ...(init.headers ?? {}) };
  if (sessionCookie) headers.cookie = sessionCookie;

  const response = await fetch(`${API}${path}`, { ...init, headers });
  rememberCookie(response);

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const detail = body && typeof body === 'object' ? (body.message ?? JSON.stringify(body.fields ?? body)) : String(body);
    throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status}: ${detail}`);
  }
  return body;
}

const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function unlockOwner() {
  if (!OWNER_PASSWORD) {
    throw new Error('DEV_OWNER_PASSWORD is not set. Add it to .dev.vars (see docs/DEPLOYMENT.md).');
  }

  // The gate's public session report says whether first-run provisioning is
  // still available. The security detail endpoint requires a verified session,
  // which is exactly what this function is about to create.
  const state = await api('/api/admin/session');
  const needsSetup = state.gate?.mode === 'setup';

  if (needsSetup) {
    if (!OWNER_EMAIL) throw new Error('OWNER_LOGIN_EMAIL is not set. Add it to .dev.vars.');
    if (!SETUP_TOKEN) throw new Error('OWNER_SETUP_TOKEN is not set. Add it to .dev.vars.');
    const challenge = await api('/api/admin/auth/setup', json('POST', {
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      confirm: OWNER_PASSWORD,
      setupToken: SETUP_TOKEN,
    }));
    if (!challenge.localCode) {
      throw new Error('No verification code came back. Set EMAIL_PROVIDER=local in .dev.vars for local development.');
    }
    await api('/api/admin/auth/verify', json('POST', { challengeId: challenge.challengeId, code: challenge.localCode }));
    console.log('• owner security set up (private authentication address + password verified)');
    return;
  }

  const challenge = await api('/api/admin/auth/login', json('POST', { email: OWNER_EMAIL, password: OWNER_PASSWORD }));
  if (!challenge.localCode) {
    throw new Error('No verification code came back. Set EMAIL_PROVIDER=local in .dev.vars for local development.');
  }
  await api('/api/admin/auth/verify', json('POST', { challengeId: challenge.challengeId, code: challenge.localCode }));
}

/**
 * Slugs the verification harness has used for its own temporary game. Both are
 * listed so a leftover from an older run is cleaned up too.
 */
const VERIFICATION_PREFIXES = ['verification-run-', 'verify-build-'];

/* ---------------------------------------------------------------- fixtures */

/**
 * One fixture per unpublished publication state. None of them is playable, so
 * none of them can reach the public catalogue.
 */
const FIXTURES = [
  {
    slug: 'announcement-fixture',
    title: 'Announcement Fixture',
    shortDescription: 'A coming-soon placeholder used to check the publication states.',
    description:
      'Listed publicly as an announcement. It has no build, so it must never show a Play button — that is what this fixture is here to prove.',
    categories: ['puzzle', 'strategy'],
    tags: ['announcement', 'placeholder'],
    instructions: '',
    controls: { keyboard: [], mouse: [], touch: [] },
    estimatedPlaytime: '',
    accent: 'blue',
    status: 'coming-soon',
    featured: true,
    listed: true,
  },
  {
    slug: 'unavailable-fixture',
    title: 'Unavailable Fixture',
    shortDescription: 'A temporarily unavailable placeholder that stays listed.',
    description: 'Listed while playback is disabled: the card stays, the Play button does not.',
    categories: ['action', 'roguelite'],
    tags: ['rework'],
    instructions: '',
    controls: { keyboard: [], mouse: [], touch: [] },
    estimatedPlaytime: '',
    accent: 'orange',
    status: 'unavailable',
    featured: true,
    listed: true,
  },
  {
    slug: 'unlisted-fixture',
    title: 'Unlisted Fixture',
    shortDescription: 'An in-development placeholder that is deliberately not listed.',
    description: 'In development and unlisted: this is the check that unfinished work stays private.',
    categories: ['puzzle', 'experimental'],
    tags: ['prototype'],
    instructions: '',
    controls: { keyboard: [], mouse: [], touch: [] },
    estimatedPlaytime: '',
    accent: 'violet',
    status: 'in-development',
    featured: false,
    listed: false,
  },
  {
    slug: 'draft-fixture',
    title: 'Draft Fixture',
    shortDescription: 'A private draft that must never reach the public site.',
    description: 'Draft state used to verify that unpublished rows never leak into the catalogue.',
    categories: ['puzzle', 'narrative'],
    tags: [],
    instructions: '',
    controls: { keyboard: [], mouse: [], touch: [] },
    estimatedPlaytime: '',
    accent: 'pink',
    status: 'draft',
    featured: false,
    listed: false,
  },
  {
    slug: 'archived-fixture',
    title: 'Archived Fixture',
    shortDescription: 'An archived placeholder kept only for administration.',
    description: 'Archived so it disappears from the public site while staying visible in the dashboard.',
    categories: ['horror'],
    tags: ['archive'],
    instructions: '',
    controls: { keyboard: [], mouse: [], touch: [] },
    estimatedPlaytime: '',
    accent: 'violet',
    status: 'archived',
    featured: false,
    listed: true,
  },
];

/* --------------------------------------------------------------------- main */

async function main() {
  const health = await api('/api/health');
  console.log(`Seeding ${API} (${health.games} games already stored)\n`);

  // Sticky by design: a password lockout lasts fifteen minutes and a resend
  // costs a minute, so clear the local security state first and this script can
  // be re-run whenever. The endpoint only answers the development seam.
  await api('/api/admin/dev/security-reset', { method: 'POST' });

  // The admin API now needs a verified owner session, so the seed signs in the
  // same way the dashboard does: password, then the emailed code.
  await unlockOwner();

  const existing = await api('/api/admin/games');
  const bySlug = new Map(existing.games.map((game) => [game.slug, game]));

  // A verification run that was interrupted leaves its own temporary game
  // behind; those are not fixtures and would skew the next run's counts. Both
  // prefixes are checked: the harness used `verify-build-…` before it was
  // renamed, and those rows are already hidden from the public catalogue by
  // `isFixtureSlug` — this removes them from the local database as well.
  for (const game of existing.games) {
    if (VERIFICATION_PREFIXES.some((prefix) => game.slug.startsWith(prefix))) {
      await api(`/api/admin/games/${game.id}?mode=purge`, { method: 'DELETE' });
      console.log(`• removed leftover verification game ${game.slug}`);
    }
  }

  for (const fixture of FIXTURES) {
    const metadata = {
      title: fixture.title,
      slug: fixture.slug,
      shortDescription: fixture.shortDescription,
      description: fixture.description,
      categories: fixture.categories,
      tags: fixture.tags,
      instructions: fixture.instructions,
      controls: fixture.controls,
      estimatedPlaytime: fixture.estimatedPlaytime,
      accent: fixture.accent,
      status: fixture.status,
      featured: fixture.featured,
      listed: fixture.listed,
    };

    // 1. Ensure the row exists. It always starts as a draft: publishing needs
    //    cover art and both itch.io addresses, which fixtures deliberately lack.
    let record = bySlug.get(fixture.slug);
    if (!record) {
      const created = await api('/api/admin/games', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...metadata, status: 'draft', featured: false, listed: false }),
      });
      record = created.game;
    }

    // 2. Final metadata and publication state. No itch.io player is connected
    //    here: a fixture can never become public, and the first playable game
    //    must be a real one the owner adds through the dashboard.
    await api(`/api/admin/games/${record.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(metadata),
    });

    console.log(`• ${fixture.slug.padEnd(20)} ${fixture.status.padEnd(15)} metadata only`);
  }

  const catalogue = await api('/api/catalogue');
  console.log(`\nPublic catalogue now has ${catalogue.games.length} visible entries:`);
  for (const game of catalogue.games) {
    console.log(`  ${game.playable ? 'play ' : 'info '} ${game.path} — ${game.title} (${game.status})`);
  }
  console.log('\nSeed complete. This data lives in the local development database only — never in production.');
}

main().catch((error) => {
  console.error(`\nSeed failed: ${error.message}`);
  process.exit(1);
});
