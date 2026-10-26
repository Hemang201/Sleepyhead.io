# Verification report

Everything below was run on this machine against the code in this repository.
Nothing here is a claimed score that was not measured, and the numbers are from
the last run of each command, not from memory.

## Commands run

| Command | Result |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit` for the app and for the Worker) | passes, no errors |
| `npm run lint` (ESLint flat config, TypeScript + React hooks) | passes, 0 errors / 0 warnings |
| `npm test` (Vitest) | **198/198 tests pass** across 11 files |
| `npm run build` + `npm run build:worker` | passes; emits `dist/` and `dist-worker/index.js` |
| `npm run db:migrate` + `npm run seed` (local D1 + R2 emulation) | passes; the seed leaves the public catalogue empty |
| `BASE_URL=http://127.0.0.1:8790 npm run verify` | **389/389 checks pass** — empty state, the first-load experience, catalogue and revalidation, a temporary published game connected to an itch.io embed (URL validation in the form and the API, storage, preview without publishing, cover art and screenshots, the publish gate, iframe source/sandbox/allow, click and keyboard input, fullscreen, resize without reload, a stalled embed falling back to itch.io, editing without a redeploy, unpublish and delete), the bouncing decoration field (including measured turn-arounds at both viewport edges), the ambient music player and volume slider, the dashboard music editor (upload to R2, replace, disable, remove, refused uploads, anonymous refusal, bundled track restored), the header at 360–1440 px, owner sign-in with the emailed code, site content, social links, 9 responsive widths, neutral light/dark surfaces on the public site and the dashboard, and the performance bounds |
| `npm run audit:security` | **66/66 server-side security checks pass** (run on its own — see below) |
| `npm run audit:design` | **42/42 responsive overflow checks pass** on the empty arcade; detailed card/player style checks require a published game and were intentionally skipped (their geometry is covered by `npm run verify` against a published itch.io listing) |

`npm run audit:security` talks to the same Worker over HTTP with no browser: every
protected admin route is called without a session, with a forged cookie and with
headers claiming to be the owner, and the row counts are compared before and after
to prove nothing was written. It then exercises the password and code lifecycle.
It shares the local security state with the browser suite, so **run it alone**:
overlapping runs reset each other's sessions and rate-limit windows.

`npm run verify` drives the real Worker. It first proves the honest empty state
(no cards, no Play action, no invented count, the deliberate message), then
creates one temporary published game through the admin API, connects a synthetic
itch.io embed, uploads cover art and screenshots, and uses it for the catalogue,
library, detail, player and
sitemap checks. It also creates a second game through the dashboard, publishes
it, unpublishes and deletes it, edits and publishes site content, manages the
social links (add, edit, reorder, disable, delete, preview, publish) and follows
them to the public band, and completes the full owner sign-in with email
verification (password → emailed code → dashboard). At the end it purges the
temporary public game and asserts the catalogue is empty again. It needs a
running server (`npm run dev:full`) and a Chromium-based browser
(`playwright-core` ships the driver only; set `BROWSER_PATH` if yours is not at
the default location).

## Empty catalogue (the current public state)

Before the owner publishes a first game, the site must look finished without
pretending to have content. The browser suite asserts, on the real running site:

- `/api/catalogue` returns an empty list, not an error and not a fixture;
- a failed catalogue request is a separate, retryable error state with
  `role="alert"` — the empty state is never shown for a failure, and retrying
  lands in the empty state once the request succeeds;
- the home page renders `.arcade-empty` with the copy
  **“The arcade is getting ready.”** and **“My first browser game is in
development. Check back soon.”**;
- there are zero `.game-card` elements and zero Play Now actions anywhere on the
  page, and no “Pipeline Check” text;
- the library page shows the same deliberate empty state and hides the filter
  bar/counts, rather than pretending there is something to search;
- after a game is published through the real admin flow, the home and library
  render its real card without a rebuild, and after that game is purged the
  catalogue returns to empty.

The catalogue rule lives in `isCatalogueGame` (`src/shared/catalogue.ts`) and is
applied by `listPublicGames` (`worker/lib/db.ts`): a game must be `published`
*and* have a saved, valid itch.io embed. Drafts, archives, announcements and
published rows with no player never enter the public list.

The public fixture's itch.io embed id is synthetic, and the player checks fulfil
that request with a small local document. That proves the frame this site builds —
its source, permissions, sizing, focus and fallback — but not itch.io's own player;
the real service was checked separately by loading a live `embed-upload` game in a
browser (see the report accompanying this change).

## What the unit suite covers (198 tests, 11 files)

