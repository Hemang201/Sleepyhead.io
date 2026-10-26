/**
 * End-to-end verification of the running application.
 *
 * Everything is driven through the real interface: the public pages read the
 * catalogue the Worker serves from D1, and the dashboard creates, uploads,
 * publishes and deletes a game through the same endpoints the owner uses.
 *
 * Prerequisites (see docs/VERIFICATION.md):
 *   npm run build            # frontend into dist/
 *   npm run dev:full         # wrangler dev on 127.0.0.1:8787 (D1 + R2 emulated)
 *   npm run db:migrate       # apply the schema to the local database
 *   npm run seed             # install the development fixtures
 *
 *   node scripts/verify.mjs
 *
 * The dashboard is exercised with the local development owner seam (the
 * `x-dev-owner` header from .dev.vars), which the Worker refuses unless
 * APP_ORIGIN is a loopback origin. No production credential is used or needed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

import { createZip } from './lib/zip.mjs';
import { coverArt } from './lib/cover-art.mjs';
import { testBuildFiles } from './lib/test-build.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const BROWSER_PATH =
  process.env.BROWSER_PATH ?? 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const SHOTS = 'verification';

const results = [];
let failures = 0;
const consoleErrors = [];

/* Launched inside main(); held here so the context helper below can reach it. */
let browser;

/**
 * Every context this suite opens marks the opening sequence as skipped.
 *
 * The opening is a timed, animated first-load experience with a hard cap of a
 * few seconds; leaving it in would make every press of Tab and every measured
 * paint depend on how long the card happened to stay up. Its behaviour is
 * proven instead by `npm run audit:design`, which drives it from a clean
 * profile — the checks that matter (does it appear, does it report real steps,
 * does it leave, does it hand over to the typed headline) live there, not here.
 *
 * The same marker is the documented opt-out for anyone who would rather the
 * site went straight to the page.
 */
async function newContext(options) {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem('hg.boot.v1', 'skip');
    } catch {
      /* Storage can be blocked; the opening then simply plays as usual. */
    }
  });
  return context;
}

function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

/**
 * Poll a function until it returns something truthy. Used where the application
 * publishes asynchronously: a fixed `waitForTimeout` would either race or slow
 * the run down for nothing.
 */
async function poll(fn, { timeout = 15000, interval = 200 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      // Keep polling: an API briefly unavailable is not a failed check yet.
    }
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * A small, valid mono WAV, generated here so the music editor is exercised with
 * a real audio file and not a renamed blob. The duration and pitch differ per
 * call, which is what makes a replacement provably a different track.
 */
function toneWav(seconds, frequency = 440) {
  const rate = 8000;
  const samples = Math.round(seconds * rate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin((index / rate) * frequency * Math.PI * 2) * 3000), 44 + index * 2);
  }
  return buffer;
}

function readDevVars() {
  const vars = {};
  if (!existsSync('.dev.vars')) return vars;
  for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (match) vars[match[1]] = match[2].trim();
  }
  return vars;
}

const devVars = readDevVars();
const DEV_OWNER = process.env.DEV_OWNER_SUB ?? devVars.DEV_OWNER_SUB ?? 'dev-owner';
const OWNER_EMAIL =
  process.env.OWNER_LOGIN_EMAIL ??
  devVars.OWNER_LOGIN_EMAIL ??
  process.env.OWNER_AUTH_EMAIL ??
  devVars.OWNER_AUTH_EMAIL ??
  devVars.DEV_OWNER_EMAIL ??
  '';
const OWNER_PASSWORD = process.env.DEV_OWNER_PASSWORD ?? devVars.DEV_OWNER_PASSWORD ?? '';
const SETUP_TOKEN = process.env.OWNER_SETUP_TOKEN ?? devVars.OWNER_SETUP_TOKEN ?? '';
const SECOND_EMAIL = 'owner-verify@example.test';
const ROTATED_PASSWORD = 'Rotated-Owner-77!x';

/**
 * Clears the rate-limit state this run trips on purpose, through the local
 * development seam.
 *
 * Every limit here is derived from stored rows: the resend cooldown from the
 * newest challenge for a purpose, the password lockout from recent failed
 * attempts, the per-hour ceiling from the challenge rows themselves. A step that
 * proves a limit is enforced (a second code inside a minute, a wrong password)
 * would therefore lock out the steps after it, so the harness clears those rows
 * between phases.
 *
 * Two deliberate choices: the signed-in session is kept (`sessions: false`), and
 * the audit trail is kept by default (`events: false`) because the assertions at
 * the end of the run read it. A deployment cannot reach this route at all — the
 * seam needs DEV_OWNER_SUB, a loopback APP_ORIGIN and this header.
 */