- `tests/site-content.test.ts` (27) — the content layer: tag stripping and control
  characters in every stored string, per-field length clamps, list limits,
  supported-vs-unknown section ids, milestone entries, unsafe call-to-action
  destinations, avatar keys that are not ours, validation messages for the About
  and Contact editors, `maskEmail` never returning the whole address, `isSafeUrl`
  refusing `javascript:`/protocol-relative URLs, and `renderInline` escaping
  everything it does not deliberately format.
- `tests/owner-security.test.ts` (21) — the password policy (length, letter,
  number, symbol, common patterns, the owner's own address), the documented policy
  values, every labelled security event, PBKDF2 round-trips with a fresh salt and a
  work factor that is expensive to brute force, six-digit code generation and
  unpredictability, codes hashed against their challenge id, and signed session
  cookies rejecting tampered ids, timestamps and foreign secrets.
- `tests/email-provider.test.ts` (11) — provider selection: the loopback catcher is
  refused for a non-loopback request *and* for a loopback request with a deployed
  `APP_ORIGIN`, allowed only in local development, never used on a deployed origin,
  Resend selected only with a key **and** a sender, and the verification email
  containing the code, purpose and expiry with its inputs escaped.
- `tests/itch.test.ts` (13) — itch.io address parsing: only HTTPS on the exact project/embed hosts, canonicalisation, lookalike domains, `javascript:`/`data:`, the unplayable widget, query/port/credential tricks, and a single valid colour parameter.
- `tests/build-files.test.ts` (23) — legacy archive safety: traversal in any
  form, absolute paths, backslashes, control characters, files that would change
  how the site is hosted, disallowed file types, path length and depth limits, and
  entry-point detection that refuses to guess.
- `tests/catalogue.test.ts` (22) — slug generation and length, game validation
  (title, URL-breaking slugs, unknown statuses, invented dates, genre/tag caps) and
  the publication status table.
- `tests/games-query.test.ts` (23) — search relevance and multi-term narrowing,
  genre filtering, all four sort modes, filters + search + sort together, empty
  results, and highlight ranges.
- `tests/storage.test.ts` (8) — preferences when `localStorage` is missing, throws
  on write, or holds corrupt JSON; validation of stored values; favourites and
  best-score updates.
- `tests/social-links.test.ts` (30) — the social document: normalisation of a pasted
  URL (bare domain → `https://`, fragments and credentials dropped), the platform
  list and its fallback for an unknown key, `mailto:` handling for the email
  platform, refusal of `javascript:`/`data:`/plain-`http`/protocol-relative values,
  the enabled-only filter and the section master switch, the duplicate-profile
  message naming the row it collides with, per-field messages for a missing URL, an
  over-long heading and label, the link-count cap, and the same rules being applied
  to a document that arrives malformed.
- `tests/music.test.ts` (10) — the background-music document: defaults to the
  bundled track, keeps an uploaded key and metadata, rejects a storage key outside
  `music/`, treats a dangling upload as removed, refuses to enable a document with
  no source, clamps the title, and never exposes the storage key in the public
  projection (including failing silently when the object is gone).
- `tests/motion.test.ts` (8) — the decoration physics: clamping, delta-time
  movement, reflection at both walls with the overshoot mirrored, a fast body
  staying inside its area, a minute of travel producing repeated direction
  changes instead of settling on a wall, and a degenerate field producing no NaN.

The authentication-address checks adapt to configuration: when
`OWNER_OTP_EMAIL` pins the destination, the suite proves the dashboard cannot
move it (`409 managed_email`, address unchanged, nothing written to the audit
trail); when the variable is unset it drives the full change-and-revert flow
instead. Both configurations are honest passes, never a skipped test.

## What the browser suite covers (389 checks)

| Area | Checks | Examples |
| --- | --- | --- |
| Floating decoration field | 16 | marks in several kinds at the default intensity, each one inside the viewport (the layer is `fixed`, so a mark in the content column would follow the reader), `pointer-events: none`, behind the content, never inside a player, cumulative travel on both axes, distinct vectors, a resize that clamps every mark back inside, no overflow, click-through, a measured sign reversal on **both** the horizontal and vertical edges in a 16 s sample, and a still composition under reduced motion |
| Ambient music (visitor) | 15 | no element and no audio request before the visitor asks, an honest off state, exactly one looping element once enabled, the 24 s track playing at a background level, navigation neither duplicating nor restarting it, the volume slider changing the real element volume and storing it separately, muting and unmuting keeping the chosen level, the level surviving a reload, a reload starting nothing and refetching nothing while showing the remembered preference as "Resume", an unplayable file reported as unavailable, and nothing throwing |
| Background music (dashboard) | 21 | the bundled track reported on a fresh install, upload through the real file input replacing it, the preview pointing at `/api/media/music`, the upload surviving a dashboard reload, the public configuration offering it without the storage key, the uploaded bytes served with the right type and length, `206` byte ranges, replacement changing the version and the served bytes, disabling hiding the public controls, re-enabling reusing the stored file, removal clearing the document and the preview, a non-audio and an empty upload refused without touching the configuration, both endpoints refused anonymously, and the bundled track restored by the local reset |
| Header controls | 6 | every visible control inside the header at 360, 390, 430, 768, 1024 and 1440 px, none overlapping its neighbour, the wordmark clear of the actions, no horizontal overflow, the theme control present everywhere, and the music toggle/volume appearing as a pair (the menu carries them on phones) |
| Motion design | 2 | the seven hero elements each run a real entrance animation with at least three distinct delays and are fully visible once it ends; hovering a game card changes its transform and shadow and eases the artwork while `offsetTop`/`offsetLeft` stay identical (no layout shift) |
| First-load experience | 9 | on a clean profile the opening card appears with a greeting and a polite live region, reports its three real steps rather than an invented percentage, keeps the page behind it `inert`, then leaves within the ceiling and hands over an interactive site; an in-app navigation never replays it, nothing throws while it plays, and reduced motion still shows it before a quick jump cut |
| Owner security and the two addresses | 31 + 10 | see the list at the end of [SECURITY.md](SECURITY.md) |
| Owner dashboard and the itch.io pipeline | 31 | unsafe itch.io URLs refused by the field and the API, creating a draft, refusing to publish without cover art, the player preview (loading, sandbox, title) not publishing, artwork + screenshots surviving a reload, the publish gate, editing without a deploy, unpublish keeping metadata, and permanent delete including stored artwork |
| Editable site content | 14 + 8 + 2 + 2 | draft stays private, preview needs the owner, publish is visible without a rebuild, portrait upload and removal, editor fields |
| Social links manager and the public band | 53 | add, edit and reorder through the real controls, order matching the public page, disable and re-enable, delete behind a confirmation, an unsafe scheme refused on the field it came from, the server refusing `script:`/`data:`/plain-`http` itself, a duplicate profile refused, an anonymous visitor answered `401` on every write, only enabled links rendered, `target=_blank` with `rel="noreferrer noopener"`, the band hidden entirely with nothing published, one card per link with its platform icon, the keyboard reaching every card with a visible focus ring, the accessible name naming the destination and the new tab, the saved links surviving a dashboard reload in their saved order, a brand-new visitor session seeing the same cards, and the band fitting 320/375/390/768/1024/1366 px |
| About editor controls (through the UI) | 8 | add, reorder, save, publish, the public page rendering the new order, surviving a reload, removing an item and the removal reaching the draft |
| itch.io player | 8 | nothing requested or mounted before Play, the saved `/embed-upload/` address in the frame, a specific title, a sandbox that keeps top navigation out, only fullscreen/gamepad/autoplay delegated, no referrer, and an honest running status |
| Player sizing, input and fullscreen | 16 | clicks and keyboard input reaching the cross-origin frame, the real Fullscreen API on the play area (not the card), the control turning into an exit control, Escape never swallowed, the frame matching its stage after resizing to 1100×820 and 1366×768 without reloading, a stalled embed showing the itch.io fallback / retry / report actions, and Retry recovering |
| Frame fallback | 4 | the direct itch.io link always on screen, a stalled frame explained after the timeout rather than spinning forever, the fallback naming the possible causes, and Retry mounting a fresh frame |
| Responsive viewports | 4 + 5 + 3 | no horizontal overflow on 5 public routes at 9 widths (320–1920, including 911 and 1536 as zoom equivalents), a phone in landscape, and a portrait phone whose Play and toolbar controls are all at least 44px |
| Dashboard on mobile | 5 + 2 + 1 | no horizontal overflow across 8 dashboard routes (including Background music) at 320/390/768/1024/1366, each measured after its data has loaded rather than on the loading skeleton; all eight nav links fitting a 320px screen, the sign-in gate fitting 320px |
| Library, search and filters | 9 + 2 | every visible game listed, search by title/description/tag, genre filter, sorting on top of filtering, empty state, reset, and browser back/forward returning to the filtered list and the game page |
| Decorative background | 9 | `pointer-events: none`, `z-index: -1`, animation running, never inside the player, controls and the game area still clickable, reduced motion static |
| Appearance settings | 8 | settings served publicly, saved by the owner and effective without a rebuild, disabling removes the layer, intensity scales it (1/2/3 elements), a phone builds 1 element against 3 |
| Game detail pages | 7 | direct navigation, gallery, metadata, refresh, honest states for unbuilt games |
| Catalogue | 7 | published listed, drafts/unlisted/archived never leaking, playable flag matching the saved itch.io embed |
| Public API | 9 | admin endpoints 401 for anonymous, unknown endpoints answering JSON, unpublished games unreachable, encoded legacy-build traversal refused, a malformed percent-escape answered `400` rather than throwing, the catalogue's ETag stable across calls and a conditional request answered `304` |
| Record invariants | 2 | the same slug cannot be created twice (`409`), and editing a live game leaves its first `publishedAt` untouched |
| Editor safety | 1 | the game form reports unsaved edits (`0 → 1`), and the browser's own reload prompt is accepted by the harness |
| Layout, a11y, theme, mobile | 4 + 5 + 3 + 2 | no horizontal overflow at 1440/390, mobile menu lifecycle, skip link first in tab order, a visible focus ring on the player's controls reached by Tab, theme persistence, privacy banner |
| Measured performance | 3 | see below |

## What the design audit covers (201 checks; needs a published game)

`scripts/audit-design.mjs` is not a screenshot script with opinions: it reads
**computed** styles out of a real browser and asserts them. It runs against the
public site only (no owner session), so it can be pointed at a deployment with
`BASE_URL`. It is where the opening sequence is proven in detail: typography,
stacking, greetings, script coverage and timing. The browser suite proves the
behaviour from a clean profile as well (see *First-load experience* above) and
then opts out of the card (`localStorage['hg.boot.v1'] = 'skip'`) so that its
later timings stay deterministic.

| Group | Examples |
| --- | --- |
| Opening sequence | the card is up while the app initialises, reports `03 / 03` real steps rather than a percentage, the bar reflects those steps, `#root` is `inert` and nothing focusable sits inside the card, it sits at `z-index: 140` above every other layer, the greeting is decoration while the status is the live announcement, brand/tagline/status text each clear AA, the greeting changes (`Hello` → `Hola`), the ten greetings survive the pipeline intact and each renders at a plausible width, the three CJK/Devanagari scripts render glyphs rather than missing-glyph boxes, the stack names a CJK **and** a Devanagari fallback while the face covers Latin itself, it leaves on its own (~2.1 s), the page becomes interactive again, it does not return during in-app navigation, and nothing threw while it played |
| Typed headline | the accessible heading is exactly `SMALL GAMES. BIG IDEAS.`, the typed copy is decorative and never a second heading, it is mid-type when the card leaves and finishes afterwards, the finished text matches the accessible text, the caret clears, the stage and the subhead do not move (208 → 208, 576 → 576), the two lines do not wrap into more, it is set in the display face, the finish rule is drawn, and it does not type itself again on the way back |
| Entrance | sections are marked to reveal, scrolling reveals them once without leaving any behind, and reduced motion hides none of them |
| Composition | hero artwork keeps a `3px` ink border and a `7px 7px 0` hard shadow; crop marks sit outside the frame; the lead card wears the heavy border and casts the hard shadow; primary actions have an ink outline, a `4px 4px 0` shadow and square corners; the lead card spans the full showcase width and the supporting cards form their own row |
| Colour | the home page's bands carry five schemes that resolve to five different accents over four distinct gradients, a band's accent is wired into its content rather than merely declared, and the band accent is readable as text on the page background (7.99:1) |
| Typography | the display face resolves to Syne in the hero, the greeting stack covers its scripts, and the three tiers are actually distinct |
| Editorial | the section numeral is `02` in the right place, stroked with the thick token, and `aria-hidden`; a dashed rule sits above the section head; mono stamps/rails appear at least four times per page; the value-proposition and contact rows are numbered `01…03` / `01…04` |
| Texture | technical grid band, diagonal stripe band, halftone band, pixel cluster, aurora field and grain layer are each actually painted somewhere on the page, each via a single gradient |
| Interaction | a framed button is untranslated at rest, lifts on hover, and its shadow grows; the press state moves it into the shadow |
| Player | the toolbar carries a hard rule, mono uppercase instrument labels and rectangular controls; the frame is hard-framed inline and bare in fullscreen; a genuine Fullscreen API call is made and released |
| Both themes | body, muted, accent-on-surface and primary-button label contrast are all measured against their real background, in dark **and** light, and must clear WCAG AA (4.5:1) |
| Reduced motion | decorative animation stops, the composition stays visible, transitions collapse to a hair, the card still opens the site with a static greeting, nothing is hidden for an entrance, the headline is complete immediately, and the ribbon is a still composition |
| Paper palette | the light theme measures warm cream `rgb(247, 244, 233)` (not white, and warm), the dark theme warm charcoal `rgb(36, 37, 34)` (not black), body text clears AA on both, the current nav item is a printed block with an ink edge and a hard shadow rather than a glow, and the primary action is flat colour with a 2px ink border and no gradient |
| Flowing ribbon | the band is on the home page, `aria-hidden` with `pointer-events: none`, two `textPath` layers animate at different sizes, the trail is under 60 % of the main size, the loop is a whole number of path lengths (measured, not assumed), the band never overlaps the headline or the primary action, and it is not mounted on a game page |
| Scroll rule and back-to-top | a fixed 3 px `role="progressbar"` starts at scale 0 and reaches 1 at the bottom of the document; the back-to-top control is absent at the top, appears after scrolling, is labelled, and lives in the fixed control stack |
| Loading indicators | the shared ring spins with an accent head on an ink track and fits in 24 px, and the dot sequence is made of squares |
| Privacy notice | a fixed printed card under 420 px tall with a ≥2px ink border, a hard offset shadow and ≤4 px radius — a notice, not a modal |
| Accessibility | the first tab stop shows a real focus ring, and every measured control is reachable by keyboard |
| Overflow | 6 routes × 7 widths (320/375/390/768/1024/1366/1920) with a ≤1 px tolerance, so a stray `100vw` or a long word fails the run |

## Measured performance (cold load, decoration layer running, 1440×900)

| Metric | Measured | Method |
| --- | --- | --- |
| Largest Contentful Paint | **224 ms** on the most recent run (164–240 ms across runs) | `PerformanceObserver('largest-contentful-paint')` |
| Cumulative Layout Shift | **0.0031** on the most recent run (0.0006–0.0035 across runs) | `PerformanceObserver('layout-shift')`, ignoring recent input |
| First-load transfer | **553 kB over 31 requests** on the most recent run — the paper redesign adds the Fraunces greeting face (~89 kB, Latin subset only); the other fonts, the ribbon and the textures are all in the existing bundle | `performance.getEntriesByType('resource')` `transferSize` |

The ranges are the honest part: this is a local `wrangler dev` server on a shared
machine, so both timings move by tens of milliseconds between runs even though the
built assets are content-hashed and unchanged.

Lighthouse is not installed, so no Lighthouse score is claimed. These are the same
browser APIs a Lighthouse report reads, measured during the scripted run, and they
are asserted as bounds rather than reported after the fact: LCP < 2.5 s,
CLS < 0.05, transfer < 700 kB.

The most recent audit pass — its findings, root causes, fixes, security posture,
measured performance and the visual-regression evidence — is written up in
[AUDIT.md](AUDIT.md). The list below is the longer history of bugs found while
building this verification suite.

## The polish pass (visual, no redesign)

A focused pass after the audit, driven by the rendered site rather than by taste:
the test fixture can no longer reach a public surface, the theme control was
rebuilt to one geometry, the background was quietened, the ribbon was restrained,
and the empty library got a proper card. Nothing was rebuilt: same stack, same
routes, same visual language.

| Change | What it replaced | Verified by |
| --- | --- | --- |
| `isFixtureSlug` in the catalogue rule | Nothing — a safety net. The `pipeline-check` record was already deleted and the seed only creates unpublished fixtures; this makes it impossible for any of them (or a leftover `verification-run-…`) to appear publicly | `catalogue.test.ts` (9 new assertions), `empty: the removed test game is nowhere on the page` |
| One theme control geometry | A 38px pill with a 26×28 target on phones, a 10px radius against the search field's 3px, an 11 % tint for the active option and a hover rule that also fired on it | `theme: both options are identically sized targets` (32×32), `sits on the search field's baseline`, `selected option is a real fill, not a tint`, `each option is labelled and tooltipped` |
| System preference on a first visit | A hard-coded ivory default that ignored `prefers-color-scheme` (and would have flashed the wrong sheet once it did) | `theme: a first visit follows the operating system` — the inline pre-paint script applies it before React runs |
| The dashboard's own theme control | The dashboard had none, so the palette could only be changed from the public header | `admin: the dashboard switches theme and remembers it` |
| One decorative layer per page | Five regions (page, hero, panel, edge, 404 panel), 3–5 marks each: up to fifteen elements on the home page | `appearance: intensity scales the decoration layer` (1/2/3), `a phone builds fewer elements than the desktop view`, and the existing pointer-events/z-index/reduced-motion checks |
| A quieter dot screen | A 28px screen at 4.5 % ink over the whole document | Visual: it now fades out by the first fold and is only legible at reading distance; the section textures keep their own, lighter treatments |
| A restrained ribbon | 196px band, 42 % tint, 0.80/0.86 word opacities | Visual: 172px band, 26 % tint, 0.72/0.78; the loop arithmetic and clearance checks still pass |
| A real hero empty card | “NO GAMES PUBLISHED YET.” / “Library is empty” | “FIRST BUILD IN PROGRESS.” with a drawn cabinet mark and “In development”; the featured band keeps the supplied copy (“The arcade is getting ready.”) |
| Repeatable verification runs | The build-upload budget (40 an hour in `upload_events`) was never cleared by the local reset, so two runs inside an hour started failing with `429` | `uploads: true` scope on the dev reset, used by the harness; the five upload checks went from red to green |

## Bugs and gaps found while verifying (and fixed)

1. **The About headline printed its own markup.** The heading rendered
   `**in bold**` literally while every other field went through the restricted
   inline renderer. Found by the check that asserts stored emphasis is emphasised,
   fixed by rendering the headline the same way as the tagline and body.
2. **The portrait assertion selected the wrong element.** The About portrait *is*
   `img.about-avatar` (the controller artwork stands in when there is none), and it
   is lazy-loaded, so the harness both missed it and sampled one frame too early.
   The check now waits for a decoded image.
3. **The injected-markup check asserted an implementation, not an outcome.** Stored
   strings have their tags stripped when the document is normalised, so the payload
   never appears as escaped text in the page — the old assertion would have failed
   no matter how safe the page was. It now asserts what matters: no `<script>` and
   no event handler inside `main`, and the payload still present as harmless text.
4. **The verification run could not repeat itself.** The rate limits this app
   enforces are deliberately sticky (60 s between codes, 8 codes an hour, a
   fifteen-minute lockout after five wrong passwords), so a step that proved a
   limit was enforced locked out the steps after it. The local-development reset is
   now scopeable — challenges, audit trail, sessions and the authentication address
   separately — and the harness clears exactly what it needs at each phase
   boundary while keeping its session.
5. **A crashed run poisoned the next one.** The harness creates a scratch game and
   deletes it at the end; a run that died part-way left it in the database, which
   shifted the library count and added a second search hit. The harness now signs
   in first and removes anything carrying its own slug prefix.
6. **A gate race.** The dashboard renders `.admin-gate` once while the session is
   being checked and again with the verdict; one check sampled the first render.
   It now waits for the verdict text.
7. **A check that could pass on a refusal.** The new draft-readback checks asked
   the admin API from Node, where there is no owner session, so every response was
   a `401` — and one of them treated *any* non-null answer, including that empty
   fallback, as success. Both now read through the browser's session and assert the
   status as well as the content, so a refused request fails loudly instead of
   looking like a pass.

8. **Build assets could go stale after a replacement.** `/play/<slug>/main.js` is
   the same URL for every build a game ever has, but non-HTML build files were
   served with `public, max-age=3600`. Replacing a build therefore had the browser
   keep the previous script for up to an hour while the entry document (correctly
   `no-cache`) was already the new one — a mixed, broken build. Build files now
   revalidate with `max-age=0, must-revalidate` and answer conditional requests
   from the stored object's ETag; the suite asserts the header, the 304, and a real
   upload-activate-serve-replace cycle.
9. **The player box was shorter than the game it had to hold.** The frame's height
   came from `62vh` alone, which is fine on a tall desktop window but leaves a wide
   column only ~476px tall at 1366×768 (and after browser zoom) while a build that
   scales with its width needs more — so the game arrived with a scrollbar inside
   the frame. The frame now floors its height against **its own column width**
   (`container-type: inline-size`, `min-height: min(80cqw, 75vh)`), capped by the
   window so a phone in landscape is never forced taller than the screen. Both
   window sizes are asserted, and the earlier failure is what the check reports.
10. **The About page printed the same sentence twice.** The shipped default content
    used one line for both the About `tagline` and the About `intro`, and the page
    renders them as two separate elements — so the opening paragraph appeared to
    stutter. The defaults now carry distinct copy, and the page drops an `intro`
    that repeats the `tagline` or the headline. The API payload was correct all
    along; this was found by reading the rendered page, not the JSON.
11. **A reduced-motion check read the headline before it existed.** The check that
    proves *the headline is complete immediately* sampled `#hero-heading`'s
    `data-typed` attribute straight after `domcontentloaded`, but the home page is
    a lazily-loaded route, so the element was often not there yet and the check
    judged an absent attribute. It now waits for the element and still fails on
    `typing` or on a missing attribute — a timed-out wait leaves the attribute
    absent, which fails as before. The added seventh dashboard route also meant the
    320px navigation check could no longer assert an exact link count; it now
    asserts a floor **and** that nothing overflows, which is what it was really
    proving.
12. **The social band's empty state needed one behaviour, not two.** An
    unconfigured section has two opposite requirements — the public page must show
    nothing at all (no empty frame, no placeholder profile, no hint that a
    dashboard exists), while the owner's preview must say why it is empty. Both are
    now asserted: with the links document empty, `[data-social-band]` is absent from
    the public page and the footer still ends it, and the same component inside the
    dashboard renders exactly one empty-state note.

## Root causes found in the game-detail repair

- **Layout.** The two-column split was declared on `.detail-hero` itself, so the
  grid wrapped the wrong elements: the breadcrumb sat in the wide column and the
  entire title/description/actions/art block was squeezed into the narrow one,
  which is what left most of the hero empty and pushed the play area down the page.
  The split now lives on `.details` (the title block and the art), the hero is a
  single column, and the player and metadata panel sit below it in the same
  centered container. The harness asserts the measurements, not the markup: the
  hero spans its container to within a pixel, the art sits to the right of the
  text, the player column is wider than the metadata column, and the split is two
  columns inside a single-column hero.
- **Player.** The stage was a forced 16:9 letterbox that gave a build ~380px of
  height, the Play button revealed a frame that was never asked whether it could
  load, and there was no fullscreen control at all. The build is now requested
  before the frame is mounted (a refusal becomes a real error state), the frame
  fills a stage sized for it, and fullscreen is a genuine Fullscreen API call on
  the player with `fullscreenchange` read back.

## Theme verification

The site deliberately ships two coherent paper palettes rather than a neon or
cool-navy alternative: warm ivory (`Light`) and neutral warm charcoal (`Dark`).
Both are real buttons with `aria-pressed` and a `title` tooltip, persist in
`hg.theme.v1`, apply before first paint, preserve the hard frames and shadows,
and are covered by the design audit's overflow/contrast pass. The retired cool
palette was removed so it cannot be reached through stale local storage or a
hidden selector.

A first visit with no stored choice follows `prefers-color-scheme`; the inline
script in `index.html` implements exactly the same rule as `src/lib/theme.ts`, so
the system answer is on screen before React mounts. The dashboard header carries
the same control. The suite proves the geometry too: both targets 32×32 and equal,
the frame the same height and centre line as the search field, the selected
option filled rather than tinted, and the labels/tooltips present.

## The reconstruction pass against the reference mockups

This pass started from the two reference images (light and dark homepage), not from
an opinion about the code. Both images were measured rather than eyeballed: each was
drawn into a canvas and scanned for its content edges, colour histogram and the
vertical extent of the headline. Those numbers are what the layout was then set
against, at the images' own 1312 px width and again at 1440 px.

What the images said, and what was changed:

| Measured from the reference | Set in the code |
| --- | --- |
| content field spans 86 % of the viewport (1128 of 1312 px) | `--container` 1200 → **1840 px** with gutters of `clamp(1rem, 4.5vw, 4.375rem)`; the field is then 91 % of 1440, 91 % of 1600, 92 % of 1776 and 86 % of 1920 |
| hero is three columns at roughly 456 / 329 / 330 of that field | `grid-template-columns: 1.39fr 1fr 1fr` with a 56 px gutter — measured back at 491 / 354 / 354 at 1440 |
| first headline line is 415 px wide at 1312 (≈456 px at 1440) | the headline is sized from its own column (`14.9cqw`, capped at 92 px), so it fills the column as two lines and cannot wrap to three; below 1120 it sizes from the window (`9vw`) so a tablet does not get a 130 px headline |
| header is logo → nav → search, the nav starting ~250 px after the content edge | the nav's auto margin moved from the wordmark to the actions; the nav now starts 313 px in, the search and theme pill own the right edge |
| the ribbon is a strip, not a panel | the SVG frame was 1200 × 340 in a 148 px band, so the band cropped into giant diagonal fragments. It is now a 1200 × 200 frame in a band whose height tracks that ratio: the whole curve is visible at desktop width, and narrow screens crop the ribbon's ends instead of the words |
| the reference's dark ground is cool and much darker than the light sheet | see the note under *Limitations* — the written brief specifies warm charcoal, and that is what ships |

Measured result on the running build (`wrangler dev`, light and dark):

| Viewport | Content field | Field % | Gutters | Hero lead / art / cards | Headline |
| --- | --- | --- | --- | --- | --- |
| 1440 × 900 | 1310 | 91 % | 65 | 491 / 354 / 354 | 73 px |
| 1600 × 900 | 1460 | 91 % | 70 | 553 / 398 / 398 | 82 px |
| 1776 × 900 | 1636 | 92 % | 70 | 625 / 450 / 450 | 92 px |
| 1920 × 1080 | 1660 | 86 % | 130 | 635 / 457 / 457 | 92 px |
| 1024 × 900 | 932 | 91 % | 46 | 467 / 424, cards on their own row | 68 px |
| 768 × 900 | 699 | 91 % | 35 | stacked | 68 px |
| 390 × 844 | 355 | 91 % | 18 | stacked | 38 px |

Last contentful paint 272 ms; first-load transfer 659 kB over 33 requests;
cumulative layout shift 0.0006; `scrollWidth` equals the viewport at every width
above, so nothing overflows.

The dark palette's hue axis was also corrected in this pass. The brief's starting
values put green one unit *above* red (`#242522`, `#2b2c29`, `#32332f`); a full
screen of that reads as olive even though no single element looks green. The
neutrals are now red ≥ green > blue (`#252420`, `#2c2b27`, `#33322d`, `#3a3934`)
at the same lightness, and the design audit's warmth test was tightened to assert
that axis instead of the looser "red ≥ blue ≤ green" it previously accepted.

Two regressions were introduced and then fixed during this pass, both caught by the
suite rather than by eye:

- **The dashboard overflowed by 32 px at 320 px wide** on all seven admin routes.
  The header's action group is fixed-size and could not wrap or shrink once the
  identity chip was in the row; the group now wraps and the chip steps aside below
  620 px. Verified: `scrollWidth` is 320 on `/admin`, `/admin/games` and
  `/admin/security`.
- **Cumulative layout shift rose to 0.1272**, from 0.0031. The right-hand hero column
  is the tallest of the three and its first card only exists after the catalogue
  fetch, so the hero grew under the ribbon and pushed the rest of the page down. The
  hero's columns are now top-aligned and the column reserves its height, which also
  matches the reference's top-aligned composition. CLS is back to 0.0006.
- **The wordmark was truncated to "He…" on a phone.** The header's search field kept
  its desktop width (144 px) below the breakpoint where its label is hidden, so it
  left the brand almost no room. It is a 40 px icon button now, and below 460 px the
  logo mark steps aside so the full name fits. Measured at 390 px: the name is whole
  (no `scrollWidth > clientWidth`), the search trigger is 40 px, and the document is
  exactly 390 px wide.

## Limitations and what still needs supplying

- **Two deliberate divergences from the mockups.** The reference's dark ground is a
  near-black cool navy (`#020c18` measured), while the written brief specifies warm
  charcoal (`#242522`) and forbids both a cool neon scheme and a pure black page; the
  brief is what ships. The reference's display face is also a condensed grotesque
  (the phrase measures 5.7 em wide), while the site's display face measures 6.7 em,
  so at the reference's line width the type is optically ~10 % smaller. Matching
  either exactly is a one-line token change (`--bg`, or `--font-graphic`) if wanted.
- **Email delivery is pending configuration.** The whole verification flow is
  exercised through the loopback catcher (which is refused on any deployed origin),
  and both Resend paths are unit tested with a stubbed `fetch`, but no real message
  has been sent from this machine. Set `RESEND_API_KEY` and `EMAIL_FROM` and confirm
  a real inbox before relying on it. See [SECURITY.md](SECURITY.md).
- **Production domain is unset**, so canonical URLs and `sitemap.xml` are skipped by
  design; the build logs a warning instead of inventing one.
- **Cover art** for a game without an upload falls back to the generated
  placeholder, labelled as such on the card. The owner uploads real artwork
  through the dashboard; the seed installs no artwork or public game.
- **Drafts and unlisted games** never appear publicly, which the suite asserts from
  an anonymous context — but the checks run against the local D1/R2 emulation, not
  against a deployed database.
- **`npm run verify` does not start a server for you.** It was run against
  `wrangler dev`, which is the same Worker the deployment uses.
- **The suite resets local state through two loopback-only routes.**
  `POST /api/admin/dev/security-reset` clears the sticky rate limits and
  `POST /api/admin/dev/content-reset` (added for this) restores the shipped
  About/Contact/Social documents, so a run that crashed before its own cleanup
  cannot fail the next one. Neither route is reachable behind a deployed origin:
  both require the `DEV_OWNER_SUB` seam, a loopback request and a loopback
  `APP_ORIGIN`. Running the suite against a development database therefore
  discards any unpublished content edits you made by hand.
- **The dev seam is required by the harness** (`DEV_OWNER_SUB` plus the loopback
  origin), so the suite cannot be pointed at production as-is; only the public-site
  checks would pass there.