async function clearRateLimits(what, { clearAuditTrail = false } = {}) {
  const response = await fetch(`${BASE}/api/admin/dev/security-reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-owner': DEV_OWNER },
    body: JSON.stringify(clearAuditTrail ? { sessions: false } : { sessions: false, events: false }),
  });
  if (response.status !== 200) {
    throw new Error(`the local reset seam refused to clear ${what} (status ${response.status})`);
  }
}

/**
 * Completes the owner's second factor in a real browser.
 *
 * The dashboard is deliberately not reachable with provider identity alone, so
 * every admin check below runs *after* this: password, then the code that was
 * emailed. On a loopback origin the local catcher hands the code back to the
 * page, which is how this harness can finish the flow without a mailbox. The
 * code is never guessed, never hardcoded and never bypassed.
 */
async function completeGate(page) {
  const gate = page.locator('.admin-gate');
  await gate.waitFor({ timeout: 20000 });
  const setupMode = (await page.locator('.admin-gate input[name="setupToken"]').count()) > 0;
  const mode = setupMode ? 'setup' : 'signin';

  await page.fill('.admin-gate input[name="email"]', OWNER_EMAIL);
  await page.fill('.admin-gate input[name="password"]', OWNER_PASSWORD);
  if (setupMode) {
    await page.fill('.admin-gate input[name="confirm"]', OWNER_PASSWORD);
    await page.fill('.admin-gate input[name="setupToken"]', SETUP_TOKEN);
  }
  await page.click('.admin-gate button[type="submit"]');

  await page.waitForSelector('.admin-gate input.input--code', { timeout: 20000 });
  const delivered = await page.locator('.admin-gate .kbd').first().innerText();
  await page.fill('.admin-gate input.input--code', delivered.trim());
  await page.click('.admin-gate button[type="submit"]');
  await page.waitForSelector('.admin-nav', { timeout: 30000 });
  return mode;
}

/** Runs a full password-change cycle: challenge, code, then the new password. */
async function rotatePassword(page, from, to) {
  return page.evaluate(
    async ([current, next]) => {
      const started = await fetch('/api/admin/auth/challenge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purpose: 'password-change', password: current }),
      });
      const challenge = await started.json();
      if (!started.ok) return { step: 'challenge', challenge };

      const verified = await fetch('/api/admin/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeId: challenge.challengeId, code: challenge.localCode ?? '' }),
      });
      if (!verified.ok) return { step: 'verify', response: await verified.json() };

      const changed = await fetch('/api/admin/security/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next, confirm: next }),
      });
      return { step: 'done', status: changed.status, response: await changed.json() };
    },
    [from, to],
  );
}

/** Every game this harness creates carries one of these slug prefixes, so it can
 * find its own leftovers again after a run that crashed before its cleanup. The
 * older `verify-build-…` form is kept so a stale row from an earlier revision is
 * purged rather than merely hidden by the fixture filter. */
const SCRATCH_PREFIXES = ['verification-run-', 'verify-build-'];

/**
 * The one published fixture the public checks run against.
 *
 * It is created through the real admin API at the start of the run, after the
 * empty-state checks, and purged again at the end. Nothing is seeded into the
 * public catalogue: a fresh local install shows the honest empty arcade until
 * the owner uploads a game.
 */
const PUBLIC_FIXTURE_SLUG = 'verification-run-public';

/**
 * The itch.io addresses the public fixture is published with.
 *
 * The project address is a real, well-formed creator URL; the embed id is a
 * synthetic one, because no game of ours lives on itch.io. The player checks
 * fulfil requests for this embed with a local document, which proves the frame
 * wiring (src, permissions, sizing, input, fallback) without pretending to test
 * itch.io itself. The embed id never resolves to a real project.
 */
const FIXTURE_ITCH_PROJECT = 'https://verification-studio.itch.io/verification-build';
const FIXTURE_ITCH_EMBED_ID = '9900015';
const FIXTURE_ITCH_EMBED = `https://itch.io/embed-upload/${FIXTURE_ITCH_EMBED_ID}?color=202124`;

/** The synthetic game itch.io would serve for that embed, used by the player checks. */
const ITCH_FRAME_DOCUMENT = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Verification itch game</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#0b0d16;color:#f2f2f3;font:14px system-ui}
canvas{display:block;width:100%;height:100%}#hud{position:absolute;top:8px;left:8px;z-index:2;background:#000a;padding:6px 10px;border-radius:6px}</style>
</head>
<body>
<div id="hud">
  <span id="status" data-ok="true">itch frame loaded</span>
  <button id="cycle" type="button">cycle</button>
</div>
<canvas id="card" width="640" height="360"></canvas>
<script>
  var canvas = document.getElementById('card');
  var ctx = canvas.getContext('2d');
  var frames = 0;
  function draw() {
    ctx.fillStyle = 'hsl(' + ((frames * 47) % 360) + ' 70% 45%)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '28px system-ui';
    ctx.fillText('itch frame ' + frames, 28, 60);
    document.body.dataset.frames = String(frames);
  }
  document.getElementById('cycle').addEventListener('click', function () { frames += 1; draw(); });
  window.addEventListener('keydown', function (event) { window.__lastKey = event.key; frames += 1; draw(); });
  window.addEventListener('touchstart', function () { window.__touch = 'yes'; }, { passive: true });
  window.__hgAlive = 'yes';
  draw();
</script>
</body></html>`;

/**
 * Makes the run repeatable.
 *
 * Every public check below is written against the seeded fixtures, so a scratch
 * game left behind by a run that crashed part-way would show up as an extra card
 * in the library and an extra search hit. This clears the local security state,
 * signs in, deletes anything carrying the harness slug prefix, and gets out again.
 * The security section deliberately starts from a gate afterwards, so nothing is
 * carried over.
 */
async function clearScratchState(browser) {
  await fetch(`${BASE}/api/admin/dev/security-reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-owner': DEV_OWNER },
    body: JSON.stringify({ authEmail: true }),
  }).catch(() => undefined);

  // The About page and the social links are edited by this run, so they are put
  // back to the shipped defaults first. Without this, a run that crashed after
  // writing but before restoring would leave its own text published, and the
  // next run would compare against the leftovers instead of against the
  // defaults ("drafts stay private" and the published ordering both read the
  // published document). The route is local-development only; see worker/app.ts.
  await fetch(`${BASE}/api/admin/dev/content-reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-owner': DEV_OWNER },
  }).catch(() => undefined);

  // The local owner seam, exactly as the admin section uses it: the cleanup has to
  // sign in the same way the owner does.
  const context = await newContext({
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { 'x-dev-owner': DEV_OWNER },
  });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
    await page
      .locator('.admin-gate')
      .filter({ hasText: /owner (sign-in|setup)/i })
      .waitFor({ timeout: 20000 });
    await completeGate(page);
    return await page.evaluate(async (prefixes) => {
      const list = await fetch('/api/admin/games').then((response) => response.json());
      const stale = (list.games ?? []).filter((game) =>
        prefixes.some((prefix) => String(game.slug).startsWith(prefix)),
      );
      // Purge, not archive: an archived row keeps its slug, so the next run's
      // fixture would collide with the leftover.
      for (const game of stale) await fetch(`/api/admin/games/${game.id}?mode=purge`, { method: 'DELETE' });
      return stale.map((game) => game.slug);
    }, SCRATCH_PREFIXES);
  } finally {
    await context.close();
  }
}

/**
 * Publishes the harness's temporary game through the same endpoints the
 * dashboard uses: create a draft, upload the ZIP, activate it, add artwork,
 * then publish. It runs in a signed-in browser page so the session never has
 * to be reconstructed by hand.
 */
async function createPublicFixture(zipPath, imagePath) {
  await clearRateLimits('the public fixture setup');
  const zip = readFileSync(zipPath).toString('base64');
  const image = readFileSync(imagePath).toString('base64');
  const context = await newContext({
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { 'x-dev-owner': DEV_OWNER },
  });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
    await page
      .locator('.admin-gate')
      .filter({ hasText: /owner (sign-in|setup)/i })
      .waitFor({ timeout: 20000 });
    await completeGate(page);      return await page.evaluate(
      async ([slug, buildB64, artB64, itchProject, itchEmbed]) => {
        const bytes = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
        const json = (method, body) => ({
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });

        const createdResponse = await fetch('/api/admin/games', {
          ...json('POST', {
            title: 'Verification Build',
            slug,
            shortDescription: 'A temporary game created by the verification run.',
            description:
              'A synthetic build with nested CSS, JavaScript, JSON and image assets. It is published only for the duration of the verification run and purged afterwards.',
            categories: ['experimental'],
            tags: ['verification', 'canvas'],
            status: 'draft',
          }),
        });
        const created = await createdResponse.json();
        const id = created?.game?.id;
        if (!id) {
          throw new Error(`could not create the public fixture (${createdResponse.status} ${JSON.stringify(created)})`);
        }

        const buildResponse = await fetch(`/api/admin/games/${id}/builds`, {
          method: 'POST',
          headers: { 'content-type': 'application/zip' },
          body: bytes(buildB64),
        });
        const build = await buildResponse.json();
        if (!build?.build?.id) {
          throw new Error(`could not upload the public fixture build (${buildResponse.status} ${JSON.stringify(build)})`);
        }

        const activated = await fetch(`/api/admin/builds/${build.build.id}/activate`, { method: 'POST' });
        if (!activated.ok) throw new Error('could not activate the public fixture build');

        const art = await fetch(`/api/admin/games/${id}/artwork?kind=thumbnail`, {
          method: 'PUT',
          headers: { 'content-type': 'image/png' },
          body: bytes(artB64),
        });
        if (!art.ok) throw new Error('could not upload the public fixture artwork');

        for (let index = 0; index < 2; index += 1) {
          const screenshot = await fetch(`/api/admin/games/${id}/screenshots`, {
            method: 'POST',
            headers: { 'content-type': 'image/png' },
            body: bytes(artB64),
          });
          if (!screenshot.ok) throw new Error(`could not upload public fixture screenshot ${index}`);
        }

        const published = await fetch(
          `/api/admin/games/${id}`,
          json('PATCH', {
            status: 'published',
            featured: true,
            listed: true,
            itchUrl: itchProject,
            itchEmbedUrl: itchEmbed,
          }),
        );
        if (!published.ok) {
          throw new Error(`could not publish the public fixture (${published.status} ${JSON.stringify(await published.json())})`);
        }
        return id;
      },
      [PUBLIC_FIXTURE_SLUG, zip, image, FIXTURE_ITCH_PROJECT, FIXTURE_ITCH_EMBED],
    );
  } finally {
    await context.close();
  }
}

async function main() {
  if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

  // The browser upload needs real files on disk: a small build archive and an
  // image, both generated from the same fixtures the seed uses.
  const zipPath = `${SHOTS}/fixture-build.zip`;
  const imagePath = `${SHOTS}/fixture-thumbnail.png`;
  if (!existsSync(zipPath)) writeFileSync(zipPath, createZip(testBuildFiles()));
  if (!existsSync(imagePath)) writeFileSync(imagePath, coverArt('verification-thumbnail', { width: 640, height: 400, accent: 'cyan' }));

  // Two different tracks, so replacing one with the other is measurable.
  const trackAPath = `${SHOTS}/fixture-track-a.wav`;
  const trackBPath = `${SHOTS}/fixture-track-b.wav`;
  if (!existsSync(trackAPath)) writeFileSync(trackAPath, toneWav(1.5, 440));
  if (!existsSync(trackBPath)) writeFileSync(trackBPath, toneWav(2.5, 523));
  const trackABytes = readFileSync(trackAPath).byteLength;
  const trackBBytes = readFileSync(trackBPath).byteLength;

  browser = await chromium.launch({
    executablePath: existsSync(BROWSER_PATH) ? BROWSER_PATH : undefined,
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  /* ======================================== a deterministic starting point */

  let leftoverError = null;
  const leftovers = await clearScratchState(browser).catch((error) => {
    leftoverError = error.message;
    return null;
  });
  check(
    'setup: the run starts from the seeded fixtures, with no leftovers',
    leftovers !== null,
    leftovers === null ? leftoverError : `${leftovers.length} removed`,
  );

  /* ==================================================== opening sequence */

  /*
   * The rest of the run opts out of the opening card (see `newContext`) so its
   * timings are deterministic, and `npm run audit:design` drives it in depth —
   * but that audit stops early while the catalogue is empty, which is today's
   * state. So the one thing a visitor always sees on a first visit is proven
   * here, from a clean profile: it appears, it reports real steps, the page
   * behind it is inert, it leaves on its own, and it never comes back on an
   * in-app navigation.
   */
  {
    const bootContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const bootPage = await bootContext.newPage();
    const bootErrors = [];
    bootPage.on('pageerror', (error) => bootErrors.push(error.message));

    await bootPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const appeared = await bootPage
      .waitForSelector('[data-boot]', { timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    const whileUp = appeared
      ? await bootPage.evaluate(() => {
          const boot = document.querySelector('[data-boot]');
          const root = document.getElementById('root');
          const bar = document.querySelector('[data-boot-bar]');
          return {
            steps: Number(boot?.getAttribute('data-boot-step') ?? -1),
            total: Number(boot?.getAttribute('data-boot-total') ?? -1),
            inert: root?.hasAttribute('inert') ?? false,
            live: boot?.getAttribute('aria-live') ?? '',
            role: boot?.getAttribute('role') ?? '',
            greeting: document.querySelector('[data-boot-greeting]')?.textContent?.trim() ?? '',
            bar: bar ? getComputedStyle(bar).transform : '',
          };
        })
      : null;

    check('boot: the opening card appears on a first visit', appeared);
    check(
      'boot: it reports real steps, not an invented percentage',
      whileUp?.total === 3 && whileUp.steps >= 0 && whileUp.steps <= 3,
      `${whileUp?.steps ?? '?'} / ${whileUp?.total ?? '?'}`,
    );
    check('boot: the page behind it is inert while it is up', whileUp?.inert === true);
    check(
      'boot: it is a polite live region carrying a greeting',
      whileUp?.role === 'status' && whileUp.live === 'polite' && (whileUp.greeting.length ?? 0) > 0,
      `${whileUp?.role} · ${whileUp?.live} · “${whileUp?.greeting}”`,
    );

    const left = await bootPage
      .waitForSelector('[data-boot]', { state: 'detached', timeout: 7000 })
      .then(() => true)
      .catch(() => false);
    const afterBoot = await bootPage.evaluate(() => ({
      inert: document.getElementById('root')?.hasAttribute('inert') ?? false,
      hero: Boolean(document.querySelector('.hero')),
    }));
    check('boot: it leaves on its own within the ceiling', left);
    check('boot: the site is interactive once it has gone', afterBoot.inert === false && afterBoot.hero);

    await bootPage.click('.site-nav a:has-text("Games")');
    await bootPage.waitForURL(/\/games$/);
    check('boot: an in-app navigation does not replay it', (await bootPage.locator('[data-boot]').count()) === 0);
    check('boot: nothing threw while it played', bootErrors.length === 0, bootErrors.slice(0, 2).join(' | '));
    await bootContext.close();

    // Reduced motion still gets a card, but a jump cut: it must leave quickly.
    const stillContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const stillPage = await stillContext.newPage();
    await stillPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const stillAppeared = await stillPage
      .waitForSelector('[data-boot]', { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    const stillLeft = await stillPage
      .waitForSelector('[data-boot]', { state: 'detached', timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    check('boot: reduced motion still shows and dismisses the card', stillAppeared && stillLeft, `${stillAppeared ? 'shown' : 'none'} · ${stillLeft ? 'left' : 'stuck'}`);
    await stillContext.close();
  }

  /* ====================================================== empty catalogue */

  // A fresh local install has no published game, and the site has to say so
  // without inventing a card. This runs before the temporary fixture exists.
  const emptyContext = await newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const emptyPage = await emptyContext.newPage();
  await emptyPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await emptyPage.waitForSelector('.arcade-empty', { timeout: 15000 });
  const emptyState = await emptyPage.evaluate(async () => {
    const catalogue = await fetch('/api/catalogue').then((response) => response.json());
    return {
      games: catalogue.games.length,
      cards: document.querySelectorAll('.game-card').length,
      playButtons: Array.from(document.querySelectorAll('button, a')).filter((node) => /play now/i.test(node.textContent ?? '')).length,
      text: document.body.innerText,
      title: document.querySelector('.arcade-empty__title')?.textContent?.trim() ?? '',
      emptyInLibrary: Boolean(document.querySelector('#featured-games .arcade-empty')),
    };
  });
  check('empty: the API returns no published games', emptyState.games === 0, `${emptyState.games} games`);
  check('empty: the featured band shows its deliberate empty state', emptyState.emptyInLibrary, emptyState.title);
  check(
    'empty: no game cards or Play Now buttons are invented',
    emptyState.cards === 0 && emptyState.playButtons === 0,
    `${emptyState.cards} cards, ${emptyState.playButtons} play actions`,
  );
  check(
    'empty: the message matches the intended copy',
    emptyState.title === 'The arcade is getting ready.' && emptyState.text.includes('My first browser game is in development.'),
    emptyState.title,
  );
  check('empty: the removed test game is nowhere on the page', !/pipeline check/i.test(emptyState.text));
  await shot(emptyPage, 'home-empty');
  await emptyContext.close();

  // An empty catalogue and a failed request are different states with
  // different copy. A failure must offer a retry, and must never be dressed up
  // as "nothing published yet".
  const errorContext = await newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const errorPage = await errorContext.newPage();
  await errorPage.route('**/api/catalogue', (route) => route.abort('failed'));
  await errorPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await errorPage.waitForSelector('.page-state--error', { timeout: 15000 });
  const errorState = await errorPage.evaluate(() => ({
    alert: document.querySelector('.page-state--error')?.getAttribute('role') ?? null,
    empty: Boolean(document.querySelector('.arcade-empty')),
    retry: Array.from(document.querySelectorAll('.page-state--error button')).some((node) => /try again/i.test(node.textContent ?? '')),
    text: document.querySelector('.page-state--error')?.innerText ?? '',
  }));
  check(
    'error: a failed catalogue is a distinct, retryable state',
    errorState.alert === 'alert' && !errorState.empty && errorState.retry,
    errorState.text.replace(/\s+/g, ' ').slice(0, 90),
  );
  await errorPage.unroute('**/api/catalogue');
  await errorPage.click('.page-state--error button:has-text("Try again")');
  await errorPage.waitForSelector('.arcade-empty', { timeout: 15000 });
  check('error: retry recovers into the empty state', (await errorPage.locator('.page-state--error').count()) === 0);
  await errorContext.close();

  // From here the public checks need one real published game. It is created by
  // this harness and removed before the run ends.
  await createPublicFixture(zipPath, imagePath);

  /* =========================================================== public site */

  const context = await newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const page = await context.newPage();
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`);
  });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.game-card', { timeout: 15000 });

  const catalogue = await page.evaluate(() => fetch('/api/catalogue').then((response) => response.json()));
  const slugs = catalogue.games.map((game) => game.slug);
  const titles = await page.locator('.game-card__title').allInnerTexts();

  check('catalogue: served by the API, not bundled', catalogue.games.length > 0, `${catalogue.games.length} visible games`);
  check('home: title is unique and descriptive', (await page.title()).includes('Hemang Gupta'));
  check('home: hero headline renders', /small games/i.test(await page.locator('h1').innerText()));
  check('home: featured cards come from the catalogue', titles.length >= 1, titles.slice(0, 3).join(', '));

  /* Motion design, read from computed styles: the hero's supporting content
     arrives in a short stagger, and a card lifts on hover without reflowing the
     page. The animation is CSS with `both` fill, so a stylesheet that never
     loads leaves the content visible rather than hiding it behind a script. */
  // The whole sequence is under a second; sampling after that proves it ends
  // visible rather than parked at the first keyframe.
  await page.waitForTimeout(1200);
  const entrance = await page.evaluate(() => {
    const selectors = ['.hero__eyebrow', '.hero__subhead', '.hero__paragraph', '.hero__actions', '.hero__labels', '.hero__frame', '.hero__aside'];
    const frames = selectors.map((selector) => {
      const node = document.querySelector(selector);
      if (!node) return { selector, missing: true };
      const style = getComputedStyle(node);
      return {
        selector,
        name: style.animationName,
        duration: parseFloat(style.animationDuration),
        delay: style.animationDelay,
        opacity: Number(style.opacity),
      };
    });
    return {
      frames,
      animated: frames.every((frame) => !frame.missing && frame.name !== 'none' && frame.duration > 0.1),
      delays: new Set(frames.map((frame) => frame.delay)).size,
      visible: frames.every((frame) => frame.opacity > 0.99),
    };
  });
  check(
    'hero: the supporting content arrives in a short staggered entrance',
    entrance.animated && entrance.delays >= 3 && entrance.visible,
    `${entrance.frames.filter((frame) => frame.animated !== false && frame.name !== 'none').length} animated · ${entrance.delays} distinct delays · all visible`,
  );

  const card = page.locator('.game-card').first();
  const cardPose = () =>
    card.evaluate((node) => ({
      top: node.offsetTop,
      left: node.offsetLeft,
      transform: getComputedStyle(node).transform,
      shadow: getComputedStyle(node).boxShadow,
      art: getComputedStyle(node.querySelector('.game-card__art')).transform,
    }));
  const cardBefore = await cardPose();
  await card.hover();
  await page.waitForTimeout(340);
  const cardAfter = await cardPose();
  await page.mouse.move(0, 0);
  check(
    'cards: hover lifts the card and eases the artwork without moving layout',
    cardBefore.transform !== cardAfter.transform &&
      cardBefore.art !== cardAfter.art &&
      cardBefore.top === cardAfter.top &&
      cardBefore.left === cardAfter.left &&
      cardBefore.shadow !== cardAfter.shadow,
    `${cardBefore.transform} → ${cardAfter.transform} · layout ${cardBefore.top}/${cardAfter.top}`,
  );
  check(
    'catalogue: published games are listed',
    slugs.includes('verification-run-public'),
    slugs.join(', '),
  );
  check('catalogue: drafts never leak', !slugs.includes('draft-fixture'));
  check('catalogue: unlisted in-development games never leak', !slugs.includes('unlisted-fixture'));
  check('catalogue: archived games never leak, even when listed', !slugs.includes('archived-fixture'));
  check('catalogue: unpublished announcements are not catalogue games', !slugs.includes('announcement-fixture'));
  check(
    'catalogue: every listed game is published and playable',
    catalogue.games.every(
      (game) => game.status === 'published' && game.playable && game.itch?.embedUrl === FIXTURE_ITCH_EMBED,
    ),
  );
  check('home: no horizontal overflow at 1440px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot(page, 'home');

  /* ------------------------------------------------------------- library */

  await page.click('a[href="/games"]');
  await page.waitForURL(/\/games$/);
  await page.waitForSelector('.game-card');

  // The page renders from an asynchronous catalogue fetch, so compare once the
  // grid has reached the size the API reports rather than after the first card
  // has appeared.
  const cardCount = await poll(
    async () => {
      const count = await page.locator('.game-card').count();
      return count === catalogue.games.length ? count : null;
    },
    { timeout: 8000 },
  );
  check(
    'library: every visible game is listed',
    cardCount === catalogue.games.length,
    `${cardCount ?? 0} cards for ${catalogue.games.length} catalogue entries`,
  );

  await page.fill('#library-search', 'verification');
  await page.waitForTimeout(150);
  const pipelineMatches = await page.locator('.game-card').count();
  check('library: search finds a game by title', pipelineMatches === 1, `${pipelineMatches} matches`);
  check('library: search state is shareable in the URL', page.url().includes('q=verification'));

  await page.fill('#library-search', 'nested');
  await page.waitForTimeout(150);
  check('library: search matches the description too', (await page.locator('.game-card').count()) >= 1);

  await page.fill('#library-search', 'canvas');
  await page.waitForTimeout(150);
  check('library: search matches tags', (await page.locator('.game-card').count()) >= 1);

  await page.fill('#library-search', '');
  await page.click('button.chip--selectable:has-text("Experimental")');
  await page.waitForTimeout(150);
  const experimentalCount = await page.locator('.game-card').count();
  check(
    'library: genre filter matches the catalogue',
    experimentalCount === catalogue.games.length,
    `${experimentalCount} experimental games`,
  );
  await page.click('button.chip--selectable:has-text("Experimental")');
  await page.waitForTimeout(150);

  await page.selectOption('#library-sort', 'alphabetical');
  await page.waitForTimeout(150);
  const sortedTitles = await page.locator('.game-card__title').allInnerTexts();
  check(
    'library: sorting applies on top of filtering',
    JSON.stringify(sortedTitles) === JSON.stringify([...sortedTitles].sort((a, b) => a.localeCompare(b))),
  );

  await page.fill('#library-search', 'zzzznothing');
  await page.waitForTimeout(200);
  check('library: empty results explain themselves', (await page.locator('.page-state__title').innerText()).length > 0);
  await shot(page, 'library-empty');

  await page.click('button:has-text("Reset filters")');
  await page.waitForTimeout(200);
  check('library: reset filters restores the full list', (await page.locator('.game-card').count()) === catalogue.games.length);

  // The library keeps its filters in the URL, so going back from a game has to
  // land on the list the reader left — the browser's own history, untouched.
  await page.fill('#library-search', 'verification');
  await page.waitForTimeout(150);
  await page.click('.game-card a');
  await page.waitForURL(/\/games\/verification-run-public$/);
  await page.goBack();
  await page.waitForSelector('.game-card');
  const backState = await page.evaluate(() => ({ url: location.search, value: document.querySelector('#library-search')?.value ?? '' }));
  check(
    'library: going back returns to the filtered list',
    backState.url.includes('q=verification') && backState.value === 'verification' && (await page.locator('.game-card').count()) === 1,
    `${backState.url} with "${backState.value}"`,
  );
  await page.goForward();
  await page.waitForURL(/\/games\/verification-run-public$/);
  await page.waitForSelector('.detail-hero__title', { timeout: 15000 });
  check('library: going forward returns to the game page', (await page.locator('.detail-hero__title').count()) === 1);
  await page.goto(`${BASE}/games`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.game-card');

  /* --------------------------------------------------------------- detail */

  await page.goto(`${BASE}/games/verification-run-public`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.player');
  check(
    'detail: direct navigation works',
    (await page.locator('h1').innerText()).trim().toLowerCase() === 'verification build',
  );
  check('detail: screenshot gallery renders', (await page.locator('.gallery img').count()) >= 1);
  check('detail: metadata panel renders', (await page.locator('.meta-list__row').count()) >= 4);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.player');
  check(
    'detail: survives a browser refresh',
    (await page.locator('h1').innerText()).trim().toLowerCase() === 'verification build',
  );

  await page.goto(`${BASE}/games/announcement-fixture`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.page-state');
  check(
    'detail: an unpublished announcement is not a public page',
    (await page.locator('.page-state__title').innerText()).includes('No game lives at that address'),
  );

  await page.goto(`${BASE}/games/draft-fixture`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.page-state');
  check(
    'detail: a draft is indistinguishable from a missing page',
    (await page.locator('.page-state__title').innerText()).includes('No game lives at that address'),
  );

  /* --------------------------------------------------------------- player */

  // Nothing may reach itch.io until the visitor asks to play: the embed is an
  // external request, and a portfolio page should not phone one out on load.
  let itchRequests = 0;
  page.on('request', (request) => {
    if (request.url().startsWith('https://itch.io/')) itchRequests += 1;
  });

  await page.goto(`${BASE}/games/verification-run-public`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.player');
  const idlePlayer = await page.evaluate(() => ({
    iframes: document.querySelectorAll('.player iframe').length,
    play: Boolean(document.querySelector('.player .btn--primary')),
    itchLink: document.querySelector('.player a[href^="https://verification-studio.itch.io/"]')?.getAttribute('href') ?? null,
  }));
  check(
    'player: nothing is embedded before Play is pressed',
    idlePlayer.iframes === 0 && itchRequests === 0,
    `${idlePlayer.iframes} frame(s), ${itchRequests} itch request(s)`,
  );
  check('player: the idle state offers a Play action', idlePlayer.play);
  check(
    'player: the direct itch.io link is always available',
    idlePlayer.itchLink === FIXTURE_ITCH_PROJECT,
    String(idlePlayer.itchLink),
  );

  // itch.io serves the game; a run cannot depend on a real project, so the embed
  // request is fulfilled with a small document that behaves like one. Everything
  // asserted below is the frame this site builds — src, permissions, sizing,
  // focus and the fallback — not itch.io's own player.
  await page.route('https://itch.io/embed-upload/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: ITCH_FRAME_DOCUMENT }),
  );

  await page.click('.player button:has-text("Play")');
  await page.waitForSelector('.player iframe');
  const embed = await page.evaluate(() => {
    const frame = document.querySelector('.player iframe');
    return {
      src: frame?.getAttribute('src') ?? '',
      title: frame?.getAttribute('title') ?? '',
      sandbox: frame?.getAttribute('sandbox') ?? '',
      allow: frame?.getAttribute('allow') ?? '',
      referrer: frame?.getAttribute('referrerpolicy') ?? '',
      status: document.querySelector('.player__status')?.textContent?.trim() ?? '',
      restart: /restart/i.test(document.querySelector('.player__toolbar')?.textContent ?? ''),
      itchLink: document.querySelector('.player__toolbar a[href^="https://verification-studio.itch.io/"]')?.getAttribute('href') ?? null,
    };
  });
  check('player: the frame points at the saved itch.io embed', embed.src === FIXTURE_ITCH_EMBED, embed.src);
  check(
    'player: the frame has an accessible, specific title',
    embed.title.includes('Verification Build') && /itch\.io/i.test(embed.title),
    embed.title,
  );
  check(
    'player: itch.io runs in its own origin, sandboxed to what a game needs',
    /allow-scripts/.test(embed.sandbox) && /allow-same-origin/.test(embed.sandbox) && !/allow-top-navigation/.test(embed.sandbox),
    embed.sandbox,
  );
  check(
    'player: fullscreen and gamepad are delegated, nothing unrelated',
    /fullscreen/.test(embed.allow) && /gamepad/.test(embed.allow) && !/camera|microphone|geolocation/.test(embed.allow),
    embed.allow,
  );
  check('player: the embed gets no referrer from this site', /strict-origin/.test(embed.referrer), embed.referrer);
  check('player: the toolbar reports that it is running on itch.io', /itch\.io/i.test(embed.status), embed.status);
  check('player: restart and the direct itch.io link stay reachable', embed.restart && embed.itchLink === FIXTURE_ITCH_PROJECT);

  const frame = page.frameLocator('.player iframe');
  await frame.locator('#status[data-ok="true"]').waitFor({ timeout: 15000 });
  check('player: the embedded document loads inside the frame', true);
  await shot(page, 'player');

  /* ------------------------------------- player sizing, input, fullscreen */

  await page.bringToFront();
  await page.evaluate(() => document.querySelector('.player').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  const beforeFrames = Number(await frame.locator('body').getAttribute('data-frames'));
  await frame.locator('#cycle').click();
  const afterFrames = await poll(
    async () => {
      const value = Number(await frame.locator('body').getAttribute('data-frames'));
      return value > beforeFrames ? value : null;
    },
    { timeout: 4000 },
  );
  check(
    'player: a click inside the embedded game reaches it',
    afterFrames !== null,
    `${beforeFrames} → ${afterFrames ?? beforeFrames} frame(s)`,
  );

  await frame.locator('#cycle').focus();
  await page.keyboard.press('ArrowRight');
  const keyed = await poll(() => frame.locator('body').evaluate(() => window.__lastKey ?? null), { timeout: 4000 });
  check('player: keyboard input reaches the embedded game', keyed === 'ArrowRight', String(keyed));

  /* ------------------------------------------------------------ fullscreen */

  const fullscreenButton = page.locator('.player__toolbar button[aria-pressed]');
  check('fullscreen: the player offers a fullscreen control', (await fullscreenButton.count()) === 1);
  await fullscreenButton.click();
  await page.waitForTimeout(600);
  const inFullscreen = await page.evaluate(() => {
    const stage = document.querySelector('.player__stage')?.getBoundingClientRect();
    const button = document.querySelector('.player__toolbar button[aria-pressed]');
    const frameNode = document.querySelector('.player__frame');
    return {
      element: document.fullscreenElement ? String(document.fullscreenElement.className) : null,
      stage: stage ? [Math.round(stage.width), Math.round(stage.height)] : null,
      viewport: [window.innerWidth, window.innerHeight],
      border: frameNode ? getComputedStyle(frameNode).borderTopWidth : null,
      radius: frameNode ? getComputedStyle(frameNode).borderTopLeftRadius : null,
      label: button?.textContent?.trim() ?? '',
      pressed: button?.getAttribute('aria-pressed'),
    };
  });
  check(
    'fullscreen: the play area is what goes fullscreen, not the card around it',
    (inFullscreen.element ?? '').includes('player'),
    String(inFullscreen.element),
  );
  check(
    'fullscreen: the game fills the screen',
    (inFullscreen.stage?.[0] ?? 0) >= inFullscreen.viewport[0] - 2 && (inFullscreen.stage?.[1] ?? 0) > inFullscreen.viewport[1] * 0.8,
    `stage ${inFullscreen.stage?.join('x')} in viewport ${inFullscreen.viewport.join('x')}`,
  );
  check(
    'fullscreen: decoration around the game is dropped',
    inFullscreen.border === '0px' && inFullscreen.radius === '0px',
    `border ${inFullscreen.border} radius ${inFullscreen.radius}`,
  );
  check(
    'fullscreen: the control turns into an exit control',
    /exit fullscreen/i.test(inFullscreen.label) && inFullscreen.pressed === 'true',
    `${inFullscreen.label} aria-pressed=${inFullscreen.pressed}`,
  );
  await shot(page, 'player-fullscreen');

  await page.evaluate(() => {
    window.__escapePrevented = null;
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') window.__escapePrevented = event.defaultPrevented;
    });
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const escapePrevented = await page.evaluate(() => window.__escapePrevented);
  check('fullscreen: nothing in the page swallows the Escape key', escapePrevented === false, String(escapePrevented));

  const stillFullscreen = await page.evaluate(() => Boolean(document.fullscreenElement));
  if (stillFullscreen) await fullscreenButton.click();
  await page.waitForTimeout(500);
  const afterExit = await page.evaluate(() => {
    const button = document.querySelector('.player__toolbar button[aria-pressed]');
    const stage = document.querySelector('.player__stage')?.getBoundingClientRect();
    return {
      fullscreen: Boolean(document.fullscreenElement),
      label: button?.textContent?.trim() ?? '',
      pressed: button?.getAttribute('aria-pressed'),
      stage: stage ? [Math.round(stage.width), Math.round(stage.height)] : null,
    };
  });
  check(
    'fullscreen: leaving it restores the page layout',
    afterExit.fullscreen === false && !/exit/i.test(afterExit.label) && afterExit.pressed === 'false' && (afterExit.stage?.[1] ?? 0) < 700,
    `${afterExit.label} stage ${afterExit.stage?.join('x')}`,
  );

  await page.setViewportSize({ width: 1440, height: 900 });

  // A resize reflows the frame; it must not reload the game. The marker only
  // survives while the same cross-origin document stays mounted.
  const gameFrame = page.frames().find((candidate) => candidate.url().includes(`/embed-upload/${FIXTURE_ITCH_EMBED_ID}`));
  if (!gameFrame) throw new Error('the itch.io frame is not mounted');
  await gameFrame.evaluate(() => {
    window.__hgAlive = 'yes';
  });

  for (const size of [
    { width: 1100, height: 820 },
    { width: 1366, height: 768 },
  ]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(500);
    const inner = await gameFrame.evaluate(() => ({
      alive: window.__hgAlive ?? null,
      inner: [window.innerWidth, window.innerHeight],
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    const stage = await page.evaluate(() => {
      const rect = document.querySelector('.player__stage').getBoundingClientRect();
      return [Math.round(rect.width), Math.round(rect.height)];
    });
    const label = `${size.width}×${size.height}`;
    check(`player: resizing to ${label} does not reload the game`, inner.alive === 'yes', String(inner.alive));
    check(
      `player: the game frame follows the stage at ${label}`,
      Math.abs(inner.inner[0] - stage[0]) <= 2 && Math.abs(inner.inner[1] - stage[1]) <= 2,
      `frame viewport ${inner.inner.join('x')} in stage ${stage.join('x')}`,
    );
    check(
      `player: the game does not overflow its frame at ${label}`,
      inner.scrollWidth <= inner.clientWidth + 1,
      `${inner.scrollWidth}px of ${inner.clientWidth}px`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot(page, 'player-resized');

  // An embed that never arrives has to explain itself and offer itch.io — never
  // sit behind a spinner forever. The failure is produced by refusing the embed
  // request, so the real slow path runs against the real component.
  const brokenPage = await context.newPage();
  // A stalled request, not a refused one: a refused frame still fires `load`,
  // and a cross-origin frame cannot be inspected to tell an error page from a
  // game. The component's answer to that is the always-visible itch.io link;
  // this path checks the timeout for an embed that never arrives at all.
  await brokenPage.route('https://itch.io/embed-upload/**', (route) => {
    setTimeout(() => void route.abort('failed').catch(() => undefined), 24000);
  });
  await brokenPage.goto(`${BASE}/games/verification-run-public`, { waitUntil: 'domcontentloaded' });
  await brokenPage.locator('.player .btn--primary', { hasText: 'Play' }).first().click();
  await brokenPage.waitForSelector('.player__fallback', { timeout: 26000 });
  const failure = await brokenPage.evaluate(() => {
    const fallback = document.querySelector('.player__fallback');
    const buttons = Array.from(fallback?.querySelectorAll('button, a') ?? []).map((node) => node.textContent?.trim() ?? '');
    const link = fallback?.querySelector('a[href^="https://verification-studio.itch.io/"]');
    return {
      role: fallback?.getAttribute('role'),
      text: fallback?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      buttons,
      href: link?.getAttribute('href') ?? null,
      spinner: document.querySelectorAll('.player__spinner').length,
    };
  });
  check(
    'player: an embed that never arrives shows an explanation',
    failure.role === 'alert' && failure.spinner === 0,
    `role ${failure.role}, ${failure.spinner} spinner(s)`,
  );
  check('player: the fallback says what may have gone wrong', /refused the embed|private|HTML5/i.test(failure.text), failure.text.slice(0, 120));
  check(
    'player: the fallback offers itch.io, a retry and a report',
    /play on itch\.io/i.test(failure.buttons.join(' ')) &&
      /try again/i.test(failure.buttons.join(' ')) &&
      /report a problem/i.test(failure.buttons.join(' ')),
    failure.buttons.join(' · '),
  );
  check('player: the fallback links to the real project', failure.href === FIXTURE_ITCH_PROJECT, String(failure.href));
  await shot(brokenPage, 'player-fallback');

  await brokenPage.unroute('https://itch.io/embed-upload/**');
  await brokenPage.route('https://itch.io/embed-upload/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: ITCH_FRAME_DOCUMENT }),
  );
  await brokenPage.locator('.player__fallback button', { hasText: 'Try again' }).click();
  await brokenPage.frameLocator('.player iframe').locator('#status[data-ok="true"]').waitFor({ timeout: 15000 });
  check('player: Try again reloads the embed and recovers', true);
  await brokenPage.close();

  /* ------------------------------------------------- game detail layout */

  await page.goto(`${BASE}/games/verification-run-public`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.detail-hero');
  const detail = await page.evaluate(() => {
    const box = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: Math.round(rect.left), w: Math.round(rect.width) };
    };
    // A second container on the same page, so "uses the container" is measured
    // against something rather than against itself.
    const container = document.querySelector('.detail-layout').getBoundingClientRect();
    return {
      heroColumns: getComputedStyle(document.querySelector('.detail-hero')).gridTemplateColumns.split(' ').length,
      detailsColumns: getComputedStyle(document.querySelector('.details')).gridTemplateColumns,
      containerWidth: Math.round(container.width),
      hero: box('.detail-hero'),
      text: box('.details > *'),
      art: box('.detail-hero__art'),
      player: box('.player'),
      aside: box('.detail-aside'),
      viewport: window.innerWidth,
    };
  });
  check('layout: the hero is one column, with the split inside it', detail.heroColumns === 1 && detail.detailsColumns.split(' ').length === 2, `hero ${detail.heroColumns} col, details "${detail.detailsColumns}"`);
  check(
    'layout: text and key art sit side by side, art to the right',
    (detail.art?.x ?? 0) > (detail.text?.x ?? 0) && (detail.art?.x ?? 0) > 600,
    `text x${detail.text?.x} art x${detail.art?.x}`,
  );
  check(
    'layout: the content uses the container instead of one narrow column',
    Math.abs((detail.hero?.w ?? 0) - detail.containerWidth) <= 1 && detail.containerWidth > detail.viewport * 0.7,
    `hero ${detail.hero?.w}px in a ${detail.containerWidth}px container`,
  );
  check(
    'layout: the player gets the wider column and the metadata the narrower one',
    (detail.player?.w ?? 0) > (detail.aside?.w ?? 0),
    `player ${detail.player?.w}px, aside ${detail.aside?.w}px`,
  );
  await shot(page, 'game-detail-desktop');

  /* ------------------------------------------------ responsive viewports */

  // Widths the repair brief lists, plus 911 and 1536 as the CSS-pixel equivalents
  // of browser zoom (1366px at 150% and 1920px at 125%): Chromium maps zoom onto
  // a smaller layout viewport, which is exactly what this sweep varies.
  const SWEEP_WIDTHS = [320, 375, 390, 768, 911, 1024, 1366, 1536, 1920];
  const SWEEP_ROUTES = ['/', '/games', '/games/verification-run-public', '/about', '/privacy'];
  for (const width of SWEEP_WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const overflowing = [];
    for (const route of SWEEP_ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.page, main');
      await page.waitForTimeout(80);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) overflowing.push(`${route} +${overflow}px`);
    }
    check(
      `responsive: no horizontal overflow at ${width}px (${SWEEP_ROUTES.length} routes)`,
      overflowing.length === 0,
      overflowing.join(', '),
    );
  }

  /* The header is the one bar that has to survive every phone width: wordmark,
     search, music, volume, theme and menu in a single row. These are the widths
     the brief names, measured as boxes rather than trusted from the stylesheet:
     every control inside the inner container, none overlapping its neighbour,
     and no horizontal overflow. */
  for (const width of [360, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.site-header__inner');
    await page.waitForSelector('.header-actions');
    const bar = await page.evaluate(() => {
      const inner = document.querySelector('.site-header__inner');
      const actions = document.querySelector('.header-actions');
      const wordmark = document.querySelector('.wordmark')?.getBoundingClientRect();
      const innerBox = inner.getBoundingClientRect();
      const actionsBox = actions.getBoundingClientRect();
      const controls = Array.from(actions.children).filter((node) => {
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && node.getBoundingClientRect().width > 0;
      });
      const boxes = controls.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          label: node.getAttribute('aria-label') || node.className.split(' ')[0],
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      });
      const overlaps = [];
      for (let a = 0; a < boxes.length; a += 1) {
        for (let b = a + 1; b < boxes.length; b += 1) {
          const overlapX = Math.min(boxes[a].right, boxes[b].right) - Math.max(boxes[a].left, boxes[b].left);
          const overlapY = Math.min(boxes[a].bottom, boxes[b].bottom) - Math.max(boxes[a].top, boxes[b].top);
          if (overlapX > 0.5 && overlapY > 0.5) overlaps.push(`${boxes[a].label} × ${boxes[b].label}`);
        }
      }
      const musicToggle = actions.querySelector('.music-toggle');
      const volume = actions.querySelector('.music-volume');
      const musicVisible = Boolean(musicToggle) && getComputedStyle(musicToggle).display !== 'none';
      const volumeVisible = Boolean(volume) && getComputedStyle(volume).display !== 'none';
      return {
        count: boxes.length,
        inside: boxes.every((box) => box.left >= innerBox.left - 1 && box.right <= innerBox.right + 1),
        inBar: boxes.every((box) => box.top >= innerBox.top - 1 && box.bottom <= innerBox.bottom + 1),
        wordmarkClear: !wordmark || wordmark.right <= actionsBox.left + 1,
        overlaps,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        /* Below the phone breakpoint the music pair lives in the menu instead
           (checked in the mobile section), so the header is only required to
           present it as a pair — never one control without the other. */
        musicPair: musicVisible === volumeVisible,
        theme: Boolean(actions.querySelector('.theme-pill')) && getComputedStyle(actions.querySelector('.theme-pill')).display !== 'none',
      };
    });
    check(
      `header: every control fits without overlapping at ${width}px`,
      bar.count >= 2 &&
        bar.inside &&
        bar.inBar &&
        bar.wordmarkClear &&
        bar.overlaps.length === 0 &&
        bar.overflow <= 0 &&
        bar.musicPair &&
        bar.theme,
      `${bar.count} controls · overflow ${bar.overflow}px${bar.overlaps.length ? ` · overlap ${bar.overlaps.join(', ')}` : ''}`,
    );
  }

  // Phone in landscape: the shortest viewport the site has to survive.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(`${BASE}/games/verification-run-public`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.player');
  await page.waitForTimeout(150);
  const landscape = await page.evaluate(() => {
    const frame = document.querySelector('.player__frame').getBoundingClientRect();
    const target = document.querySelector('.detail-hero__actions a.btn--primary')?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      frameHeight: Math.round(frame.height),
      tapTarget: target ? Math.round(target.height) : 0,
    };
  });
  check(
    'responsive: a phone in landscape keeps the player usable',
    landscape.overflow <= 0 && landscape.frameHeight >= 240 && landscape.frameHeight <= 520,
    `overflow ${landscape.overflow}px, frame ${landscape.frameHeight}px`,
  );
  check('responsive: the primary action is a comfortable tap target', landscape.tapTarget >= 44, `${landscape.tapTarget}px`);

  // Portrait phone, game running: every control a thumb has to find — Play, the
  // toolbar's Restart / Mute / Fullscreen — measured where a player actually
  // taps them. "Comfortably tappable" is the 44px floor, not the desktop size.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/games/verification-run-public`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.player');
  const phonePlay = await page.evaluate(() => {
    const button = document.querySelector('.player__placeholder .btn--primary');
    const rect = button?.getBoundingClientRect();
    return rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null;
  });
  check(
    'mobile: the Play control is a comfortable tap target',
    Boolean(phonePlay) && phonePlay.height >= 44 && phonePlay.width >= 44,
    phonePlay ? `${phonePlay.width}x${phonePlay.height}` : 'no Play control',
  );
  await page.click('.player__placeholder .btn--primary');
  await page.waitForSelector('.player iframe');
  const toolbar = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.player__toolbar button')).map((button) => {
      const rect = button.getBoundingClientRect();
      return { label: (button.textContent ?? button.getAttribute('aria-label') ?? '').trim().slice(0, 20), height: Math.round(rect.height), width: Math.round(rect.width) };
    }),
  );
  // (Mute only appears when the build reports it, so the toolbar is Restart +
  // Fullscreen for most builds; both have to be tappable regardless.)
  const toolbarNames = toolbar.map((control) => control.label.toLowerCase()).join(' ');
  check(
    'mobile: every player toolbar control is tappable',
    toolbar.length >= 2 &&
      /restart/.test(toolbarNames) &&
      /fullscreen/.test(toolbarNames) &&
      toolbar.every((control) => control.height >= 44 && control.width >= 44),
    toolbar.map((control) => `${control.label} ${control.width}x${control.height}`).join(' · '),
  );
  await shot(page, 'player-mobile-toolbar');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/games/verification-run-public`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.player__frame');

  /* ------------------------------------------------------- API boundaries */

  const anonymous = await page.evaluate(async () => {
    const admin = await fetch('/api/admin/games');
    const unknown = await fetch('/api/nope');
    const draft = await fetch('/api/catalogue/draft-fixture');
    const build = await fetch('/play/draft-fixture/');
    return {
      admin: admin.status,
      unknown: unknown.status,
      unknownBody: await unknown.text(),
      draft: draft.status,
      build: build.status,
    };
  });
  check('api: admin endpoints reject anonymous users', anonymous.admin === 401, `status ${anonymous.admin}`);
  check('api: unknown endpoints answer JSON, not the SPA', anonymous.unknown === 404 && anonymous.unknownBody.includes('not_found'));
  check('api: unpublished games are not readable', anonymous.draft === 404);
  check('api: unpublished builds are not downloadable', anonymous.build === 404);

  const traversal = await page.evaluate(async () => {
    // Encoded traversal reaches the Worker as written; the plain `../` form is
    // normalised away by the browser before it is ever sent. Both must fail to
    // hand back anything outside the build.
    const encoded = await Promise.all([
      fetch('/play/verification-run-public/%2e%2e%2f%2e%2e%2fwrangler.jsonc'),
      fetch('/play/verification-run-public/..%2f..%2fpackage.json'),
      fetch('/play/verification-run-public/engine.php'),
    ]);
    const normalised = await fetch('/play/verification-run-public/../../wrangler.jsonc');
    const normalisedBody = await normalised.text();
    return {
      statuses: encoded.map((response) => response.status),
      leakedConfig: /compilation|compatibility_date|d1_databases/.test(normalisedBody),
    };
  });
  check('api: encoded path traversal is refused', traversal.statuses.every((status) => status >= 400), traversal.statuses.join(', '));
  check('api: the build route never serves project files', !traversal.leakedConfig);

  // A malformed escape is a bad request, not an unhandled URIError: both public
  // routes that percent-decode a segment have to answer JSON with a 400.
  const malformed = await page.evaluate(async () => {
    const statuses = await Promise.all(
      ['/api/catalogue/%', '/play/%/'].map((path) => fetch(path).then((response) => response.status)),
    );
    return statuses;
  });
  check(
    'api: a malformed URL segment is a 400, not a 500',
    malformed.every((status) => status === 400),
    malformed.join(', '),
  );

  // The catalogue advertises revalidation, so its identity has to come from the
  // data. A timestamp taken from the clock made every ETag unique and turned
  // every repeat request into a full body.
  const revalidation = await page.evaluate(async () => {
    const first = await fetch('/api/catalogue');
    const etag = first.headers.get('etag');
    const repeat = await fetch('/api/catalogue');
    const conditional = await fetch('/api/catalogue', { headers: { 'if-none-match': etag ?? '' } });
    return { etag, repeatEtag: repeat.headers.get('etag'), status: conditional.status };
  });
  check(
    'cache: the catalogue has a stable ETag across requests',
    Boolean(revalidation.etag) && revalidation.etag === revalidation.repeatEtag,
    `${revalidation.etag} vs ${revalidation.repeatEtag}`,
  );
  check('cache: an unchanged catalogue answers 304', revalidation.status === 304, `status ${revalidation.status}`);

  /* ------------------------------------------------------------ sitemap */

  const sitemap = await page.evaluate(() => fetch('/sitemap.xml').then((response) => response.text()));
  check('seo: sitemap lists published game pages only', sitemap.includes('/games/verification-run-public') && !sitemap.includes('draft-fixture'));

  /* --------------------------------------------------- theme + privacy */

  const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme);

   /* Every option in the theme group is a real button, so each one is selected
      directly rather than cycled. The product has two coherent paper palettes:
      warm ivory and neutral graphite. */
  const themeChoices = await page.locator('.theme-pill button').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label')),
  );
   check('theme: both paper palettes are offered', themeChoices.length === 2, themeChoices.join(', '));

   await page.click('button[aria-label="Dark theme"]');
  /* The sheet cross-fades between palettes (body has a background-color
     transition), so the assertion waits for it to settle rather than sampling
     the first frame of the fade. */
  await page.waitForTimeout(420);
   const darkTheme = await page.evaluate(() => {
     const body = getComputedStyle(document.body);
     const [r, g, b] = body.backgroundColor.match(/\d+/g).map(Number);
     return {
       theme: document.documentElement.dataset.theme,
       bg: body.backgroundColor,
       /* Neutral means the three channels sit within a few units of each
          other; a green-dominant sheet (g above both r and b) is the olive
          cast the redesign removed. */
       spread: Math.max(r, g, b) - Math.min(r, g, b),
       greenDominant: g > r && g > b,
       black: r === 0 && g === 0 && b === 0,
     };
   });
   check(
     'theme: dark is a neutral grey sheet, not green or olive',
     darkTheme.theme === 'dark' && darkTheme.spread <= 6 && !darkTheme.greenDominant && !darkTheme.black,
     `${darkTheme.theme} · ${darkTheme.bg} · channel spread ${darkTheme.spread}`,
   );
   /* A neutral sheet is not enough: the cards, the header, the inputs and the
      buttons all have their own fills. Every near-grey fill on the page is
      sampled — pastel accent blocks are excluded by their channel spread, since
      those are meant to be colour, not surface. A green-dominant grey fails. */
   const publicSurfaces = await page.evaluate(() => {
     const selectors = ['body', '.site-header', '.site-footer', '.panel', '.game-card', '.callout', 'input', 'textarea', '.btn', '.site-nav', '.search-trigger'];
     const rows = [];
     for (const selector of selectors) {
       for (const node of document.querySelectorAll(selector)) {
         const box = node.getBoundingClientRect();
         if (box.width * box.height < 1500) continue;
         const style = getComputedStyle(node);
         const values = /rgba?\(([^)]+)\)/.exec(style.backgroundColor)?.[1].split(',').map(Number);
         if (!values) continue;
         const [r, g, b, alpha = 1] = values;
         const spread = Math.max(r, g, b) - Math.min(r, g, b);
         if (alpha < 0.5 || spread > 14) continue;
         rows.push({ selector, color: style.backgroundColor, spread, green: g > r + 2 && g > b + 2 });
       }
     }
     return rows;
   });
   const publicTinted = publicSurfaces.filter((row) => row.green);
   check(
     'theme: every neutral surface in dark mode is grey, not green',
     publicSurfaces.length >= 4 && publicTinted.length === 0,
     `${publicSurfaces.length} surfaces · ${[...new Set(publicSurfaces.map((row) => `${row.selector} ${row.color}`))].slice(0, 4).join(' · ')}${publicTinted.length ? ` · tinted: ${publicTinted.map((row) => row.selector).join(', ')}` : ''}`,
   );

   await page.reload({ waitUntil: 'domcontentloaded' });
   check('theme: dark survives a reload', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');

  await page.click('button[aria-label="Light theme"]');
  // Same cross-fade as the dark choice: sample the surface once it has settled.
  await page.waitForTimeout(420);
  const lightTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  check('theme: another option can be chosen after a reload', lightTheme === 'light', lightTheme);

  // The earlier version compared the result with the palette the fresh browser
  // profile happened to start on, so it failed whenever that was already light.
  // What matters is that the sheet really is the ivory paper and that the two
  // palettes resolve to different surfaces.
  const lightSurface = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const [r, g, b] = body.backgroundColor.match(/\d+/g).map(Number);
    return { bg: body.backgroundColor, warm: r >= g && g >= b, white: r === 255 && g === 255 && b === 255 };
  });
  check(
    'theme: light is a warm ivory sheet, not white',
    lightSurface.warm && !lightSurface.white,
    lightSurface.bg,
  );
  check('theme: the two palettes resolve to different surfaces', lightSurface.bg !== darkTheme.bg, `${darkTheme.bg} → ${lightSurface.bg}`);

  await page.click('button[aria-label="Dark theme"]');
  await page.waitForTimeout(420);
  const roundTrip = await page.evaluate(() => document.documentElement.dataset.theme);
  check('theme: switching back to dark needs no reload', roundTrip === 'dark', `${initialTheme} → dark → light → ${roundTrip}`);
  await page.click('button[aria-label="Light theme"]');
  await page.waitForTimeout(300);

  // The control itself: two equal square targets inside one frame, the same
  // height and centre line as the search field beside it, and a selected state
  // that is a real fill rather than a slightly different grey.
  const control = await page.evaluate(() => {
    const pills = Array.from(document.querySelectorAll('.theme-pill__half'));
    const rects = pills.map((node) => node.getBoundingClientRect());
    const active = pills.find((node) => node.getAttribute('aria-pressed') === 'true');
    const idle = pills.find((node) => node.getAttribute('aria-pressed') === 'false');
    const pillBox = document.querySelector('.theme-pill')?.getBoundingClientRect();
    const searchBox = document.querySelector('.search-trigger')?.getBoundingClientRect();
    const fill = (node) => (node ? getComputedStyle(node).backgroundColor : '');
    return {
      count: pills.length,
      equal:
        rects.length === 2 &&
        Math.abs(rects[0].width - rects[1].width) < 0.5 &&
        Math.abs(rects[0].height - rects[1].height) < 0.5,
      size: rects[0] ? `${Math.round(rects[0].width)}×${Math.round(rects[0].height)}` : 'none',
      aligned: Boolean(
        pillBox &&
          searchBox &&
          Math.abs(pillBox.height - searchBox.height) < 1 &&
          Math.abs(pillBox.top + pillBox.height / 2 - (searchBox.top + searchBox.height / 2)) < 1,
      ),
      activeFill: fill(active),
      idleFill: fill(idle),
      activeLabel: active?.getAttribute('aria-label') ?? '',
      tooltip: active?.getAttribute('title') ?? '',
    };
  });
  check('theme: both options are identically sized targets', control.count === 2 && control.equal, control.size);
  check('theme: the control sits on the search field\'s baseline', control.aligned, 'same height and centre');
  check(
    'theme: the selected option is a real fill, not a tint',
    control.activeFill !== control.idleFill && !/rgba\(0, 0, 0, 0\)/.test(control.activeFill),
    `${control.idleFill} → ${control.activeFill}`,
  );
  check(
    'theme: each option is labelled and tooltipped',
    /theme/i.test(control.activeLabel) && /mode/i.test(control.tooltip),
    `${control.activeLabel} · ${control.tooltip}`,
  );

  // A first visit has no stored choice: the operating system decides, and the
  // inline script has already applied it before React runs.
  const systemContext = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 900 } });
  const systemPage = await systemContext.newPage();
  await systemPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const firstVisitTheme = await systemPage.evaluate(() => document.documentElement.dataset.theme);
  await systemContext.close();
  check('theme: a first visit follows the operating system', firstVisitTheme === 'dark', firstVisitTheme);

  const banner = page.locator('.cookie-banner');
  if ((await banner.count()) > 0) {
    await banner.locator('button').first().click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    check('privacy: dismissing the banner persists', (await page.locator('.cookie-banner').count()) === 0);
  } else {
    check('privacy: banner already dismissed for this profile', true);
  }

  /* --------------------------------------------------------- accessibility */

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.game-card');
  await page.keyboard.press('Tab');
  check(
    'a11y: skip-to-content link is the first tab stop',
    await page.evaluate(() => document.activeElement?.classList.contains('skip-link')),
  );
  await page.keyboard.press('Enter');
  check('a11y: skip link moves focus to main', (await page.evaluate(() => document.activeElement?.id)) === 'main');

  // The player's controls are reached with the keyboard, so they have to show
  // where the focus is. Tabbed to (not focused programmatically) on purpose:
  // that is what makes `:focus-visible` apply in the first place.
  await page.goto(`${BASE}/games/verification-run-public`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.player');
  await page.click('.player__placeholder .btn--primary');
  await page.waitForSelector('.player__toolbar');
  let reachedControl = false;
  for (let press = 0; press < 60 && !reachedControl; press += 1) {
    await page.keyboard.press('Tab');
    reachedControl = await page.evaluate(() => document.activeElement?.matches('.player__toolbar button') ?? false);
  }
  const focusRing = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return { outline: `${style.outlineStyle} ${style.outlineWidth}`, shadow: style.boxShadow, label: document.activeElement?.textContent?.trim() ?? '' };
  });
  check(
    'a11y: the player controls show a visible keyboard focus',
    reachedControl && (/solid|dashed|double/.test(focusRing.outline) || focusRing.shadow !== 'none'),
    `${focusRing.label || 'no control'}: outline ${focusRing.outline}`,
  );

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.game-card');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.game-card');
  const frozenAt = () =>
    page.evaluate(() => {
      const shape = document.querySelector('.deco-field .deco');
      return shape ? getComputedStyle(shape).transform : 'none';
    });
  const frozenStart = await frozenAt();
  await page.waitForTimeout(600);
  const frozenEnd = await frozenAt();
  check(
    'a11y: decorative animation stops under prefers-reduced-motion',
    frozenStart !== 'none' && frozenStart === frozenEnd,
    frozenStart === frozenEnd ? 'marks are still' : 'a mark moved',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  /* ---------------------------------------------------------------- mobile */

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.game-card');
  check('mobile: no horizontal overflow at 390px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.click('.site-nav__toggle');
  await page.waitForSelector('#hg-mobile-menu');
  check('mobile: menu reports its expanded state', (await page.getAttribute('.site-nav__toggle', 'aria-expanded')) === 'true');
  const menuControls = await page.evaluate(() => ({
    music: Boolean(document.querySelector('#hg-mobile-menu .music-toggle--wide')),
    volume: Boolean(document.querySelector('#hg-mobile-menu .music-volume--wide .music-volume__range')),
    theme: Boolean(document.querySelector('#hg-mobile-menu .theme-pill')),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }));
  check(
    'mobile: the menu carries the music, volume and theme controls',
    menuControls.music && menuControls.volume && menuControls.theme && menuControls.overflow <= 0,
    `music ${menuControls.music} · volume ${menuControls.volume} · theme ${menuControls.theme} · overflow ${menuControls.overflow}px`,
  );
  await page.keyboard.press('Escape');
  await page.waitForSelector('#hg-mobile-menu', { state: 'detached' });
  check('mobile: Escape closes the menu', true);
  await page.click('.site-nav__toggle');
  await page.waitForSelector('#hg-mobile-menu');
  await page.click('#hg-mobile-menu a[href="/games"]');
  await page.waitForURL(/\/games$/);
  check('mobile: navigating from the menu closes it', (await page.locator('#hg-mobile-menu').count()) === 0);
  await shot(page, 'mobile-library');

  await context.close();

  /* =================================================== admin (owner only) */

  // The rate limits this run verifies are deliberately sticky — a password
  // lockout lasts fifteen minutes, a resend costs a minute — so a second run
  // would otherwise start locked out. Clear the local security state through
  // the development seam; a deployment cannot reach that endpoint.
  const resetResponse = await fetch(`${BASE}/api/admin/dev/security-reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-owner': DEV_OWNER },
    // The whole reset, plus "point verification back at the configured
    // authentication address": a run that ended early can leave it on the
    // temporary address this harness uses, and a repeatable run has to start from
    // the address the operator configured. `uploads` clears the build-upload
    // budget this run is about to spend (four uploads per run, 40 an hour), so a
    // second run inside the hour is not throttled.
    body: JSON.stringify({ authEmail: true, uploads: true }),
  });
  const reset = { status: resetResponse.status, body: await resetResponse.json().catch(() => ({})) };
  check('security: the local reset seam clears stored state', reset.status === 200, `status ${reset.status}`);
  check(
    'separation: the run starts from the configured authentication address',
    reset.body.cleared?.authEmail === 'restored' || reset.body.cleared?.authEmail === 'already-configured',
    String(reset.body.cleared?.authEmail),
  );

  const gateContext = await newContext({ viewport: { width: 1440, height: 900 } });
  const gatePage = await gateContext.newPage();
  await gatePage.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  // The gate renders twice: first while the session is checked, then with the
  // verdict. Wait for the verdict, not just the container.
  const gate = gatePage.locator('.admin-gate').filter({ hasText: /owner (sign-in|setup)/i });
  await gate.waitFor({ timeout: 20000 });
  // Headings are uppercased by CSS, so compare case-insensitively.
  check('admin: a visitor who is not signed in sees the owner gate', /owner (sign-in|setup)/i.test(await gate.innerText()));
  check(
    'admin: the gate is the app\u2019s own password + email-code form',
    (await gatePage.locator('.admin-gate input[name="email"]').count()) === 1 &&
      (await gatePage.locator('.admin-gate input[name="password"]').count()) === 1,
  );
  check(
    'admin: there is no third-party sign-in anywhere on the gate',
    (await gatePage.locator('.admin-gate a[href*="/auth/"], .admin-gate a[href*="freebuff"]').count()) === 0,
  );
  check('admin: the dashboard itself is not rendered', (await gatePage.locator('.admin-nav').count()) === 0);
  await shot(gatePage, 'admin-gate');
  await gateContext.close();

  // The local development owner seam: an explicit header plus a loopback origin.
  const adminContext = await newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
    extraHTTPHeaders: { 'x-dev-owner': DEV_OWNER },
  });
  const admin = await adminContext.newPage();
  admin.on('pageerror', (error) => consoleErrors.push(`admin pageerror: ${error.message}`));
  admin.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`admin console: ${message.text()}`);
  });

  await admin.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  // The gate renders twice: first while the session is being checked, then with
  // the verdict. Wait for the verdict, not just the container.
  const unlockGate = admin.locator('.admin-gate').filter({ hasText: /owner (sign-in|setup)/i });
  await unlockGate.waitFor({ timeout: 20000 });

  // Identity is not access: the gate appears even though the owner seam matched.
  check('security: provider identity alone does not open the dashboard', (await admin.locator('.admin-nav').count()) === 0);
  check('security: the gate asks for the second factor', (await unlockGate.count()) === 1);
  const unverified = await admin.evaluate(async () => {
    const response = await fetch('/api/admin/games');
    return { status: response.status, body: await response.json() };
  });
  check(
    'security: admin APIs refuse an unverified session',
    unverified.status === 401 && unverified.body.error === 'verification_required',
    `status ${unverified.status} ${unverified.body.error}`,
  );
  await shot(admin, 'owner-gate');

  const gateMode = await completeGate(admin);
  check('security: the emailed code opens the dashboard', (await admin.locator('.admin-nav').count()) === 1, `gate mode: ${gateMode}`);
  const signIns = await admin.evaluate(() => fetch('/api/admin/security/events').then((r) => r.json()));
  check(
    'security: sign-ins are recorded',
    (signIns.events ?? []).some((event) => event.kind === 'session.created'),
    (signIns.events ?? []).slice(0, 3).map((event) => event.kind).join(', '),
  );

  // The counts arrive with the overview request, so wait for the cards rather
  // than reading the skeletons that render while it is in flight.
  await admin.waitForSelector('.stat', { timeout: 20000 });
  const stats = await admin.locator('.stat').allInnerTexts();
  check('admin: overview counts come from the database', stats.some((text) => /Total games/.test(text)) && stats.length >= 6, `${stats.length} cards`);
  check('admin: quick actions are present', (await admin.locator('a:has-text("Upload new game")').count()) >= 1);
  await shot(admin, 'admin-overview');

  // The dashboard carries the same control, and the choice is the document's,
  // so it survives a reload of the admin shell as well.
  await admin.click('.admin-header .theme-pill button[aria-label="Dark theme"]');
  await admin.waitForTimeout(420);
  const adminDark = await admin.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    pressed: document.querySelector('.admin-header .theme-pill button[aria-label="Dark theme"]')?.getAttribute('aria-pressed'),
  }));
  await admin.reload({ waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('.admin-nav');
  const adminPersisted = await admin.evaluate(() => document.documentElement.dataset.theme);
  check(
    'admin: the dashboard switches theme and remembers it',
    adminDark.theme === 'dark' && adminDark.pressed === 'true' && adminPersisted === 'dark',
    `${adminDark.theme} → reload → ${adminPersisted}`,
  );

  // The dashboard is a second shell with its own surfaces, so its neutrality is
  // measured separately rather than inferred from the public pages.
  const adminSurfaces = await admin.evaluate(() => {
    const selectors = ['body', '.admin-header', '.admin-nav', '.admin-shell', '.panel', '.stat', '.admin-table', 'input', 'textarea', '.btn', '.callout'];
    const rows = [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const box = node.getBoundingClientRect();
        if (box.width * box.height < 1500) continue;
        const style = getComputedStyle(node);
        const values = /rgba?\(([^)]+)\)/.exec(style.backgroundColor)?.[1].split(',').map(Number);
        if (!values) continue;
        const [r, g, b, alpha = 1] = values;
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        if (alpha < 0.5 || spread > 14) continue;
        rows.push({ selector, color: style.backgroundColor, green: g > r + 2 && g > b + 2 });
      }
    }
    return rows;
  });
  const adminTinted = adminSurfaces.filter((row) => row.green);
  check(
    'admin: the dashboard’s neutral surfaces are grey in dark mode',
    adminSurfaces.length >= 3 && adminTinted.length === 0,
    `${adminSurfaces.length} surfaces · ${[...new Set(adminSurfaces.map((row) => `${row.selector} ${row.color}`))].slice(0, 4).join(' · ')}${adminTinted.length ? ` · tinted: ${adminTinted.map((row) => row.selector).join(', ')}` : ''}`,
  );
  await admin.click('.admin-header .theme-pill button[aria-label="Light theme"]');
  await admin.waitForTimeout(300);

  // Unsaved edits are surfaced in the editor itself; the reload prompt is the
  // browser's own and is accepted here so the run can leave the form again.
  admin.on('dialog', (dialog) => void dialog.accept());
  await admin.goto(`${BASE}/admin/games/new`, { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('#game-title');
  const dirtyNote = admin.locator('.field__hint[role="status"]').filter({ hasText: /unsaved changes/i });
  const cleanCount = await dirtyNote.count();
  await admin.fill('#game-title', 'Unsaved edit check');
  await admin.waitForTimeout(150);
  const dirtyCount = await dirtyNote.count();
  check(
    'admin: the editor warns about unsaved edits',
    cleanCount === 0 && dirtyCount === 1,
    `${cleanCount} → ${dirtyCount}`,
  );

  await admin.click('.admin-nav a:has-text("Games")');
  await admin.waitForURL(/\/admin\/games$/);
  await admin.waitForSelector('.admin-table tbody tr');
  const rows = await admin.locator('.admin-table tbody tr').count();
  check('admin: the table lists private records too', rows >= catalogue.games.length, `${rows} rows`);
  check(
    'admin: drafts are visible in the dashboard',
    (await admin.locator('.admin-table tbody').innerText()).includes('Draft Fixture'),
  );

  await admin.fill('#admin-search', 'draft');
  await admin.waitForTimeout(200);
  check('admin: search filters the table', (await admin.locator('.admin-table tbody tr').count()) === 1);
  await admin.fill('#admin-search', '');

  /* ---------------------------------------------------- dashboard on mobile */

  // The dashboard is a separate shell (its own header, nav, forms and tables),
  // so the public sweep says nothing about it. Same widths, real routes — and it
  // has to be measured here, after the gate has opened: an unverified session
  // renders the sign-in gate on every one of these routes.
  const firstGameId = await admin.evaluate(async () => {
    const data = await fetch('/api/admin/games').then((response) => response.json());
    return data.games?.[0]?.id ?? null;
  });
  const ADMIN_SWEEP_ROUTES = [
    '/admin',
    '/admin/games',
    '/admin/games/new',
    '/admin/content',
    '/admin/music',
    '/admin/appearance',
    '/admin/security',
    ...(firstGameId ? [`/admin/games/${firstGameId}`] : []),
  ];

  for (const width of [320, 390, 768, 1024, 1366]) {
    await admin.setViewportSize({ width, height: 900 });
    const overflowing = [];
    for (const route of ADMIN_SWEEP_ROUTES) {
      /* `networkidle`, not a fixed pause: the tables and panels these routes
         render arrive after their fetch, and a 120 ms sample used to measure the
         page before its widest row existed — passing while a table pushed the
         document sideways. */
      await admin.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
      await admin.waitForSelector('.admin-nav');
      const overflow = await admin.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) overflowing.push(`${route} +${overflow}px`);
    }
    check(
      `responsive: the dashboard has no horizontal overflow at ${width}px (${ADMIN_SWEEP_ROUTES.length} routes)`,
      overflowing.length === 0,
      overflowing.join(', '),
    );
  }

  // Every dashboard destination has to stay reachable when the nav wraps.
  await admin.setViewportSize({ width: 320, height: 900 });
  await admin.goto(`${BASE}/admin/games`, { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('.admin-nav');
  const adminNav = await admin.evaluate(() => {
    const links = Array.from(document.querySelectorAll('.admin-nav a'));
    const viewport = document.documentElement.clientWidth;
    return {
      count: links.length,
      offscreen: links
        .filter((link) => {
          const rect = link.getBoundingClientRect();
          return rect.left < 0 || rect.right > viewport + 1 || rect.width === 0 || rect.height < 24;
        })
        .map((link) => link.textContent?.trim() ?? ''),
      headerWidth: Math.round(document.querySelector('.admin-header__inner')?.getBoundingClientRect().width ?? 0),
    };
  });
  check(
    'responsive: every dashboard link fits on a 320px screen',
    // The count is a floor rather than an exact number: the nav is expected to
    // grow, and what is being proved is that nothing overflows at 320px.
    adminNav.count >= 6 && adminNav.offscreen.length === 0,
    `${adminNav.count} links, offscreen: ${adminNav.offscreen.join(', ') || 'none'}`,
  );
  check('responsive: the dashboard header uses the full width', adminNav.headerWidth >= 300, `${adminNav.headerWidth}px`);

  // The sign-in gate is the dashboard's other face, and it has its own layout.
  const gatePhone = await newContext({ viewport: { width: 320, height: 900 } });
  const gatePhonePage = await gatePhone.newPage();
  await gatePhonePage.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await gatePhonePage.locator('.admin-gate').filter({ hasText: /owner (sign-in|setup)/i }).waitFor({ timeout: 20000 });
  const gatePhoneBox = await gatePhonePage.evaluate(() => {
    const button = document.querySelector('.admin-gate button[type="submit"]')?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      signInWidth: button ? Math.round(button.width) : 0,
      signInOffscreen: button ? button.right > window.innerWidth + 1 : true,
    };
  });
  check(
    'responsive: the sign-in gate fits a 320px screen',
    gatePhoneBox.overflow <= 0 && gatePhoneBox.signInWidth > 0 && !gatePhoneBox.signInOffscreen,
    `overflow ${gatePhoneBox.overflow}px, sign-in ${gatePhoneBox.signInWidth}px`,
  );
  await gatePhone.close();

  await admin.setViewportSize({ width: 1440, height: 1000 });
  await admin.goto(`${BASE}/admin/games`, { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('.admin-table tbody tr');

  /* ------------------------------------------- create a game from scratch */

  const stamp = Date.now().toString(36);
  const title = `Verification Itch ${stamp}`;
  const slug = `verification-itch-${stamp}`;
  const working = `${BASE}/api/admin`;

  // Unsafe or unsupported addresses are refused by the server, not just hidden
  // by the form: the API is reachable without the dashboard.
  const rejectedItch = await admin.evaluate(
    async ([apiBase, gameTitle]) => {
      const attempt = async (body) => {
        const response = await fetch(`${apiBase}/games`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: gameTitle, status: 'draft', ...body }),
        });
        return { status: response.status, body: await response.json() };
      };
      return {
        javascript: await attempt({ itchUrl: 'javascript:alert(1)' }),
        data: await attempt({ itchUrl: 'data:text/html,<script>alert(1)</script>' }),
        lookalike: await attempt({
          itchUrl: 'https://itch.io.evil.example/game',
          itchEmbedUrl: 'https://evil.example/embed-upload/42',
        }),
        widget: await attempt({
          itchUrl: 'https://studio.itch.io/game',
          itchEmbedUrl: 'https://itch.io/embed/42',
        }),
        http: await attempt({ itchUrl: 'http://studio.itch.io/game' }),
      };
    },
    [working, `${title} rejected`],
  );
  check(
    'itch: javascript: and data: addresses are refused',
    rejectedItch.javascript.status === 422 && Boolean(rejectedItch.javascript.body.fields?.itchUrl) &&
      rejectedItch.data.status === 422 && Boolean(rejectedItch.data.body.fields?.itchUrl),
    `${rejectedItch.javascript.status}/${rejectedItch.data.status}`,
  );
  check(
    'itch: a lookalike domain is refused on both fields',
    rejectedItch.lookalike.status === 422 &&
      Boolean(rejectedItch.lookalike.body.fields?.itchUrl) &&
      Boolean(rejectedItch.lookalike.body.fields?.itchEmbedUrl),
    `${rejectedItch.lookalike.status} ${Object.keys(rejectedItch.lookalike.body.fields ?? {}).join(', ')}`,
  );
  check(
    'itch: the store widget cannot be used as a player',
    rejectedItch.widget.status === 422 && Boolean(rejectedItch.widget.body.fields?.itchEmbedUrl),
    `${rejectedItch.widget.status}`,
  );
  check('itch: plain http is refused', rejectedItch.http.status === 422 && Boolean(rejectedItch.http.body.fields?.itchUrl));

  // The owner's workflow, through the real form: title, summary, the two
  // addresses, then create the draft. Invalid input blocks the submit button
  // and explains itself before anything is sent.
  await admin.goto(`${BASE}/admin/games/new`, { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('#game-title');
  check('admin: the new-game form asks for the itch.io page URL', (await admin.locator('#game-itch-url').count()) === 1);
  check('admin: the new-game form asks for the itch.io embed URL', (await admin.locator('#game-itch-embed').count()) === 1);

  await admin.fill('#game-title', title);
  await admin.fill('#game-short', 'Created by the verification run.');
  await admin.fill('#game-itch-url', 'http://studio.itch.io/game');
  await admin.fill('#game-itch-embed', 'https://itch.io/embed/42');
  const invalidForm = await admin.evaluate(() => ({
    errors: Array.from(document.querySelectorAll('.field__error')).map((node) => node.textContent?.trim() ?? ''),
    disabled:
      Array.from(document.querySelectorAll('button')).find((node) => /create draft/i.test(node.textContent ?? ''))?.disabled ??
      null,
  }));
  check(
    'admin: invalid addresses are explained before saving',
    invalidForm.errors.some((text) => /https/i.test(text)) && invalidForm.errors.some((text) => /widget/i.test(text)),
    invalidForm.errors.join(' | ').slice(0, 120),
  );
  check('admin: the form refuses to submit invalid addresses', invalidForm.disabled === true, String(invalidForm.disabled));

  await admin.fill('#game-itch-url', FIXTURE_ITCH_PROJECT.replace('verification-build', `itch-${stamp}`));
  await admin.fill('#game-itch-embed', FIXTURE_ITCH_EMBED);
  await admin.locator('button:has-text("Create draft and continue")').click();
  await admin.waitForURL(/\/admin\/games\/[^?]+\?step=itch$/, { timeout: 20000 });
  const gameId = /\/admin\/games\/([^?]+)/.exec(admin.url())?.[1];
  check('admin: creating a game opens its itch.io player step', Boolean(gameId));

  const created = await admin.evaluate(
    ([apiBase, id]) =>
      fetch(`${apiBase}/games/${id}`).then(async (response) => ({ status: response.status, body: await response.json() })),
    [working, gameId],
  );
  check(
    'itch: both addresses are stored on the draft',
    created.status === 200 &&
      created.body.game?.itch?.projectUrl?.endsWith(`itch-${stamp}`) &&
      created.body.game?.itch?.embedUrl === FIXTURE_ITCH_EMBED,
    `${created.body.game?.itch?.projectUrl} · ${created.body.game?.itch?.embedUrl}`,
  );

  const publicAfterCreate = await admin.evaluate(() => fetch('/api/catalogue').then((response) => response.json()));
  check('admin: a draft is not published by creating it', !publicAfterCreate.games.some((game) => game.slug === slug));

  // Publishing needs cover art, and a fresh row has none. The server says which
  // field is missing rather than a generic refusal.
  const earlyPublish = await admin.evaluate(
    async ([apiBase, id]) => {
      const response = await fetch(`${apiBase}/games/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'published' }),
      });
      return { status: response.status, body: await response.json() };
    },
    [working, gameId],
  );
  check(
    'admin: publishing without cover art is refused',
    earlyPublish.status === 409 && Boolean(earlyPublish.body.fields?.artwork),
    `${earlyPublish.status} ${Object.keys(earlyPublish.body.fields ?? {}).join(', ')}`,
  );

  /* ------------------------------------------------- itch.io player step */

  await admin.waitForSelector('#itch-heading');
  const itchStep = await admin.evaluate(() => ({
    heading: document.querySelector('#itch-heading')?.textContent?.trim() ?? '',
    page: document.querySelector('.checklist li[data-ok="true"]')?.textContent?.trim() ?? '',
    steps: document.querySelectorAll('.itch-steps li').length,
    preview: /Preview the player/i.test(document.body.textContent ?? ''),
    iframes: document.querySelectorAll('.itch-preview iframe').length,
  }));
  check('admin: the player step explains where the embed comes from', /itch\.io player/i.test(itchStep.heading) && itchStep.steps >= 3);
  check('admin: the saved itch.io page is shown', /itch\.io\/itch-/.test(itchStep.page), itchStep.page.slice(0, 60));
  check('admin: the preview does not load anything until asked', itchStep.preview && itchStep.iframes === 0);

  await admin.route('https://itch.io/embed-upload/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: ITCH_FRAME_DOCUMENT }),
  );
  await admin.locator('button:has-text("Preview the player")').click();
  await admin.waitForSelector('.itch-preview iframe');
  const previewFrame = await admin.evaluate(() => {
    const frame = document.querySelector('.itch-preview iframe');
    return {
      src: frame?.getAttribute('src') ?? '',
      sandbox: frame?.getAttribute('sandbox') ?? '',
      title: frame?.getAttribute('title') ?? '',
    };
  });
  check('admin: the preview embeds the saved itch.io address', previewFrame.src === FIXTURE_ITCH_EMBED, previewFrame.src);
  check('admin: the preview frame is sandboxed with a title', /allow-scripts/.test(previewFrame.sandbox) && /Verification Itch/.test(previewFrame.title));
  await admin.frameLocator('.itch-preview iframe').locator('#status[data-ok="true"]').waitFor({ timeout: 15000 });
  check('admin: the preview actually renders the embedded game', true);
  check(
    'admin: previewing a draft never publishes it',
    !(await admin.evaluate(() => fetch('/api/catalogue').then((r) => r.json()))).games.some((game) => game.slug === slug),
  );
  await admin.unroute('https://itch.io/embed-upload/**');

  /* ---------------------------------------------------------- artwork step */

  await admin.goto(`${BASE}/admin/games/${gameId}?step=artwork`, { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('.dropzone');
  await admin.locator('input[type="file"][accept*="image/png"]').first().setInputFiles(imagePath);
  await admin.waitForSelector('.toast--ok', { timeout: 30000 });
  check('admin: cover artwork uploads to this site and previews', (await admin.locator('.artwork-slot img').count()) >= 1);

  await admin.locator('input[type="file"][accept*="image/png"]').last().setInputFiles(imagePath);
  await admin.waitForFunction(() => document.querySelectorAll('.artwork-shot').length >= 1, { timeout: 30000 });
  check('admin: a screenshot can be added', (await admin.locator('.artwork-shot img').count()) >= 1);

  await admin.reload({ waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('.artwork-shot');
  check(
    'admin: artwork and screenshots survive a reload',
    (await admin.locator('.artwork-slot img').count()) >= 1 && (await admin.locator('.artwork-shot img').count()) >= 1,
  );

  /* ---------------------------------------------------------- publish step */

  await admin.goto(`${BASE}/admin/games/${gameId}?step=publish`, { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('.checklist');
  check('admin: the publish step previews the real card', (await admin.locator('.game-card').count()) >= 1);
  const publishChip = admin.locator('button.chip--selectable:has-text("Published")');
  check('admin: publishing is now allowed', (await publishChip.isDisabled()) === false);
  await publishChip.click();
  await admin.waitForSelector('.toast--ok', { timeout: 30000 });

  const afterPublish = await admin.evaluate(
    (gameSlug) =>
      fetch('/api/catalogue').then((r) => r.json()).then((data) => {
        const game = data.games.find((entry) => entry.slug === gameSlug);
        return {
          found: Boolean(game),
          playable: game?.playable ?? false,
          art: Boolean(game?.artwork?.thumbnail),
          embed: game?.itch?.embedUrl ?? null,
          project: game?.itch?.projectUrl ?? null,
        };
      }),
    slug,
  );
  check('publish: the game appears in the public catalogue', afterPublish.found);
  check('publish: the published game is playable', afterPublish.playable);
  check('publish: uploaded artwork is used on the public listing', afterPublish.art);
  check('publish: the public record carries the itch.io player', afterPublish.embed === FIXTURE_ITCH_EMBED, String(afterPublish.embed));

  // The landing page stays on this domain, and its player is the itch.io embed.
  const landing = await adminContext.newPage();
  await landing.route('https://itch.io/embed-upload/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: ITCH_FRAME_DOCUMENT }),
  );
  await landing.goto(`${BASE}/games/${slug}`, { waitUntil: 'domcontentloaded' });
  await landing.waitForSelector('.player');
  check('publish: the game has its own page on this domain', new URL(landing.url()).pathname === `/games/${slug}`);
  await landing.click('.player button:has-text("Play")');
  await landing.waitForSelector('.player iframe');
  check('publish: the landing page embeds the saved itch.io game', (await landing.getAttribute('.player iframe', 'src')) === FIXTURE_ITCH_EMBED);
  await landing.frameLocator('.player iframe').locator('#status[data-ok="true"]').waitFor({ timeout: 15000 });
  check('publish: the embedded game is playable from the landing page', true);
  await shot(landing, 'published-game');

  /* -------------------------------------------------- edit, without deploy */

  const beforeEdit = await admin.evaluate(
    ([apiBase, id]) => fetch(`${apiBase}/games/${id}`).then((r) => r.json()).then((data) => data.game),
    [working, gameId],
  );
  const editedTitle = `${title} edited`;
  const edited = await admin.evaluate(
    async ([apiBase, id, newTitle]) => {
      const response = await fetch(`${apiBase}/games/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: newTitle, shortDescription: 'Edited without a deploy.' }),
      });
      return { status: response.status, body: await response.json() };
    },
    [working, gameId, editedTitle],
  );
  check('edit: changing the listing saves immediately', edited.status === 200 && edited.body.game?.title === editedTitle);
  const editedPublic = await admin.evaluate(
    (gameSlug) => fetch('/api/catalogue').then((r) => r.json()).then((data) => data.games.find((g) => g.slug === gameSlug)),
    slug,
  );
  check('edit: the public catalogue reflects the change without a redeploy', editedPublic?.title === editedTitle);
  check(
    'edit: the original publication date is preserved',
    Boolean(beforeEdit?.publishedAt) && beforeEdit.publishedAt === edited.body.game?.publishedAt,
    `${beforeEdit?.publishedAt} → ${edited.body.game?.publishedAt}`,
  );

  const badEdit = await admin.evaluate(
    async ([apiBase, id]) => {
      const response = await fetch(`${apiBase}/games/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itchEmbedUrl: 'https://evil.example/embed-upload/42' }),
      });
      return { status: response.status, body: await response.json() };
    },
    [working, gameId],
  );
  check(
    'edit: an invalid replacement embed address is refused',
    badEdit.status === 422 && Boolean(badEdit.body.fields?.itchEmbedUrl),
    `${badEdit.status}`,
  );
  check(
    'edit: the refused address did not overwrite the saved player',
    (await admin.evaluate(
      ([apiBase, id]) => fetch(`${apiBase}/games/${id}`).then((r) => r.json()).then((data) => data.game.itch.embedUrl),
      [working, gameId],
    )) === FIXTURE_ITCH_EMBED,
  );

  /* --------------------------------------------------------- unpublish */

  const unpublished = await admin.evaluate(
    async ([apiBase, id]) => {
      const response = await fetch(`${apiBase}/games/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'draft' }),
      });
      return response.status;
    },
    [working, gameId],
  );
  check('unpublish: the status change succeeds', unpublished === 200);
  const hidden = await admin.evaluate(() => fetch('/api/catalogue').then((r) => r.json()).then((data) => data.games.map((g) => g.slug)));
  check('unpublish: the game leaves the public catalogue', !hidden.includes(slug));
  const kept = await admin.evaluate(
    ([apiBase, id]) => fetch(`${apiBase}/games/${id}`).then((r) => r.json()).then((data) => data.game),
    [working, gameId],
  );
  check(
    'unpublish: metadata, artwork and the itch.io addresses are kept',
    kept.itch?.embedUrl === FIXTURE_ITCH_EMBED && Boolean(kept.artwork?.thumbnail) && Boolean(kept.artwork?.banner === null),
  );
  const draftPage = await fetch(`${BASE}/api/catalogue/${slug}`);
  check('unpublish: the game page is gone for visitors', draftPage.status === 404, `status ${draftPage.status}`);

  /* ------------------------------------------------- cleanup: delete it */

  const artworkUrl = kept.artwork.thumbnail;
  const purged = await admin.evaluate(
    async ([apiBase, id]) => {
      const response = await fetch(`${apiBase}/games/${id}?mode=purge`, { method: 'DELETE' });
      return { status: response.status, body: await response.json() };
    },
    [working, gameId],
  );
  check('delete: a game can be deleted permanently', purged.status === 200 && purged.body.deleted === true);
  const goneFromAdmin = await admin.evaluate(() => fetch('/api/admin/games').then((r) => r.json()).then((data) => data.games.map((g) => g.slug)));
  check('delete: it disappears from the dashboard', !goneFromAdmin.includes(slug));
  const goneArt = artworkUrl ? await fetch(`${BASE}${artworkUrl}`).then((r) => r.status) : 404;
  check('delete: its uploaded artwork is removed from storage', goneArt === 404, `artwork status ${goneArt}`);

  /* The public context opened at the top of the run is closed by now. Several
     sections below need an ordinary visitor again, so open one more. */
  const viewerContext = await newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const viewer = await viewerContext.newPage();
  viewer.on('pageerror', (error) => consoleErrors.push(`viewer pageerror: ${error.message}`));
  viewer.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`viewer console: ${message.text()}`);
  });

  /* --------------------------------------------- animated background */

  await viewer.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await viewer.waitForSelector('.deco-field');
  const deco = await viewer.evaluate(() => {
    const field = document.querySelector('.deco-field--fixed');
    const shapes = field ? Array.from(field.querySelectorAll('.deco')) : [];
    const fieldStyle = field ? getComputedStyle(field) : null;
    return {
      count: shapes.length,
      pointerEvents: fieldStyle?.pointerEvents ?? '',
      ariaHidden: field?.getAttribute('aria-hidden') ?? '',
      zIndex: Number(fieldStyle?.zIndex ?? '0'),
      animationName: shapes[0] ? getComputedStyle(shapes[0]).animationName : '',
      interactive: Boolean(field?.querySelector('a,button,input,select,textarea')),
      insidePlayer: document.querySelectorAll('.player .deco-field').length,
      /* The loop places marks in viewport pixels and clamps them to the free
         area. Rotation can add a few pixels to a rect, so the bound allows a
         small slack; the field's own `overflow: hidden` means even that slack
         can never produce a scrollbar. */
      insideViewport: shapes.every((shape) => {
        const rect = shape.getBoundingClientRect();
        return rect.left >= -8 && rect.top >= -8 && rect.right <= innerWidth + 8 && rect.bottom <= innerHeight + 8;
      }),
      overflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      kinds: [...new Set(shapes.map((shape) => shape.className.baseVal.split('--')[1]))].length,
    };
  });
  check('decorations: the animated layer is on the page', deco.count > 0, `${deco.count} shapes`);
  check('decorations: they are a composition, not a single mark', deco.count >= 6 && deco.kinds >= 3, `${deco.count} shapes in ${deco.kinds} kinds`);
  check('decorations: every mark starts inside the viewport', deco.insideViewport === true);
  check('decorations: the layer adds no horizontal overflow', deco.overflow === true);
  check(
    'decorations: it cannot intercept input',
    deco.pointerEvents === 'none' && deco.ariaHidden === 'true' && !deco.interactive,
    `pointer-events ${deco.pointerEvents}`,
  );
  check('decorations: it sits behind the content', deco.zIndex < 0, `z-index ${deco.zIndex}`);
  check('decorations: never mounted inside a game player', deco.insidePlayer === 0);

  /* The acceptance test is movement, not markup: sample each mark's transform,
     wait, and require that it has travelled on both axes. A mark that only
     spins in place has the same x and y twice and fails here. */
  const readMarkPositions = () =>
    viewer.evaluate(() =>
      Array.from(document.querySelectorAll('.deco-field--fixed .deco')).map((shape) => {
        const matrix = getComputedStyle(shape).transform;
        const values = /matrix\(([^)]+)\)/.exec(matrix)?.[1].split(',').map(Number) ?? [];
        return { x: values[4] ?? 0, y: values[5] ?? 0 };
      }),
    );
  const positionsBefore = await readMarkPositions();
  await viewer.waitForTimeout(900);
  const positionsAfter = await readMarkPositions();
  const moved = positionsBefore.map((start, index) => {
    const end = positionsAfter[index] ?? start;
    return { dx: Math.abs(end.x - start.x), dy: Math.abs(end.y - start.y) };
  });
  check(
    'decorations: marks travel across the screen on both axes',
    positionsBefore.length > 0 && moved.filter((step) => step.dx > 4 && step.dy > 4).length >= Math.ceil(positionsBefore.length * 0.75),
    `${moved.filter((step) => step.dx > 4 && step.dy > 4).length}/${positionsBefore.length} moved in x and y in 900 ms`,
  );
  check(
    'decorations: each mark travels at its own speed, not in formation',
    new Set(moved.map((step) => `${Math.round(step.dx)}:${Math.round(step.dy)}`)).size >= 3,
    `${new Set(moved.map((step) => `${Math.round(step.dx)}:${Math.round(step.dy)}`)).size} distinct vectors`,
  );

  // A resize recalculates the free area and clamps every mark back inside it.
  await viewer.setViewportSize({ width: 420, height: 620 });
  await viewer.waitForTimeout(450);
  const resized = await viewer.evaluate(() => {
    const shapes = Array.from(document.querySelectorAll('.deco-field--fixed .deco'));
    return {
      count: shapes.length,
      inside: shapes.every((shape) => {
        const rect = shape.getBoundingClientRect();
        return rect.left >= -8 && rect.top >= -8 && rect.right <= innerWidth + 8 && rect.bottom <= innerHeight + 8;
      }),
      overflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
    };
  });
  check('decorations: a resize keeps every mark inside the viewport', resized.inside === true, `${resized.count} marks at 420px`);
  check('decorations: still no horizontal overflow after a resize', resized.overflow === true);

  /* The acceptance test for "bounce", as opposed to "drift": watch the marks
     until one turns around at a wall. A bounce shows up as a change in the
     sign of the step on an axis while the position stays inside the free area;
     a mark that merely drifts, spins in place or resets never does that. The
     small viewport is deliberate — its walls are ~10 s away at ambient speed,
     so the window is long enough to see both axes reflect. */
  await viewer.setViewportSize({ width: 420, height: 420 });
  await viewer.waitForTimeout(400);
  const bounce = await viewer.evaluate(async () => {
    const field = document.querySelector('.deco-field--fixed');
    if (!field) return null;
    const shapes = Array.from(field.querySelectorAll('.deco'));
    const read = () =>
      shapes.map((shape) => {
        const values = /matrix\(([^)]+)\)/.exec(getComputedStyle(shape).transform)?.[1].split(',').map(Number) ?? [];
        return { x: values[4] ?? 0, y: values[5] ?? 0 };
      });

    const samples = [];
    const started = performance.now();
    while (performance.now() - started < 16000) {
      samples.push(read());
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    const area = { width: field.clientWidth, height: field.clientHeight };
    const flips = shapes.map(() => ({ x: 0, y: 0 }));
    const lastDx = shapes.map(() => null);
    const lastDy = shapes.map(() => null);
    let inside = true;
    let movedBoth = 0;
    const moved = shapes.map(() => ({ x: 0, y: 0 }));

    for (let index = 0; index < samples.length; index += 1) {
      const frame = samples[index];
      for (let mark = 0; mark < frame.length; mark += 1) {
        const point = frame[mark];
        if (point.x < -1 || point.y < -1 || point.x > area.width + 1 || point.y > area.height + 1) inside = false;
        if (index === 0) continue;
        const previous = samples[index - 1][mark];
        const dx = point.x - previous.x;
        const dy = point.y - previous.y;
        // Cumulative travel, not the largest single step: at ambient speed one
        // 120 ms sample moves only a few pixels, while a mark that never moved
        // accumulates none.
        moved[mark].x += Math.abs(dx);
        moved[mark].y += Math.abs(dy);
        if (Math.abs(dx) > 0.05) {
          if (lastDx[mark] !== null && Math.sign(dx) !== Math.sign(lastDx[mark])) flips[mark].x += 1;
          lastDx[mark] = dx;
        }
        if (Math.abs(dy) > 0.05) {
          if (lastDy[mark] !== null && Math.sign(dy) !== Math.sign(lastDy[mark])) flips[mark].y += 1;
          lastDy[mark] = dy;
        }
      }
    }
    movedBoth = moved.filter((step) => step.x > 40 && step.y > 40).length;

    return { marks: shapes.length, area, samples: samples.length, flips, inside, movedBoth };
  });
  const bounceX = bounce?.flips.reduce((sum, mark) => sum + mark.x, 0) ?? 0;
  const bounceY = bounce?.flips.reduce((sum, mark) => sum + mark.y, 0) ?? 0;
  check(
    'decorations: the whole layer keeps moving for the full window',
    (bounce?.marks ?? 0) >= 3 && (bounce?.movedBoth ?? 0) >= Math.floor((bounce?.marks ?? 0) / 2),
    `${bounce?.marks ?? 0} marks · ${bounce?.movedBoth ?? 0} travelled on both axes · ${bounce?.samples ?? 0} samples`,
  );
  check(
    'decorations: marks bounce off the horizontal edges',
    bounceX >= 1,
    `${bounceX} turn-around(s) on x in 16 s`,
  );
  check(
    'decorations: marks bounce off the vertical edges',
    bounceY >= 1,
    `${bounceY} turn-around(s) on y in 16 s`,
  );
  check(
    'decorations: a bounce never pushes a mark out of the viewport',
    bounce?.inside === true,
    bounce ? `${bounce.area.width}×${bounce.area.height} free area` : 'no field',
  );
  await viewer.setViewportSize({ width: 1440, height: 900 });
  await viewer.waitForTimeout(200);

  // A control underneath still works: the hero button navigates as usual.
  await viewer.click('.hero__actions a.btn--primary');
  await viewer.waitForURL(/\/games$/);
  check('decorations: controls underneath stay clickable', viewer.url().endsWith('/games'));

  await viewer.goto(`${BASE}/games/verification-run-public`, { waitUntil: 'domcontentloaded' });
  await viewer.waitForSelector('.player');
  await viewer.click('.player button:has-text("Play")');
  await viewer.waitForSelector('.player iframe');
  const playerTop = await viewer.evaluate(() => {
    const stage = document.querySelector('.player__stage');
    if (!stage) return 'missing';
    const box = stage.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit?.tagName?.toLowerCase() ?? 'none';
  });
  check('decorations: the game area receives clicks, not the layer', playerTop !== 'svg' && playerTop !== 'none', `top element: ${playerTop}`);

  // While a build runs, the page chrome steps aside: the floating controls and
  // the scroll rule mark a document being read, not a game being played.
  // The player reports "running" only once the settled build has signalled, so
  // this waits for the real state instead of sampling one frame after the click.
  const immersive = await poll(() =>
    viewer.evaluate(() => {
      if (document.body.dataset.immersive !== 'true') return null;
      const stack = document.querySelector('.floating-stack');
      const bar = document.querySelector('.scroll-progress');
      return {
        flag: true,
        stack: stack ? getComputedStyle(stack).display : 'absent',
        bar: bar ? getComputedStyle(bar).display : 'absent',
        ribbon: document.querySelectorAll('[data-ribbon]').length,
      };
    }),
  );
  check('gameplay: the page knows a game is running', immersive?.flag === true);
  check(
    'gameplay: floating controls and the scroll rule step aside while it runs',
    immersive?.stack === 'none' && immersive?.bar === 'none',
    immersive ? `stack ${immersive.stack}, scroll rule ${immersive.bar}` : 'the immersive flag never arrived',
  );
  check('gameplay: the word ribbon is never mounted over a running game', (immersive?.ribbon ?? 0) === 0);

  // Reduced motion: the layer stays as a still composition.
  const reducedContext = await newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await reducedPage.waitForSelector('.deco-field');
  const stillAt = () =>
    reducedPage.evaluate(() => {
      const shape = document.querySelector('.deco-field .deco');
      return {
        name: shape ? getComputedStyle(shape).animationName : 'missing',
        transform: shape ? getComputedStyle(shape).transform : 'missing',
        opacity: shape ? Number(getComputedStyle(shape).opacity) : 0,
      };
    });
  const still = await stillAt();
  await reducedPage.waitForTimeout(700);
  const stillLater = await stillAt();
  check('decorations: reduced motion stops animation', still.name === 'none', still.name);
  check(
    'decorations: reduced motion freezes the marks in place',
    still.transform === stillLater.transform && still.transform !== 'none',
    still.transform === stillLater.transform ? 'transform unchanged over 700 ms' : 'a mark moved',
  );
  check('decorations: reduced motion keeps a static composition', still.opacity > 0, `opacity ${still.opacity}`);
  await reducedContext.close();

  /* ------------------------------------------------- appearance settings */

  const publicSettings = await viewer.evaluate(() => fetch('/api/settings').then((r) => r.json()));
  check('appearance: settings are served publicly', typeof publicSettings.appearance?.intensity === 'string');

  const savedAppearance = await admin.evaluate(async () => {
    const response = await fetch('/api/admin/settings/appearance', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ animations: true, intensity: 'high', mobileReduction: false, parallax: false }),
    });
    return { status: response.status, body: await response.json() };
  });
  check(
    'appearance: the owner can save settings',
    savedAppearance.status === 200 && savedAppearance.body.appearance.intensity === 'high',
    `status ${savedAppearance.status}`,
  );
  const reflectedSettings = await viewer.evaluate(() => fetch('/api/settings').then((r) => r.json()));
  check(
    'appearance: the public setting changes without a rebuild',
    reflectedSettings.appearance.intensity === 'high' && reflectedSettings.appearance.parallax === false,
    JSON.stringify(reflectedSettings.appearance),
  );

  await admin.evaluate(() =>
    fetch('/api/admin/settings/appearance', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ animations: false, intensity: 'normal', mobileReduction: true, parallax: true }),
    }),
  );
  await viewer.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  // The layer waits for the saved settings before drawing anything, so poll
  // instead of sampling one frame.
  const layerRemoved = await viewer
    .waitForFunction(() => document.querySelectorAll('.deco-field--fixed').length === 0, null, { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check('appearance: disabling animations removes the layer', layerRemoved && (await viewer.locator('.deco-field--fixed').count()) === 0);

  await admin.evaluate(() =>
    fetch('/api/admin/settings/appearance', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ animations: true, intensity: 'normal', mobileReduction: true, parallax: true }),
    }),
  );
  await viewer.reload({ waitUntil: 'domcontentloaded' });
  await viewer.waitForSelector('.deco-field--fixed');
  check('appearance: re-enabling restores it', (await viewer.locator('.deco-field--fixed').count()) === 1);

  /* ------------------------------- intensity and the mobile reduction --- */

  const setAppearance = (patch) =>
    admin.evaluate(async (body) => {
      const response = await fetch('/api/admin/settings/appearance', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return response.status;
    }, patch);

  /**
   * What the decoration layer costs at a given viewport: how many elements it
   * builds, and how many of those are actually painted. The two differ on very
   * small screens, where CSS also hides the "far" register, so counting elements
   * is what shows whether the mobile reduction is doing its job.
   */
  const shapesAt = async (width) => {
    await viewer.setViewportSize({ width, height: 900 });
    await viewer.reload({ waitUntil: 'domcontentloaded' });
    await viewer.waitForSelector('.deco-field--fixed');
    await viewer.waitForFunction(() => document.querySelectorAll('.deco-field--fixed .deco').length > 0, null, { timeout: 10000 });
    return viewer.evaluate(() => {
      const shapes = Array.from(document.querySelectorAll('.deco-field--fixed .deco'));
      return {
        elements: shapes.length,
        painted: shapes.filter((shape) => shape.getBoundingClientRect().height > 0).length,
      };
    });
  };

  await setAppearance({ animations: true, intensity: 'low', mobileReduction: true, parallax: true });
  const lowShapes = await shapesAt(1440);
  await setAppearance({ animations: true, intensity: 'normal', mobileReduction: true, parallax: true });
  const normalShapes = await shapesAt(1440);
  await setAppearance({ animations: true, intensity: 'high', mobileReduction: true, parallax: true });
  const highShapes = await shapesAt(1440);
  check(
    'appearance: intensity scales the decoration layer',
    lowShapes.elements > 0 && lowShapes.elements < normalShapes.elements && normalShapes.elements < highShapes.elements,
    `low ${lowShapes.elements} · normal ${normalShapes.elements} · high ${highShapes.elements} elements`,
  );

  const phoneReduced = await shapesAt(390);
  await setAppearance({ animations: true, intensity: 'high', mobileReduction: false, parallax: true });
  const phoneUnreduced = await shapesAt(390);
  check(
    'appearance: a phone builds fewer elements than the desktop view',
    phoneReduced.elements > 0 && phoneReduced.elements < highShapes.elements && phoneReduced.painted > 0,
    `${phoneReduced.elements} elements and ${phoneReduced.painted} painted, against ${highShapes.elements} at 1440px`,
  );
  check(
    'appearance: the mobile reduction is what removes them',
    phoneUnreduced.elements > phoneReduced.elements,
    `${phoneReduced.elements} elements with the reduction, ${phoneUnreduced.elements} without`,
  );

  // Back to the documented defaults for everything that follows.
  await setAppearance({ animations: true, intensity: 'normal', mobileReduction: true, parallax: true });
  await viewer.setViewportSize({ width: 1440, height: 900 });

  /* --------------------------------------------------- ambient music ---- */

  const musicContext = await newContext({ viewport: { width: 1280, height: 900 } });
  const musicPage = await musicContext.newPage();
  const musicErrors = [];
  const musicRequests = [];
  musicPage.on('pageerror', (error) => musicErrors.push(error.message));
  musicPage.on('request', (request) => {
    if (request.url().includes('/audio/')) musicRequests.push(request.url());
  });

  await musicPage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const musicBefore = await musicPage.evaluate(() => {
    const button = document.querySelector('.header-actions .music-toggle');
    return {
      elements: document.querySelectorAll('audio').length,
      label: button?.getAttribute('aria-label') ?? '',
      pressed: button?.getAttribute('aria-pressed') ?? '',
      stored: localStorage.getItem('hg.music.v1'),
    };
  });
  check(
    'music: silent and unfetched until the visitor asks for it',
    musicBefore.elements === 0 && musicRequests.length === 0,
    `${musicBefore.elements} elements, ${musicRequests.length} audio requests`,
  );
  check(
    'music: the control reports the off state honestly',
    /play background music/i.test(musicBefore.label) && musicBefore.pressed === 'false' && musicBefore.stored === null,
    `${musicBefore.label} · pressed ${musicBefore.pressed}`,
  );

  await musicPage.click('.header-actions .music-toggle');
  const musicStarted = await musicPage
    .waitForFunction(() => {
      const audio = document.querySelector('audio');
      return Boolean(audio && !audio.paused && audio.currentTime > 0.2);
    }, null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  const playing = await musicPage.evaluate(() => {
    const audio = document.querySelector('audio');
    const button = document.querySelector('.header-actions .music-toggle');
    return {
      elements: document.querySelectorAll('audio').length,
      loop: audio?.loop ?? false,
      paused: audio?.paused ?? true,
      volume: audio ? Math.round(audio.volume * 100) / 100 : 0,
      currentTime: audio?.currentTime ?? 0,
      duration: Number.isFinite(audio?.duration) ? Math.round(audio.duration) : 0,
      label: button?.getAttribute('aria-label') ?? '',
      pressed: button?.getAttribute('aria-pressed') ?? '',
      stored: localStorage.getItem('hg.music.v1'),
    };
  });
  check('music: exactly one looping element is created', musicStarted && playing.elements === 1 && playing.loop, `${playing.elements} elements · loop ${playing.loop}`);
  check(
    'music: the generated track plays at a background level',
    playing.paused === false && playing.currentTime > 0.2 && playing.duration >= 20 && playing.volume > 0 && playing.volume <= 0.6,
    `${playing.duration}s loop at volume ${playing.volume}`,
  );
  check('music: the control becomes a mute control', /mute background music/i.test(playing.label) && playing.pressed === 'true' && playing.stored === 'true', playing.label);

  await musicPage.click('.site-nav a:has-text("Games")');
  await musicPage.waitForURL(/\/games$/);
  await musicPage.waitForTimeout(800);
  const musicAfterNav = await musicPage.evaluate(() => {
    const audio = document.querySelector('audio');
    return { elements: document.querySelectorAll('audio').length, paused: audio?.paused ?? true, at: audio?.currentTime ?? 0 };
  });
  check(
    'music: navigation neither duplicates nor restarts it',
    musicAfterNav.elements === 1 && musicAfterNav.paused === false && musicAfterNav.at > playing.currentTime,
    `${musicAfterNav.elements} element, at ${musicAfterNav.at.toFixed(1)}s`,
  );

  /* The volume slider is wired to the audio element, not to a number in the
     markup. Thirty percent is chosen because it is far from the 40% default, so
     a slider that changed nothing could not pass by coincidence. */
  await musicPage.click('.header-actions .music-volume__toggle');
  await musicPage.waitForSelector('.music-volume__popover');
  const volumeBefore = await musicPage.evaluate(() => ({
    audio: Math.round((document.querySelector('audio')?.volume ?? 0) * 100),
    slider: Number(document.querySelector('.music-volume__range')?.value ?? -1),
  }));
  await musicPage.evaluate(() => {
    const input = document.querySelector('.music-volume__range');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '30');
    input?.dispatchEvent(new Event('input', { bubbles: true }));
    input?.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await musicPage.waitForTimeout(900);
  const volumeAfter = await musicPage.evaluate(() => ({
    audio: Math.round((document.querySelector('audio')?.volume ?? 0) * 100),
    slider: Number(document.querySelector('.music-volume__range')?.value ?? -1),
    output: document.querySelector('.music-volume__value')?.textContent ?? '',
    stored: Number(localStorage.getItem('hg.music.volume.v1')),
  }));
  check(
    'music: the volume slider changes the real element volume',
    volumeBefore.audio !== 30 && Math.abs(volumeAfter.audio - 30) <= 1 && volumeAfter.slider === 30 && /30%/.test(volumeAfter.output),
    `${volumeBefore.audio}% → ${volumeAfter.audio}% (slider ${volumeAfter.slider}, ${volumeAfter.output})`,
  );
  check(
    'music: the chosen volume is stored on its own key',
    Math.abs(volumeAfter.stored - 0.3) < 0.01,
    String(volumeAfter.stored),
  );

  // Muting and resuming must not reset the level the visitor chose.
  await musicPage.click('.header-actions .music-toggle');
  await musicPage.waitForTimeout(900);
  const mutedWithVolume = await musicPage.evaluate(() => ({
    paused: document.querySelector('audio')?.paused ?? true,
    volume: Math.round((document.querySelector('audio')?.volume ?? 0) * 100),
    stored: Number(localStorage.getItem('hg.music.volume.v1')),
    musicStored: localStorage.getItem('hg.music.v1'),
  }));
  await musicPage.click('.header-actions .music-toggle');
  await musicPage.waitForTimeout(1100);
  const resumedWithVolume = await musicPage.evaluate(() => ({
    paused: document.querySelector('audio')?.paused ?? true,
    volume: Math.round((document.querySelector('audio')?.volume ?? 0) * 100),
    stored: Number(localStorage.getItem('hg.music.volume.v1')),
  }));
  check(
    'music: muting keeps the chosen volume, unmuting restores it',
    mutedWithVolume.paused === true &&
      mutedWithVolume.musicStored === 'false' &&
      Math.abs(mutedWithVolume.stored - 0.3) < 0.01 &&
      resumedWithVolume.paused === false &&
      Math.abs(resumedWithVolume.volume - 30) <= 1,
    `muted at ${mutedWithVolume.volume}% (stored ${mutedWithVolume.stored}) → resumed at ${resumedWithVolume.volume}%`,
  );

  await musicPage.reload({ waitUntil: 'networkidle' });
  await musicPage.waitForTimeout(1400);
  const musicAfterReload = await musicPage.evaluate(() => {
    const button = document.querySelector('.header-actions .music-toggle');
    return {
      elements: document.querySelectorAll('audio').length,
      state: button?.getAttribute('data-state') ?? '',
      label: button?.getAttribute('aria-label') ?? '',
      stored: localStorage.getItem('hg.music.v1'),
    };
  });
  check(
    'music: a reload remembers the preference but starts nothing by itself',
    musicAfterReload.elements === 0 &&
      musicAfterReload.state === 'paused' &&
      musicAfterReload.stored === 'true' &&
      /resume background music/i.test(musicAfterReload.label),
    `${musicAfterReload.elements} elements · ${musicAfterReload.state} · stored ${musicAfterReload.stored}`,
  );
  check(
    'music: a remembered preference refetches none of the track',
    musicRequests.length === 1,
    `${musicRequests.length} audio request(s)`,
  );

  await musicPage.click('.header-actions .music-volume__toggle');
  await musicPage.waitForSelector('.music-volume__popover');
  const volumeAfterReload = await musicPage.evaluate(() => ({
    slider: Number(document.querySelector('.music-volume__range')?.value ?? -1),
    output: document.querySelector('.music-volume__value')?.textContent ?? '',
  }));
  await musicPage.keyboard.press('Escape');
  check(
    'music: the chosen volume survives a reload',
    volumeAfterReload.slider === 30 && /30%/.test(volumeAfterReload.output),
    `slider at ${volumeAfterReload.slider} (${volumeAfterReload.output})`,
  );

  // Mute from whichever state the reload left behind (a refused autoplay needs
  // one click to resume, and the second one to mute).
  if (await musicPage.evaluate(() => document.querySelector('audio')?.paused ?? true)) {
    await musicPage.click('.header-actions .music-toggle');
    await musicPage.waitForTimeout(1000);
  }
  await musicPage.click('.header-actions .music-toggle');
  await musicPage.waitForTimeout(1000);
  const muted = await musicPage.evaluate(() => {
    const audio = document.querySelector('audio');
    const button = document.querySelector('.header-actions .music-toggle');
    return { paused: audio?.paused ?? true, stored: localStorage.getItem('hg.music.v1'), label: button?.getAttribute('aria-label') ?? '' };
  });
  check(
    'music: muting pauses playback and clears the preference',
    muted.paused === true && muted.stored === 'false' && /play background music/i.test(muted.label),
    `paused ${muted.paused} · stored ${muted.stored}`,
  );

  // A file that cannot play must be reported, never papered over.
  await musicPage.click('.header-actions .music-toggle');
  await musicPage.waitForTimeout(900);
  await musicPage.evaluate(() => document.querySelector('audio')?.dispatchEvent(new Event('error')));
  await musicPage.waitForTimeout(300);
  const musicFailed = await musicPage.evaluate(() => {
    const audio = document.querySelector('audio');
    const button = document.querySelector('.header-actions .music-toggle');
    return {
      label: button?.getAttribute('aria-label') ?? '',
      pressed: button?.getAttribute('aria-pressed'),
      paused: audio?.paused ?? true,
      stored: localStorage.getItem('hg.music.v1'),
    };
  });
  check(
    'music: an unplayable file is reported instead of faked',
    /unavailable/i.test(musicFailed.label) && musicFailed.pressed === 'false' && musicFailed.paused === true && musicFailed.stored === 'false',
    `${musicFailed.label} · paused ${musicFailed.paused}`,
  );
  check('music: nothing threw while the player changed state', musicErrors.length === 0, musicErrors.slice(0, 2).join(' | '));
  await musicContext.close();

  /* ------------------------------------------ background music (owner) -- */

  // The dashboard's music editor, driven through its own controls. The audio
  // bytes go to R2 and the document to D1, so every assertion below reads the
  // server's answer rather than the form's state.
  const musicAdminBefore = await admin.evaluate(() => fetch('/api/admin/music').then((r) => r.json()));
  check(
    'music admin: a fresh install reports the bundled track',
    musicAdminBefore.music.source === 'bundled' &&
      musicAdminBefore.music.enabled === true &&
      musicAdminBefore.previewUrl === '/audio/ambient-theme.wav' &&
      musicAdminBefore.available === true,
    `${musicAdminBefore.music.source} · available ${musicAdminBefore.available}`,
  );

  await admin.goto(`${BASE}/admin/music`, { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('#music-settings-heading');
  await admin.locator('.field input[type="text"]').fill('Verification loop');
  await admin.setInputFiles('input[type="file"]', trackAPath);
  await admin.click('button:has-text("Replace track")');
  await poll(
    async () => {
      const data = await admin.evaluate(() => fetch('/api/admin/music').then((r) => r.json()));
      return data.music.byteSize === trackABytes ? data : null;
    },
    { timeout: 20000 },
  );
  await admin.waitForSelector('audio[controls]', { timeout: 10000 });
  const uploaded = await admin.evaluate(() => fetch('/api/admin/music').then((r) => r.json()));
  check(
    'music admin: an uploaded track replaces the bundled one',
    uploaded.music.source === 'uploaded' &&
      uploaded.music.title === 'Verification loop' &&
      uploaded.music.enabled === true &&
      uploaded.music.byteSize === trackABytes,
    `${uploaded.music.source} · “${uploaded.music.title}” · ${uploaded.music.byteSize} bytes`,
  );
  check(
    'music admin: the preview plays the uploaded file',
    String(uploaded.previewUrl ?? '').startsWith('/api/media/music?v=') && uploaded.available === true,
    String(uploaded.previewUrl),
  );

  // Reloading the dashboard proves the document is stored, not held in state.
  await admin.reload({ waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('#music-settings-heading');
  const persistedMusic = await admin.evaluate(() => ({
    title: document.querySelector('.field input[type="text"]')?.value ?? '',
    preview: document.querySelector('audio[controls]')?.getAttribute('src') ?? '',
    uploaded: document.body.innerText.includes('Uploaded file'),
  }));
  check(
    'music admin: the upload survives a dashboard reload',
    persistedMusic.title === 'Verification loop' &&
      persistedMusic.preview.includes('/api/media/music') &&
      persistedMusic.uploaded,
    `“${persistedMusic.title}” · ${persistedMusic.preview}`,
  );

  const servedMusic = async (url) => {
    const response = await fetch(`${BASE}${url}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, type: response.headers.get('content-type'), bytes: bytes.byteLength };
  };

  const publicUploaded = await fetch(`${BASE}/api/music`).then((response) => response.json());
  const uploadedUrl = publicUploaded.music?.url ?? '';
  check(
    'music admin: the public site is offered the new track',
    publicUploaded.music?.enabled === true && uploadedUrl.startsWith('/api/media/music?v='),
    uploadedUrl,
  );
  check(
    'music admin: the storage key never reaches the public response',
    !JSON.stringify(publicUploaded).includes('music/') && !JSON.stringify(publicUploaded).toLowerCase().includes('storagekey'),
    JSON.stringify(publicUploaded).slice(0, 120),
  );

  const served = await servedMusic(uploadedUrl);
  check(
    'music admin: the uploaded bytes are served from object storage',
    served.status === 200 && served.type === 'audio/wav' && served.bytes === trackABytes,
    `${served.status} · ${served.type} · ${served.bytes} bytes`,
  );
  const ranged = await fetch(`${BASE}${uploadedUrl}`, { headers: { range: 'bytes=0-99' } });
  const rangedBytes = (await ranged.arrayBuffer()).byteLength;
  check(
    'music admin: the track supports byte ranges so it can start quickly',
    ranged.status === 206 && rangedBytes === 100 && /^bytes 0-99\//.test(ranged.headers.get('content-range') ?? ''),
    `status ${ranged.status} · ${rangedBytes} bytes · ${ranged.headers.get('content-range')}`,
  );

  // Replacing the file is a second upload: same document, new object and
  // version, so a browser cache cannot keep serving the old audio.
  await admin.setInputFiles('input[type="file"]', trackBPath);
  await admin.click('button:has-text("Replace track")');
  const replaced = await poll(
    async () => {
      const data = await admin.evaluate(() => fetch('/api/admin/music').then((r) => r.json()));
      return data.music.byteSize === trackBBytes ? data : null;
    },
    { timeout: 20000 },
  );
  const publicReplaced = await fetch(`${BASE}/api/music`).then((response) => response.json());
  check(
    'music admin: replacing a track stores the new file and version',
    replaced !== null &&
      replaced.available === true &&
      publicReplaced.music?.url !== uploadedUrl &&
      publicReplaced.music?.enabled === true,
    `${uploadedUrl} → ${publicReplaced.music?.url ?? 'none'}`,
  );
  check(
    'music admin: the replaced file is what the public URL now serves',
    publicReplaced.music?.url ? (await servedMusic(publicReplaced.music.url)).bytes === trackBBytes : false,
    `${trackABytes} → ${trackBBytes} bytes`,
  );

  // Disabling hides the control from visitors; the file stays in storage so it
  // can be turned back on without another upload.
  await admin.locator('label.field--inline input[type="checkbox"]').uncheck();
  await admin.click('button:has-text("Save music settings")');
  const disabled = await poll(async () => {
    const data = await fetch(`${BASE}/api/music`).then((response) => response.json());
    return data.music?.enabled === false ? data : null;
  });
  check(
    'music admin: disabling removes it from the public configuration',
    disabled !== null && disabled.music.url === null,
    JSON.stringify(disabled?.music ?? null),
  );

  const silentContext = await newContext({ viewport: { width: 1280, height: 900 } });
  const silentPage = await silentContext.newPage();
  await silentPage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const silentUi = await silentPage.evaluate(() => ({
    toggles: document.querySelectorAll('.music-toggle').length,
    volumes: document.querySelectorAll('.music-volume').length,
    audios: document.querySelectorAll('audio').length,
  }));
  check(
    'music admin: disabled music removes the public player and volume control',
    silentUi.toggles === 0 && silentUi.volumes === 0 && silentUi.audios === 0,
    `${silentUi.toggles} toggles · ${silentUi.volumes} volume controls · ${silentUi.audios} elements`,
  );
  await silentContext.close();

  await admin.locator('label.field--inline input[type="checkbox"]').check();
  await admin.click('button:has-text("Save music settings")');
  const reEnabled = await poll(async () => {
    const data = await fetch(`${BASE}/api/music`).then((response) => response.json());
    return data.music?.enabled === true ? data : null;
  });
  check(
    'music admin: re-enabling reuses the stored file',
    reEnabled !== null &&
      String(reEnabled.music.url ?? '').startsWith('/api/media/music?v=') &&
      (await servedMusic(reEnabled.music.url)).bytes === trackBBytes,
    String(reEnabled?.music.url),
  );

  // Removal deletes the object and turns the track off.
  await admin.click('button:has-text("Remove background music")');
  await admin.waitForSelector('.modal');
  await admin.click('.modal .btn--danger');
  const removed = await poll(async () => {
    const data = await admin.evaluate(() => fetch('/api/admin/music').then((r) => r.json()));
    return data.music?.source === 'none' ? data : null;
  });
  check(
    'music admin: removing the track clears the document and the preview',
    removed !== null && removed.music.enabled === false && removed.previewUrl === null && removed.available === false,
    JSON.stringify(removed?.music ?? null),
  );
  const afterRemoval = await fetch(`${BASE}/api/music`).then((response) => response.json());
  check(
    'music admin: the public site is silent after a removal',
    afterRemoval.music.enabled === false && afterRemoval.music.url === null,
    JSON.stringify(afterRemoval.music),
  );

  // Failed uploads are refused without touching the configuration.
  const rejected = await admin.evaluate(async () => {
    const send = (body, type) =>
      fetch('/api/admin/music/file?title=Rejected', {
        method: 'PUT',
        headers: { 'content-type': type },
        body,
      });
    const notAudio = await send(new TextEncoder().encode('this is not an audio file at all'), 'audio/mpeg');
    const empty = await send(new Uint8Array(0), 'audio/mpeg');
    return {
      notAudio: { status: notAudio.status, body: await notAudio.json() },
      empty: { status: empty.status, body: await empty.json() },
    };
  });
  check(
    'music admin: a file that is not audio is refused',
    rejected.notAudio.status === 415 && rejected.notAudio.body.error === 'unsupported_audio',
    `status ${rejected.notAudio.status} ${rejected.notAudio.body.error}`,
  );
  check(
    'music admin: an empty upload is refused',
    rejected.empty.status === 400 && rejected.empty.body.error === 'empty',
    `status ${rejected.empty.status} ${rejected.empty.body.error}`,
  );
  const afterRejections = await fetch(`${BASE}/api/music`).then((response) => response.json());
  check(
    'music admin: a refused upload leaves the configuration alone',
    afterRejections.music.enabled === false && afterRejections.music.url === null,
    JSON.stringify(afterRejections.music),
  );

  // Authorisation: the music endpoints are owner-only in both directions.
  const anonymousMusicRead = await fetch(`${BASE}/api/admin/music`);
  const anonymousMusicDelete = await fetch(`${BASE}/api/admin/music/file`, { method: 'DELETE' });
  check(
    'music admin: the endpoints are refused without an owner session',
    [anonymousMusicRead.status, anonymousMusicDelete.status].every((status) => status === 401 || status === 403),
    `${anonymousMusicRead.status} / ${anonymousMusicDelete.status}`,
  );
  const publicAfterAnonymous = await fetch(`${BASE}/api/music`).then((response) => response.json());
  check(
    'music admin: an unauthorised removal changes nothing',
    publicAfterAnonymous.music.enabled === false && publicAfterAnonymous.music.url === null,
    JSON.stringify(publicAfterAnonymous.music),
  );

  // The shipped track comes back, so the next run starts from the same state a
  // fresh deployment has — and any test audio is deleted from storage.
  const resetMusic = await fetch(`${BASE}/api/admin/dev/content-reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-owner': DEV_OWNER },
    body: JSON.stringify({}),
  });
  const resetMusicBody = await resetMusic.json().catch(() => ({}));
  const restoredMusic = await fetch(`${BASE}/api/music`).then((response) => response.json());
  check(
    'cleanup: the bundled soundtrack is restored after the run',
    resetMusic.status === 200 &&
      resetMusicBody.music?.reset === 'bundled' &&
      restoredMusic.music.enabled === true &&
      restoredMusic.music.url === '/audio/ambient-theme.wav',
    `${resetMusic.status} · ${JSON.stringify(resetMusicBody.music ?? null)} · ${restoredMusic.music.url}`,
  );

  /* --------------------------------------------------- site content ---- */

  const contentSnapshot = await admin.evaluate(() => fetch('/api/admin/content').then((r) => r.json()));
  const originalAbout = contentSnapshot.about.draft;
  const originalContact = contentSnapshot.contact.draft;
  const originalSocial = contentSnapshot.social.draft;

  // One edited copy is used for the draft and for the publish, so what the
  // public page is checked against is exactly what was written.
  const editedAbout = { ...originalAbout, headline: 'Verification headline **in bold**', tagline: 'Draft-only tagline' };

  const draftSaved = await admin.evaluate(async (about) => {
    const response = await fetch('/api/admin/content/about', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(about),
    });
    return { status: response.status, body: await response.json() };
  }, editedAbout);
  check('content: the owner can save an About draft', draftSaved.status === 200, `status ${draftSaved.status}`);

  const duringDraft = await viewer.evaluate(() => fetch('/api/content/about').then((r) => r.json()));
  check('content: drafts stay private', duringDraft.about.headline !== 'Verification headline **in bold**');
  const anonymousPreview = await viewer.evaluate(() => fetch('/api/content/about?preview=1').then((r) => r.status));
  check('content: draft preview needs the owner', anonymousPreview === 403, `status ${anonymousPreview}`);
  const ownerPreview = await admin.evaluate(() => fetch('/api/content/about?preview=1').then((r) => r.json()));
  check('content: the owner can preview the draft privately', ownerPreview.about.headline.includes('Verification headline'));

  const publishedAbout = await admin.evaluate(async (about) => {
    await fetch('/api/admin/content/about', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...about,
        bio: ['First published paragraph.', '<script>alert("injected")</script>Escaped markup stays text.'],
      }),
    });
    const response = await fetch('/api/admin/content/about/publish', { method: 'POST' });
    return { status: response.status, body: await response.json() };
  }, editedAbout);
  check('content: publishing succeeds', publishedAbout.status === 200 && Boolean(publishedAbout.body.document?.publishedAt));

  // No rebuild, no redeploy: the public API has to carry the new document.
  const servedHeadline = await poll(async () => {
    const body = await fetch(`${BASE}/api/content/about`).then((r) => r.json());
    return typeof body.about?.headline === 'string' && body.about.headline.includes('Verification headline')
      ? body.about.headline
      : null;
  });
  check('content: the public content API serves the publish immediately', Boolean(servedHeadline), String(servedHeadline));

  await viewer.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded' });
  await viewer.waitForSelector('#about-title');
  const aboutText = await viewer.locator('body').innerText();
  check('content: the public page shows the published content without a rebuild', aboutText.includes('Verification headline'));
  const emphasis = await viewer.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('main strong, .page strong'));
    return { count: nodes.length, inline: nodes.some((node) => /in bold/i.test(node.textContent ?? '')) };
  });
  check('content: inline formatting renders as markup, not literal asterisks', emphasis.inline, `${emphasis.count} strong elements`);
  check('content: stored emphasis is emphasised, not printed', /\*\*in bold\*\*/.test(aboutText) === false);

  // The injected paragraph is defanged at two layers — tags are stripped when the
  // document is normalised on the way in, and the renderer escapes what remains.
  // Either layer is enough for the security claim, so what is asserted is the
  // outcome: no element or event handler from content reached the page, and the
  // payload is still there as harmless text rather than a live script.
  const injection = await viewer.evaluate(() => {
    const scope = document.querySelector('main') ?? document.body;
    return {
      scripts: scope.querySelectorAll('script').length,
      handlers: scope.querySelectorAll('[onclick],[onerror],[onload],[onmouseover]').length,
    };
  });
  check(
    'content: stored markup cannot inject a script or an event handler',
    injection.scripts === 0 && injection.handlers === 0,
    JSON.stringify(injection),
  );
  check(
    'content: the injected payload survives as harmless text',
    aboutText.includes('alert("injected")') && !/<script/i.test(aboutText),
  );
  await shot(viewer, 'about-content');

  /* ------------------------------------------------- portrait upload --- */

  await admin.goto(`${BASE}/admin/content`, { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('.tabs');
  check('content editor: the About editor renders its fields', (await admin.locator('.repeatable').count()) >= 4);

  await admin.locator('.avatar-field input[type="file"]').setInputFiles(imagePath);
  await admin.waitForSelector('.avatar-field__preview img', { timeout: 30000 });
  check('content editor: the portrait uploads and previews', (await admin.locator('.avatar-field__preview img').count()) === 1);
  await admin.click('button:has-text("Publish changes")');
  // Wait for the publish to be observable rather than for a toast that the
  // upload may already have shown.
  const portraitUrl = await poll(async () => {
    const body = await fetch(`${BASE}/api/content/about`).then((r) => r.json());
    return body.about?.avatarKey && body.avatar?.url ? body.avatar.url : null;
  });
  const portraitStatus = portraitUrl ? await fetch(`${BASE}${portraitUrl}`).then((r) => r.status) : 0;
  check('content: the published portrait is served publicly', portraitStatus === 200, `status ${portraitStatus}`);

  await viewer.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded' });
  await viewer.waitForSelector('.about-avatar');
  // The portrait element *is* `img.about-avatar` (the controller artwork stands in
  // when there is none), and it is lazy-loaded, so wait for a decoded image
  // rather than sampling one frame.
  const portraitLoaded = await viewer
    .waitForFunction(
      () => {
        const image = document.querySelector('img.about-avatar');
        return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
      },
      null,
      { timeout: 10000 },
    )
    .then(() => true)
    .catch(() => false);
  check('content: the About page renders the uploaded portrait', portraitLoaded);

  /* ------------------------------- repeatable fields: add, move, remove */

  // The About editor's lists are driven by the same add/edit/remove/reorder
  // controls the owner uses, so this exercises them through the interface rather
  // than through the API, then follows the change all the way to the public page.
  const skillsSection = admin.locator('.repeatable[aria-label="Skills and technologies"]');
  const skillInputs = skillsSection.locator('input[aria-label^="Skills and technologies item"]');
  const skillsBefore = await skillInputs.evaluateAll((nodes) => nodes.map((node) => node.value));

  await skillsSection.locator('button:has-text("Add skill")').click();
  await skillInputs.last().fill('Verification skill');
  check(
    'editor: a repeatable item can be added',
    (await skillInputs.count()) === skillsBefore.length + 1 && skillsBefore.length >= 2,
    `${skillsBefore.length} → ${await skillInputs.count()}`,
  );

  await skillsSection.locator('button[aria-label="Move item 1 down"]').click();
  const reorderedSkills = await skillInputs.evaluateAll((nodes) => nodes.map((node) => node.value));
  check(
    'editor: a repeatable item can be reordered',
    reorderedSkills[0] === skillsBefore[1] && reorderedSkills[1] === skillsBefore[0],
    reorderedSkills.slice(0, 3).join(', '),
  );

  // Read the draft through the browser, so the owner's session is used: the admin
  // API refuses an anonymous Node fetch, and a refusal must never look like a pass.
  const readDraftSkills = () =>
    admin.evaluate(async () => {
      const response = await fetch('/api/admin/content');
      const body = await response.json().catch(() => ({}));
      return { status: response.status, skills: body.about?.draft?.skills ?? null };
    });

  await admin.click('button:has-text("Save draft")');
  const draftHasSkill = await poll(async () => {
    const state = await readDraftSkills();
    return state.status === 200 && state.skills?.includes('Verification skill') ? state : null;
  });
  check(
    'editor: the edited list reaches the draft',
    draftHasSkill !== null,
    draftHasSkill ? `${draftHasSkill.skills.length} skills in the draft` : 'the draft never picked the item up',
  );

  await admin.click('button:has-text("Publish changes")');
  const publishedSkills = await poll(async () => {
    const body = await fetch(`${BASE}/api/content/about`).then((response) => response.json());
    return body.about?.skills?.includes('Verification skill') ? body.about.skills : null;
  });
  check(
    'editor: the new order publishes without a rebuild',
    Array.isArray(publishedSkills) && publishedSkills[0] === skillsBefore[1] && publishedSkills[1] === skillsBefore[0],
    (publishedSkills ?? []).slice(0, 3).join(', '),
  );

  await viewer.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded' });
  await viewer.waitForSelector('.about-tags .chip');
  const chips = await viewer.locator('.about-tags .chip').allInnerTexts();
  check(
    'editor: the public page renders the edited list in order',
    chips[0] === skillsBefore[1] && chips[1] === skillsBefore[0] && chips.includes('Verification skill'),
    chips.slice(0, 3).join(', '),
  );

  // The list survives a reload, and an item can be removed again through the UI.
  await admin.reload({ waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('.repeatable');
  const afterReload = await admin.locator('.repeatable[aria-label="Skills and technologies"] input[aria-label^="Skills and technologies item"]').evaluateAll((nodes) => nodes.map((node) => node.value));
  check('editor: the added item survives a reload', afterReload.includes('Verification skill'), `${afterReload.length} items`);

  await skillsSection.locator(`button[aria-label="Remove item ${afterReload.length}"]`).click();
  check('editor: a repeatable item can be removed', (await skillInputs.count()) === afterReload.length - 1);
  await admin.click('button:has-text("Save draft")');
  const removalSaved = await poll(async () => {
    const state = await readDraftSkills();
    return state.status === 200 && Array.isArray(state.skills) && !state.skills.includes('Verification skill') ? state : null;
  });
  check(
    'editor: the removal reaches the draft',
    removalSaved !== null,
    removalSaved ? `${removalSaved.skills.length} skills left` : 'the removed item is still in the draft',
  );

  /* --------------------------------------------------------- social links */

  // The social document is edited on its own dashboard page and published the
  // same way as the other content: draft first, then live. What follows drives
  // the real controls — add, edit, reorder, enable, preview and delete all with
  // confirmation — and then follows the result to the public page.
  const readAdminContent = () =>
    admin.evaluate(async () => {
      const response = await fetch('/api/admin/content');
      const body = await response.json().catch(() => ({}));
      return { status: response.status, body };
    });

  const readPublicSocial = () => fetch(`${BASE}/api/content/social`).then((response) => response.json());

  const writeSocial = (document, publish = false) =>
    admin.evaluate(
      async ([doc, shouldPublish]) => {
        const saved = await fetch('/api/admin/content/social', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(doc),
        });
        if (!shouldPublish || !saved.ok) return { status: saved.status, body: await saved.json().catch(() => ({})) };
        const published = await fetch('/api/admin/content/social/publish', { method: 'POST' });
        return { status: published.status, body: await published.json().catch(() => ({})) };
      },
      [document, publish],
    );

  // A known baseline, so every count below is a fact rather than a leftover.
  const EMPTY_SOCIAL = {
    visible: true,
    heading: 'Find me on the internet',
    intro: 'The games live here. These are the places I post about building them.',
    links: [],
  };
  const socialReset = await writeSocial(EMPTY_SOCIAL, true);
  check('social: the document can be written and published', socialReset.status === 200, `status ${socialReset.status}`);

  const emptyPublic = await readPublicSocial();
  check(
    'social: with no links published the section is empty, not placeholder-filled',
    Array.isArray(emptyPublic.social?.links) && emptyPublic.social.links.length === 0,
    `${emptyPublic.social?.links?.length ?? 'no'} links`,
  );

  await viewer.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await viewer.waitForSelector('[data-typed-headline]');
  check(
    'social: an unconfigured section renders nothing at all',
    (await viewer.locator('[data-social-band]').count()) === 0 &&
      (await viewer.locator('.site-footer').count()) === 1,
    'the footer still ends the page',
  );

  /* ------------------------------------------- the manager, driven by hand */

  await admin.goto(`${BASE}/admin/social`, { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('[data-social-preview]');
  await shot(admin, 'social-manager-empty');
  check(
    'social: the dashboard has its own section for it',
    (await admin.locator('.admin-nav a[href="/admin/social"]').count()) === 1,
  );
  check(
    'social: the empty state explains itself',
    (await admin.locator('.repeatable__empty').count()) >= 1,
  );
  check(
    'social: the preview renders the real public component',
    (await admin.locator('[data-social-preview] [data-social-band]').count()) === 1 &&
      (await admin.locator('[data-social-preview] .social-band__empty').count()) === 1,
  );

  await admin.click('[data-add-social]');
  await admin.waitForSelector('.social-manager__item');
  check('social: a link can be added', (await admin.locator('.social-manager__item').count()) === 1);

  await admin.fill('[aria-label="URL for link 1"]', 'https://github.com/verification-user');
  await admin.fill('[aria-label="Display name for link 1"]', 'Verification GitHub');
  await admin.fill('[aria-label="Handle for link 1"]', '@verification-user');
  await admin.fill('[aria-label="Description for link 1"]', 'Where the code lives.');
  check(
    'social: the row reflects what was typed',
    (await admin.locator('.social-manager__item .social-manager__title').first().innerText()).includes('Verification'),
  );

  await admin.click('button:has-text("Save draft")');
  const draftAfterAdd = await poll(async () => {
    const state = await readAdminContent();
    const links = state.body?.social?.draft?.links ?? null;
    return links?.length === 1 ? links : null;
  });
  check('social: the new link reaches the draft', draftAfterAdd !== null);
  check(
    'social: the handle is stored without the @',
    draftAfterAdd?.[0]?.handle === 'verification-user',
    String(draftAfterAdd?.[0]?.handle),
  );
  check(
    'social: the URL is stored normalised',
    draftAfterAdd?.[0]?.url === 'https://github.com/verification-user',
    String(draftAfterAdd?.[0]?.url),
  );

  const beforePublish = await readPublicSocial();
  check(
    'social: a saved draft is not public until it is published',
    beforePublish.social?.links?.length === 0,
    `${beforePublish.social?.links?.length ?? 'no'} public links`,
  );

  /* ------------------------------------------------------ unsafe URLs --- */

  await admin.fill('[aria-label="URL for link 1"]', 'javascript:alert(1)');
  await admin.click('button:has-text("Save draft")');
  const refused = await poll(async () => {
    const shown = await admin.locator('.social-manager__item .field__error').count();
    return shown > 0 ? shown : null;
  });
  check(
    'social: an unsafe scheme is refused in the editor, on the field',
    refused !== null,
    `${refused ?? 0} field error(s)`,
  );
  const afterRefusal = await readAdminContent();
  check(
    'social: the refused edit did not reach the draft',
    afterRefusal.body?.social?.draft?.links?.[0]?.url === 'https://github.com/verification-user',
    String(afterRefusal.body?.social?.draft?.links?.[0]?.url),
  );

  const apiRefusals = await admin.evaluate(async () => {
    const send = async (links) => {
      const response = await fetch('/api/admin/content/social', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ visible: true, heading: 'x', intro: '', links }),
      });
      const body = await response.json().catch(() => ({}));
      return { status: response.status, error: body.error, fields: body.fields };
    };
    const base = { platform: 'website', label: 'Site', url: '', handle: '', description: '', enabled: true };
    return {
      script: await send([{ ...base, url: 'javascript:alert(1)' }]),
      data: await send([{ ...base, url: 'data:text/html,<script>x</script>' }]),
      http: await send([{ ...base, url: 'http://example.com/you' }]),
      duplicate: await send([
        { ...base, url: 'https://example.com/me' },
        { ...base, url: 'https://example.com/me/' },
      ]),
    };
  });
  check(
    'social: the server refuses script, data and plain-http URLs itself',
    apiRefusals.script.status === 422 &&
      apiRefusals.data.status === 422 &&
      apiRefusals.http.status === 422 &&
      Boolean(apiRefusals.script.fields?.['links.0.url']),
    `script ${apiRefusals.script.status}, data ${apiRefusals.data.status}, http ${apiRefusals.http.status}`,
  );
  check(
    'social: a duplicate profile is refused by the server',
    apiRefusals.duplicate.status === 422 && Boolean(apiRefusals.duplicate.fields?.['links.1.url']),
    apiRefusals.duplicate.fields?.['links.1.url'] ?? `status ${apiRefusals.duplicate.status}`,
  );

  const anonymousWrite = await viewer.evaluate(async () => {
    const response = await fetch('/api/admin/content/social', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visible: true, heading: 'hijacked', intro: '', links: [] }),
    });
    return response.status;
  });
  check('social: an anonymous visitor cannot change the links', anonymousWrite === 401, `status ${anonymousWrite}`);

  /* ------------------------------------------------------- publish --- */

  await admin.fill('[aria-label="URL for link 1"]', 'https://github.com/verification-user');
  await admin.fill('[aria-label="Description for link 1"]', 'Where the code lives.');
  await admin.click('button:has-text("Publish changes")');

  const publishedOne = await poll(async () => {
    const body = await readPublicSocial();
    return body.social?.links?.length === 1 ? body.social.links : null;
  });
  check(
    'social: publishing puts the link on the public API',
    publishedOne?.[0]?.url === 'https://github.com/verification-user' && publishedOne?.[0]?.handle === 'verification-user',
    JSON.stringify(publishedOne?.[0] ?? {}),
  );

  await viewer.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await viewer.waitForSelector('[data-social-band]');
  const band = await viewer.evaluate(() => {
    const section = document.querySelector('[data-social-band]');
    const cards = [...(section?.querySelectorAll('.social-card') ?? [])];
    const first = cards[0];
    return {
      heading: document.querySelector('.social-band__title')?.textContent ?? '',
      count: cards.length,
      platforms: cards.map((card) => card.dataset.socialLink),
      names: cards.map((card) => card.querySelector('.social-card__name')?.textContent?.replace(/\s*\(opens in a new tab\)\s*/i, '').trim() ?? ''),
      href: first?.getAttribute('href') ?? '',
      target: first?.getAttribute('target') ?? '',
      rel: first?.getAttribute('rel') ?? '',
      icons: cards.map((card) => card.querySelector('svg') ? 1 : 0),
      // The band is decoration: it must never sit above a game or a control.
      abovePlayer: Boolean(section?.closest('.player')),
      // The neo-brutalist budget: a real border and a *hard* shadow (offset, no
      // blur, no spread), which is the same property the design audit asserts.
      border: first ? parseFloat(getComputedStyle(first).borderTopWidth) : 0,
      hardShadow: first
        ? getComputedStyle(first)
            .boxShadow.split(/,(?![^(]*\))/)
            .some((layer) => {
              const numbers = layer.trim().split(/\s+/).filter((part) => /^-?[\d.]+px$/.test(part)).map(parseFloat);
              return numbers.length === 4 && Math.abs(numbers[0]) >= 3 && numbers[2] === 0 && numbers[3] === 0;
            })
        : false,
      divider: section ? parseFloat(getComputedStyle(section).borderTopWidth) : 0
    };
  });
  check(
    'social: the public page renders one card per enabled link',
    band.count === 1 && band.platforms[0] === 'github' && band.heading.toLowerCase().includes('find me'),
    `${band.count} card(s): ${band.platforms.join(', ')}`,
  );
  check(
    'social: an external profile opens safely in a new tab',
    band.href === 'https://github.com/verification-user' && band.target === '_blank' && band.rel === 'noreferrer noopener',
    `${band.href} · target ${band.target || 'none'} · rel ${band.rel || 'none'}`,
  );
  check('social: every card carries its platform icon', band.icons.every((value) => value === 1));
  check(
    'social: the band is framed in the site’s brutalist language',
    band.border >= 2 && band.hardShadow === true && band.divider >= 3,
    `${band.border}px card border, hard shadow ${band.hardShadow}, ${band.divider}px divider`,
  );
  check('social: the label is the one that was typed', band.names[0] === 'Verification GitHub', band.names.join(', '));
  check('social: the band is not inside the game player', band.abovePlayer === false);
  // Scrolled into view first: an artifact nobody can read is not evidence.
  await viewer.locator('[data-social-band]').scrollIntoViewIfNeeded();
  await shot(viewer, 'social-band');

  /* ------------------------------------------ order, disable, re-enable */

  await admin.goto(`${BASE}/admin/social`, { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('.social-manager__item');
  await admin.selectOption('[data-social-platform-picker]', 'itch');
  await admin.click('[data-add-social]');
  await admin.fill('[aria-label="URL for link 2"]', 'https://verification-user.itch.io');
  await admin.fill('[aria-label="Display name for link 2"]', 'Verification itch.io');
  check('social: a second link can be added', (await admin.locator('.social-manager__item').count()) === 2);

  await admin.click('button[aria-label="Move Verification itch.io up"]');
  const orderInEditor = await admin
    .locator('.social-manager__item .social-manager__title')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));
  check(
    'social: reordering happens in the editor',
    orderInEditor[0] === 'Verification itch.io' && orderInEditor[1] === 'Verification GitHub',
    orderInEditor.join(' → '),
  );

  await shot(admin, 'social-manager-links');
  await admin.click('button:has-text("Publish changes")');
  const publishedTwo = await poll(async () => {
    const body = await readPublicSocial();
    return body.social?.links?.length === 2 ? body.social.links : null;
  });
  check(
    'social: the saved order is the published order',
    publishedTwo?.[0]?.platform === 'itch' && publishedTwo?.[1]?.platform === 'github',
    (publishedTwo ?? []).map((entry) => entry.platform).join(' → '),
  );

  await viewer.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await viewer.waitForSelector('[data-social-band]');
  const publicOrder = await viewer
    .locator('.social-card')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.socialLink));
  check(
    'social: the public page shows them in that same order',
    publicOrder.length === 2 && publicOrder[0] === 'itch' && publicOrder[1] === 'github',
    publicOrder.join(' → '),
  );

  await admin.goto(`${BASE}/admin/social`, { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('.social-manager__item');
  await admin.uncheck('[aria-label="Show Verification GitHub on the public site"]');
  await admin.click('button:has-text("Publish changes")');
  const afterDisable = await poll(async () => {
    const body = await readPublicSocial();
    const links = body.social?.links ?? [];
    return links.length === 2 && links[1]?.enabled === false ? links : null;
  });
  check(
    'social: disabling a link keeps it configured',
    afterDisable !== null,
    afterDisable ? `${afterDisable.filter((entry) => entry.enabled).length} enabled of ${afterDisable.length}` : 'not stored',
  );

  await viewer.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await viewer.waitForSelector('[data-social-band]');
  const visibleAfterDisable = await viewer
    .locator('.social-card')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.socialLink));
  check(
    'social: a disabled link disappears from the public site',
    visibleAfterDisable.length === 1 && visibleAfterDisable[0] === 'itch',
    visibleAfterDisable.join(', ') || 'none',
  );

  await admin.goto(`${BASE}/admin/social`, { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('.social-manager__item');
  await admin.check('[aria-label="Show Verification GitHub on the public site"]');
  await admin.click('button:has-text("Publish changes")');
  const afterEnable = await poll(async () => {
    const body = await readPublicSocial();
    return body.social?.links?.every((entry) => entry.enabled) ? body.social.links : null;
  });
  check('social: it can be switched back on without retyping it', afterEnable?.length === 2);

  /* ------------------------------------------------ delete + confirmation */

  await admin.click('button[aria-label="Delete Verification itch.io"]');
  await admin.waitForSelector('.modal[role="alertdialog"]');
  const confirmCopy = await admin.locator('.modal__title').innerText();
  check(
    'social: deleting asks first, and names the link',
    /delete/i.test(confirmCopy) && (await admin.locator('.modal__body').innerText()).includes('Verification itch.io'),
    confirmCopy,
  );
  await admin.click('.modal button:has-text("Delete link")');
  check(
    'social: cancelling is impossible to confuse with confirming',
    (await admin.locator('.modal[role="alertdialog"]').count()) === 0 &&
      (await admin.locator('.social-manager__item').count()) === 1,
  );

  await admin.click('button:has-text("Publish changes")');
  const afterDelete = await poll(async () => {
    const body = await readPublicSocial();
    return body.social?.links?.length === 1 ? body.social.links : null;
  });
  check(
    'social: the deleted link is gone from the public site',
    afterDelete?.[0]?.platform === 'github',
    (afterDelete ?? []).map((entry) => entry.platform).join(', ') || 'none',
  );

  /* ------------------------------------ reordering, mobile, focus, layout */

  // Three links is where a phone's grid has to wrap, so the layout checks run
  // with a fuller band than the one-link case above.
  await admin.goto(`${BASE}/admin/social`, { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('.social-manager__item');
  for (const [platform, url, name] of [
    ['itch', 'https://verification-user.itch.io', 'Verification itch.io'],
    ['linkedin', 'https://linkedin.com/in/verification-user', 'Verification LinkedIn'],
    ['email', 'verification@example.test', 'Verification email'],
  ]) {
    await admin.selectOption('[data-social-platform-picker]', platform);
    await admin.click('[data-add-social]');
    const index = await admin.locator('.social-manager__item').count();
    await admin.fill(`[aria-label="URL for link ${index}"]`, url);
    await admin.fill(`[aria-label="Display name for link ${index}"]`, name);
  }
  await admin.click('button:has-text("Publish changes")');

  const fullBand = await poll(async () => {
    const body = await readPublicSocial();
    return body.social?.links?.length === 4 ? body.social.links : null;
  });
  check(
    'social: a mailto link is stored as an address, not a URL',
    fullBand?.[3]?.url === 'mailto:verification@example.test' && fullBand?.[3]?.platform === 'email',
    String(fullBand?.[3]?.url),
  );

  /* -------------------------------------------- persistence, fresh session */

  // The links are stored server-side, not in the editor's memory and not in the
  // browser. Two independent proofs: the dashboard re-reads the same document in
  // the same order after a full reload, and a brand-new profile — no cookies, no
  // session, no storage — sees the same four cards. Anything that lived only in
  // the page would fail both.
  await admin.reload({ waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('.social-manager__item');
  const afterReloadTitles = await admin
    .locator('.social-manager__item .social-manager__title')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));
  check(
    'social: the saved links survive a dashboard reload, in the same order',
    afterReloadTitles.length === 4 && afterReloadTitles[3] === 'Verification email',
    afterReloadTitles.join(' → ') || 'none',
  );

  const visitorSession = await newContext({ viewport: { width: 1366, height: 900 } });
  const visitorPage = await visitorSession.newPage();
  await visitorPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await visitorPage.waitForSelector('[data-social-band]');
  const visitorCards = await visitorPage
    .locator('.social-card')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.socialLink));
  check(
    'social: a brand-new visitor session sees the same links',
    visitorCards.length === 4 && visitorCards[0] === 'github',
    `${visitorCards.length} card(s): ${visitorCards.join(', ') || 'none'}`,
  );
  await visitorSession.close();

  await viewer.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await viewer.waitForSelector('[data-social-band]');

  // Reached with the Tab key rather than with `.focus()`: a programmatic focus
  // does not reliably match `:focus-visible`, and a check that cannot fail is
  // not a check. Thirty-five presses is the real order of the page (skip link,
  // header, hero, cards, band), and the loop stops as soon as it is there.
  let reachedCard = false;
  for (let press = 0; press < 40 && !reachedCard; press += 1) {
    await viewer.keyboard.press('Tab');
    reachedCard = await viewer.evaluate(() => document.activeElement?.classList.contains('social-card') ?? false);
  }

  const focusState = await viewer.evaluate(async () => {
    const card = document.activeElement;
    if (!(card instanceof HTMLElement)) return null;
    // The ring is transitioned, so read it once it has settled rather than
    // mid-interpolation — otherwise the measurement is of the resting shadow.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const style = getComputedStyle(card);
    return {
      shadow: style.boxShadow,
      matchesFocusVisible: card.matches(':focus-visible'),
      name: card.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      height: Math.round(card.getBoundingClientRect().height),
    };
  });
  check('social: the cards are reachable with the keyboard', reachedCard);
  check(
    'social: a card shows a visible focus ring when focused',
    // The ring is the shared focus token: the page background, then the accent.
    focusState?.matchesFocusVisible === true && /5px/.test(focusState?.shadow ?? ''),
    focusState?.shadow ?? 'no box-shadow',
  );
  check(
    'social: the accessible name says where the link goes and that it leaves the site',
    /Verification/.test(focusState?.name ?? '') && /opens in a new tab/i.test(focusState?.name ?? ''),
    focusState?.name ?? 'no name',
  );

  const phone = await newContext({ viewport: { width: 390, height: 780 } });
  const phonePage = await phone.newPage();
  await phonePage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await phonePage.waitForSelector('.social-card');
  const phoneBand = await phonePage.evaluate(() => {
    const cards = [...document.querySelectorAll('.social-card')];
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      columns: new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left))).size,
      tapHeight: Math.round(cards[0]?.getBoundingClientRect().height ?? 0),
      heading: Math.round(document.querySelector('.social-band__title')?.getBoundingClientRect().height ?? 0),
    };
  });
  check(
    'social: the band does not overflow a 390px phone',
    phoneBand.overflow <= 1,
    `${phoneBand.overflow}px of overflow`,
  );
  check(
    'social: the cards stack on a phone and stay big enough to tap',
    phoneBand.columns === 1 && phoneBand.tapHeight >= 44,
    `${phoneBand.columns} column(s), ${phoneBand.tapHeight}px tall`,
  );
  await phonePage.locator('[data-social-band]').scrollIntoViewIfNeeded();
  await shot(phonePage, 'social-band-phone');
  await phone.close();

  // The band holds four cards here, which is the widest it gets before it has to
  // wrap — the widths below are the ones the design is checked at everywhere else.
  for (const width of [320, 375, 768, 1024, 1366, 1920]) {
    const sized = await newContext({ viewport: { width, height: 900 } });
    const sizedPage = await sized.newPage();
    await sizedPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await sizedPage.waitForSelector('.social-card');
    const metrics = await sizedPage.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      columns: new Set(
        [...document.querySelectorAll('.social-card')].map((card) => Math.round(card.getBoundingClientRect().left)),
      ).size,
    }));
    check(
      `social: the band fits at ${width}px`,
      metrics.overflow <= 1 && metrics.columns >= 1,
      `${metrics.overflow}px of overflow, ${metrics.columns} column(s)`,
    );
    await sized.close();
  }

  const wideBand = await viewer.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    columns: new Set([...document.querySelectorAll('.social-card')].map((card) => Math.round(card.getBoundingClientRect().top))).size,
  }));
  check(
    'social: the cards sit in one row on a desktop and nothing overflows',
    wideBand.overflow <= 1 && wideBand.columns === 1,
    `${wideBand.columns} row(s), ${wideBand.overflow}px of overflow`,
  );

  /* --------------------------------------- coexistence with the rest ---- */

  // The band lives on the same page as the opening sequence and the typed
  // headline, so the honest check is that both still finish on that page.
  const coexistence = await viewer.evaluate(async () => {
    const started = Date.now();
    const heading = document.querySelector('#hero-heading');
    while (Date.now() - started < 12000) {
      if (heading?.getAttribute('data-typed') === 'done') break;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return {
      typed: heading?.getAttribute('data-typed') ?? 'missing',
      heading: document.querySelector('#hero-heading .visually-hidden')?.textContent ?? '',
      band: Boolean(document.querySelector('[data-social-band]')),
      boot: Boolean(document.querySelector('[data-boot]')),
      scrollLocked: getComputedStyle(document.body).overflow,
    };
  });
  check(
    'social: the typed headline still completes on the same page',
    coexistence.typed === 'done' && coexistence.heading === 'SMALL GAMES. BIG IDEAS.',
    `${coexistence.typed} · "${coexistence.heading}"`,
  );
  check(
    'social: the opening card has left and nothing is locked',
    coexistence.boot === false && coexistence.scrollLocked !== 'hidden',
    `boot ${coexistence.boot}, body overflow ${coexistence.scrollLocked}`,
  );

  // Playback still works with a full band on the same page. The player itself is
  // proven earlier in the run; this proves the two coexist.
  await viewer.goto(`${BASE}/games/verification-run-public`, { waitUntil: 'domcontentloaded' });
  await viewer.waitForSelector('.player');
  await viewer.click('.player button:has-text("Play")');
  const playerWithBand = await viewer
    .waitForSelector('.player iframe', { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check(
    'social: a game still starts with the band on the page',
    playerWithBand && (await viewer.locator('[data-social-band]').count()) === 1,
    `${await viewer.locator('.player iframe').count()} frame(s)`,
  );

  /* ------------------------------------------- contact / auth separation */

  const securityBefore = await admin.evaluate(() => fetch('/api/admin/security/state').then((r) => r.json()));

  const contactSaved = await admin.evaluate(async (contact) => {
    await fetch('/api/admin/content/contact', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...contact, email: 'verify-contact@example.test' }),
    });
    const response = await fetch('/api/admin/content/contact/publish', { method: 'POST' });
    return { status: response.status, body: await response.json() };
  }, originalContact);
  check('contact: the public address can be changed and published', contactSaved.status === 200);

  const publicContact = await viewer.evaluate(() => fetch('/api/content/contact').then((r) => r.json()));
  check('contact: the public address is served publicly', publicContact.contact.email === 'verify-contact@example.test', publicContact.contact.email);

  const securityAfterContact = await admin.evaluate(() => fetch('/api/admin/security/state').then((r) => r.json()));
  check(
    'separation: changing the contact address leaves the authentication address alone',
    securityAfterContact.security.authEmail.masked === securityBefore.security.authEmail.masked,
    `${securityBefore.security.authEmail.masked} → ${securityAfterContact.security.authEmail.masked}`,
  );

  const conflict = await admin.evaluate(async ([contact, privateEmail]) => {
    const response = await fetch('/api/admin/content/contact', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...contact, email: privateEmail }),
    });
    return { status: response.status, body: await response.json() };
  }, [originalContact, OWNER_EMAIL]);
  check(
    'separation: the private authentication address is refused as a public one',
    conflict.status === 422 && conflict.body.error === 'email_conflict',
    `status ${conflict.status} ${conflict.body.error}`,
  );

  const maskedIsHidden = JSON.stringify(publicContact).includes(OWNER_EMAIL);
  check('separation: the private address never appears in public content', !maskedIsHidden);

  /* ------------------------------------------ verification challenges --- */

  // A fresh browser context with the owner identity but no verified session.
  const identityOnly = await newContext({ extraHTTPHeaders: { 'x-dev-owner': DEV_OWNER } });
  const identityPage = await identityOnly.newPage();
  await identityPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const denied = await identityPage.evaluate(async () => {
    const games = await fetch('/api/admin/games');
    const content = await fetch('/api/admin/content');
    const events = await fetch('/api/admin/security/events');
    return { games: games.status, content: content.status, events: events.status };
  });
  check(
    'security: admin data needs a verified session, not just identity',
    denied.games === 401 && denied.content === 401 && denied.events === 401,
    JSON.stringify(denied),
  );
  const anonymousContentWrite = await identityPage.evaluate(async () => {
    const response = await fetch('/api/admin/content/about', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ heading: 'hijacked' }),
    });
    return response.status;
  });
  check('security: an unverified session cannot edit site content', anonymousContentWrite === 401, `status ${anonymousContentWrite}`);
  await identityOnly.close();

  // The gate that signed the harness in asked for a code seconds ago, so the
  // login cooldown is live. Clear it (and start this phase with a clean audit
  // trail, since the failed-code check below reads the trail) before the checks
  // that need a real challenge.
  await clearRateLimits('the login cooldown', { clearAuditTrail: true });

  const challenge = await admin.evaluate(async ([email, password]) => {
    const response = await fetch('/api/admin/auth/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'login', email, password }),
    });
    return { status: response.status, body: await response.json() };
  }, [OWNER_EMAIL, OWNER_PASSWORD]);
  check('security: a code can be requested with the right password', challenge.status === 200, `status ${challenge.status}`);
  check('security: the code is sent to the masked authentication address', challenge.body.sentTo?.includes('@'), challenge.body.sentTo);

  const wrongCode = await admin.evaluate(async (id) => {
    const response = await fetch('/api/admin/auth/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: id, code: '000000' }),
    });
    return { status: response.status, body: await response.json() };
  }, challenge.body.challengeId);
  check('security: a wrong code is rejected', wrongCode.status === 401 && wrongCode.body.error === 'bad_code', `status ${wrongCode.status}`);
  check('security: the attempt budget is reported', /attempt/i.test(JSON.stringify(wrongCode.body.fields ?? {})), JSON.stringify(wrongCode.body.fields ?? {}));

  const rightCode = await admin.evaluate(async ([id, code]) => {
    const response = await fetch('/api/admin/auth/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: id, code }),
    });
    return { status: response.status, body: await response.json() };
  }, [challenge.body.challengeId, challenge.body.localCode]);
  check('security: the correct code is accepted', rightCode.status === 200 && rightCode.body.verified === true, `status ${rightCode.status}`);

  const replay = await admin.evaluate(async ([id, code]) => {
    const response = await fetch('/api/admin/auth/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: id, code }),
    });
    return { status: response.status, body: await response.json() };
  }, [challenge.body.challengeId, challenge.body.localCode]);
  check('security: a code cannot be replayed', replay.status === 410 && replay.body.error === 'challenge_spent', `status ${replay.status} ${replay.body.error}`);

  const cooldown = await admin.evaluate(async ([email, password]) => {
    const response = await fetch('/api/admin/auth/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'login', email, password }),
    });
    return { status: response.status, body: await response.json(), retryAfter: response.headers.get('retry-after') };
  }, [OWNER_EMAIL, OWNER_PASSWORD]);
  check('security: the resend cooldown is enforced', cooldown.status === 429 && cooldown.body.error === 'resend_too_soon', `status ${cooldown.status}`);
  check('security: the cooldown tells the client when to retry', Number(cooldown.retryAfter) > 0, `retry-after ${cooldown.retryAfter}`);

  const badPassword = await admin.evaluate(async () => {
    const response = await fetch('/api/admin/auth/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'password-change', password: 'definitely-not-the-password' }),
    });
    return { status: response.status, body: await response.json() };
  });
  check('security: the wrong password never triggers a code', badPassword.status === 401 && badPassword.body.error === 'bad_password', `status ${badPassword.status}`);

  /* ------------------------------------------------- password rotation -- */

  const noFreshCode = await admin.evaluate(async (password) => {
    const response = await fetch('/api/admin/security/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: password, newPassword: 'Rotated-Owner-77!x', confirm: 'Rotated-Owner-77!x' }),
    });
    return { status: response.status, body: await response.json() };
  }, OWNER_PASSWORD);
  check(
    'security: a password change without a fresh code is refused',
    noFreshCode.status === 403 && noFreshCode.body.error === 'fresh_verification_required',
    `status ${noFreshCode.status} ${noFreshCode.body.error}`,
  );

  const weakPassword = await admin.evaluate(async ([password, next]) => {
    const started = await fetch('/api/admin/auth/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'password-change', password }),
    });
    const challengeBody = await started.json();
    await fetch('/api/admin/auth/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: challengeBody.challengeId, code: challengeBody.localCode ?? '' }),
    });
    const response = await fetch('/api/admin/security/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: password, newPassword: next, confirm: next }),
    });
    return { status: response.status, body: await response.json() };
  }, [OWNER_PASSWORD, 'weak']);
  check('security: a weak new password is rejected', weakPassword.status === 422, `status ${weakPassword.status}`);

  await clearRateLimits('the password-change cooldown');
  const rotated = await rotatePassword(admin, OWNER_PASSWORD, ROTATED_PASSWORD);
  check('security: a verified password change succeeds', rotated.step === 'done' && rotated.status === 200, JSON.stringify(rotated).slice(0, 160));
  check(
    'security: other sessions are revoked by the change',
    typeof rotated.response?.revokedSessions === 'number',
    `${rotated.response?.revokedSessions} revoked`,
  );

  await clearRateLimits('the login cooldown');
  const stalePassword = await admin.evaluate(async ([email, password]) => {
    const response = await fetch('/api/admin/auth/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'login', email, password }),
    });
    return response.status;
  }, [OWNER_EMAIL, OWNER_PASSWORD]);
  check('security: the previous password no longer works', stalePassword === 401, `status ${stalePassword}`);

  await clearRateLimits('the password-change cooldown');
  const restored = await rotatePassword(admin, ROTATED_PASSWORD, OWNER_PASSWORD);
  check('security: the password can be rotated back', restored.step === 'done' && restored.status === 200, JSON.stringify(restored).slice(0, 160));
  const stillWorks = await admin.evaluate(() => fetch('/api/admin/games').then((r) => r.status));
  check('security: the current device stays signed in after a change', stillWorks === 200, `status ${stillWorks}`);

  /* --------------------------------------- authentication address change */

  await clearRateLimits('the email-change cooldown');
  const addressBefore = await admin.evaluate(() => fetch('/api/admin/security/state').then((r) => r.json()));
  /*
   * A deployment that sets OWNER_OTP_EMAIL pins the destination on purpose, so
   * the dashboard cannot be used to redirect codes. That is the safer
   * configuration, and it must be tested as a locked state rather than skipped:
   * the change endpoint has to refuse it and write nothing. Installations that
   * leave the variable unset keep the full change/revert flow below.
   */
  const pinnedOtp = addressBefore.security.authEmail.managed === true;

  if (pinnedOtp) {
    const changesBefore = await admin
      .evaluate(() => fetch('/api/admin/security/events').then((r) => r.json()))
      .then((body) => (body.events ?? []).filter((event) => event.kind === 'auth-email.changed').length);

    const refusedChange = await admin.evaluate(async ([password, next]) => {
      const response = await fetch('/api/admin/security/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newEmail: next, password }),
      });
      return { status: response.status, body: await response.json() };
    }, [OWNER_PASSWORD, SECOND_EMAIL]);
    check(
      'separation: a deployment-pinned address cannot be moved from the dashboard',
      refusedChange.status === 409 && refusedChange.body.error === 'managed_email',
      `status ${refusedChange.status} ${refusedChange.body.error ?? ''}`,
    );

    const addressAfter = await admin.evaluate(() => fetch('/api/admin/security/state').then((r) => r.json()));
    check(
      'separation: the pinned address survives the attempt unchanged',
      addressAfter.security.authEmail.managed === true &&
        addressAfter.security.authEmail.masked === addressBefore.security.authEmail.masked,
      `${addressBefore.security.authEmail.masked} → ${addressAfter.security.authEmail.masked}`,
    );
    check(
      'separation: a refused change never touches the public contact address',
      addressAfter.security.publicContactEmail === addressBefore.security.publicContactEmail,
      `${addressBefore.security.publicContactEmail} → ${addressAfter.security.publicContactEmail}`,
    );

    const changesAfter = await admin
      .evaluate(() => fetch('/api/admin/security/events').then((r) => r.json()))
      .then((body) => (body.events ?? []).filter((event) => event.kind === 'auth-email.changed').length);
    check(
      'separation: a refused change is not recorded as a change',
      changesAfter === changesBefore,
      `${changesBefore} → ${changesAfter}`,
    );
  } else {
    const startChange = await admin.evaluate(async ([password, next]) => {
      const response = await fetch('/api/admin/security/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newEmail: next, password }),
      });
      return { status: response.status, body: await response.json() };
    }, [OWNER_PASSWORD, SECOND_EMAIL]);
    check('separation: the new address is confirmed before it takes over', startChange.status === 200 && startChange.body.sentTo !== addressBefore.security.authEmail.masked, `sent to ${startChange.body.sentTo}`);

    const applyChange = await admin.evaluate(async ([id, code]) => {
      const response = await fetch('/api/admin/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeId: id, code }),
      });
      return { status: response.status, body: await response.json() };
    }, [startChange.body.challengeId, startChange.body.localCode]);
    check('separation: the confirmed address becomes the authentication address', applyChange.status === 200 && Boolean(applyChange.body.appliedEmail), `status ${applyChange.status}`);

    const addressAfter = await admin.evaluate(() => fetch('/api/admin/security/state').then((r) => r.json()));
    check(
      'separation: the authentication address actually changed',
      addressAfter.security.authEmail.masked !== addressBefore.security.authEmail.masked,
      `${addressBefore.security.authEmail.masked} → ${addressAfter.security.authEmail.masked}`,
    );
    check(
      'separation: changing it never changes the public contact address',
      addressAfter.security.publicContactEmail === addressBefore.security.publicContactEmail,
      `${addressBefore.security.publicContactEmail} → ${addressAfter.security.publicContactEmail}`,
    );

    // The move to a new address was seconds ago; the revert needs a fresh window.
    await clearRateLimits('the email-change cooldown');
    const revertStart = await admin.evaluate(async ([password, next]) => {
      const response = await fetch('/api/admin/security/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newEmail: next, password }),
      });
      return await response.json();
    }, [OWNER_PASSWORD, OWNER_EMAIL]);
    await admin.evaluate(async ([id, code]) => {
      await fetch('/api/admin/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeId: id, code }),
      });
    }, [revertStart.challengeId, revertStart.localCode]);
    const reverted = await admin.evaluate(() => fetch('/api/admin/security/state').then((r) => r.json()));
    check('separation: the masked address is back to the one the run started from', reverted.security.authEmail.masked === addressBefore.security.authEmail.masked);

    const activity = await admin.evaluate(() => fetch('/api/admin/security/events').then((r) => r.json()));
    check('security: address changes are recorded', (activity.events ?? []).some((event) => event.kind === 'auth-email.changed'));
  }
  // Proven through the app's own rule rather than by guessing at a mask: the
  // contact editor refuses to publish whatever the authentication address
  // currently is, so the refusal after the revert means verification points at
  // the configured address again.
  const isConfiguredAgain = await admin.evaluate(async ([contact, privateEmail]) => {
    const response = await fetch('/api/admin/content/contact', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...contact, email: privateEmail }),
    });
    const body = await response.json();
    return { status: response.status, error: body.error };
  }, [originalContact, OWNER_EMAIL]);
  check(
    'separation: the address is back to the configured one',
    isConfiguredAgain.status === 422 && isConfiguredAgain.error === 'email_conflict',
    `status ${isConfiguredAgain.status} ${isConfiguredAgain.error}`,
  );

  /* ------------------------------------------ recovery + activity feed -- */

  const recovery = await admin.evaluate(() => fetch('/api/admin/security/recovery').then((r) => r.json()));
  check('security: recovery guidance is server-provided', (recovery.recovery?.steps?.length ?? 0) >= 3);
  check('recovery: no public password reset is offered', !JSON.stringify(recovery).toLowerCase().includes('reset link'));

  const activity = await admin.evaluate(() => fetch('/api/admin/security/events').then((r) => r.json()));
  const kinds = (activity.events ?? []).map((event) => event.kind);
  check('security: password changes are recorded', kinds.includes('password.changed'), kinds.slice(0, 8).join(', '));
  check('security: failed codes are recorded', kinds.includes('challenge.failed'));

  /* ------------------------------------- restore content, revoke sessions */

  await admin.evaluate(async ([about, contact, social]) => {
    await fetch('/api/admin/content/about/avatar', { method: 'DELETE' });
    await fetch('/api/admin/content/about', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(about),
    });
    await fetch('/api/admin/content/about/publish', { method: 'POST' });
    await fetch('/api/admin/content/contact', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(contact),
    });
    await fetch('/api/admin/content/contact/publish', { method: 'POST' });
    await fetch('/api/admin/content/social', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(social),
    });
    await fetch('/api/admin/content/social/publish', { method: 'POST' });
  }, [originalAbout, originalContact, originalSocial]);
  const restoredContent = await viewer.evaluate(() => fetch('/api/content/about').then((r) => r.json()));
  check('content: the original content is restored after the run', restoredContent.about.headline === originalAbout.headline);
  const restoredSocial = await fetch(`${BASE}/api/content/social`).then((r) => r.json());
  check(
    'social: the original links are restored after the run',
    (restoredSocial.social?.links?.length ?? -1) === originalSocial.links.length,
    `${restoredSocial.social?.links?.length ?? 'no'} links`,
  );

  const revokeAll = await admin.evaluate(() =>
    fetch('/api/admin/security/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'all' }),
    }).then((r) => r.json()),
  );
  check('security: signing out everywhere succeeds', revokeAll.clearedCurrent === true);
  const afterRevoke = await admin.evaluate(() => fetch('/api/admin/games').then((r) => r.status));
  check('security: the revoked session can no longer read admin data', afterRevoke === 401, `status ${afterRevoke}`);

  // Signing back in is a fresh login: the cooldown from the gate at the start of
  // this section would otherwise refuse the code the flow needs.
  await clearRateLimits('the sign-in flow', { clearAuditTrail: true });
  await admin.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  const reGateMode = await completeGate(admin);
  check('security: a new code restores access', (await admin.locator('.admin-nav').count()) === 1, `gate mode: ${reGateMode}`);

  await viewerContext.close();

  /* ------------------------------------------ remove the public fixture */

  // The published game existed only for this run. Purging it here keeps the
  // local site in the state the owner actually has: an honest empty arcade.
  const fixtureRemoval = await admin.evaluate(async (fixtureSlug) => {
    const list = await fetch('/api/admin/games').then((response) => response.json());
    const game = (list.games ?? []).find((entry) => entry.slug === fixtureSlug);
    if (!game) return 'missing';
    const response = await fetch(`/api/admin/games/${game.id}?mode=purge`, { method: 'DELETE' });
    return response.status;
  }, PUBLIC_FIXTURE_SLUG);
  check('cleanup: the temporary public game is purged', fixtureRemoval === 200, String(fixtureRemoval));
  const catalogueAfterCleanup = await fetch(`${BASE}/api/catalogue`).then((response) => response.json());
  check(
    'cleanup: the public catalogue is empty again',
    catalogueAfterCleanup.games.length === 0,
    `${catalogueAfterCleanup.games.length} games`,
  );

  /* ------------------------------------------------ measured performance */

  // Measured on a cold load *with* the decoration layer running, through the same
  // observer APIs a Lighthouse report reads. No Lighthouse is installed here, so
  // no Lighthouse score is claimed — only these numbers.
  const perfContext = await newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  await perfContext.addInitScript(() => {
    window.__perf = { lcp: 0, cls: 0 };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__perf.lcp = Math.max(window.__perf.lcp, entry.startTime);
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__perf.cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {
      // Observers are best-effort; a browser that lacks one reports zero and the
      // checks below fail loudly rather than silently passing.
    }
  });
  const perfPage = await perfContext.newPage();
  await perfPage.goto(`${BASE}/`, { waitUntil: 'load' });
  await perfPage.waitForSelector('.deco-field--fixed .deco');
  await perfPage.waitForTimeout(1200);
  const perf = await perfPage.evaluate(() => {
    const entries = performance.getEntriesByType('resource');
    return {
      lcp: window.__perf.lcp,
      cls: window.__perf.cls,
      transfer: entries.reduce((sum, entry) => sum + (entry.transferSize ?? 0), 0),
      requests: entries.length,
    };
  });
  await perfContext.close();
  check('perf: largest contentful paint is under 2.5 s', perf.lcp > 0 && perf.lcp < 2500, `${Math.round(perf.lcp)} ms`);
  check('perf: cumulative layout shift stays negligible', perf.cls < 0.05, perf.cls.toFixed(4));
  check(
    'perf: first-load transfer stays modest',
    perf.transfer > 0 && perf.transfer < 700_000,
    `${Math.round(perf.transfer / 1024)} kB over ${perf.requests} requests`,
  );

  /* ------------------------------------------------------ console hygiene */

  const ignorable = /favicon|net::ERR_|Failed to load resource/i;
  const realErrors = consoleErrors.filter((message) => !ignorable.test(message));
  check('console: no uncaught errors during the run', realErrors.length === 0, realErrors.slice(0, 4).join(' | '));

  await adminContext.close();
  await browser.close();
}

/**
 * The report always prints, including when a step throws: a harness that only
 * reports on a clean run hides exactly the failures worth seeing.
 */
function report(crash) {
  const width = Math.max(0, ...results.map((entry) => entry.name.length));
  console.log('\nVerification report\n' + '='.repeat(width + 12));
  for (const entry of results) {
    console.log(`${entry.passed ? 'PASS' : 'FAIL'}  ${entry.name.padEnd(width)}  ${entry.detail}`.trimEnd());
  }
  if (crash) console.log(`\n⚠ Crashed before finishing: ${crash}`);
  console.log(`\n${results.length - failures}/${results.length} checks passed.`);
  console.log(`Screenshots: ${SHOTS}/`);
}

main()
  .then(() => {
    report(null);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    report(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
