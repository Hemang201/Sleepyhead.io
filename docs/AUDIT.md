# Engineering audit — findings, fixes and verification

This is the record of the reliability and security pass over the existing arcade.
It is deliberately narrow: no redesign, no framework change, no new dependency,
no schema migration, and no stylesheet edit. Everything below was measured on
this machine against the local Worker (`wrangler dev`, Miniflare D1 + R2), not
assumed. The visual system was not touched; see
[visual regression status](#visual-regression-status).

Run commands are in [§7](#7-commands-and-results). The deeper per-area
verification write-up lives in [VERIFICATION.md](VERIFICATION.md).

## 1. Bugs found and fixed

| # | Severity | Symptom | Root cause | Fix | Now covered by |
| --- | --- | --- | --- | --- | --- |
| 1 | High | *Hardened in this pass, originally found while building the suite:* replacing a build could leave a browser running the previous script against the new entry document — a mixed, broken build | Build files live at a stable URL (`/play/<slug>/main.js`) for every build, but were served `public, max-age=3600` | Build files are `public, max-age=0, must-revalidate`, answer `if-none-match` from the stored object's ETag with `304`, entry documents stay `no-cache` | `cache: build assets revalidate instead of going stale`, `cache: a repeated asset request is answered with 304`, the upload → activate → replace cycle |
| 2 | High | The catalogue advertised revalidation that could never work: every response was new | `updatedAt` came from the clock (`nowIso()`), so the ETag changed on every call | The body is derived from the data (`latestGameUpdate(games)`, epoch when empty), a weak ETag is computed from the serialised body, and a matching `if-none-match` answers `304` | `cache: the catalogue has a stable ETag across requests`, `cache: an unchanged catalogue answers 304` |
| 3 | High | A build that had failed or was still uploading could be activated if it still carried an `entry_path` from an earlier attempt, pointing the public page at an incomplete upload | Activation only checked that an entry path existed | Activation requires a finished build (`isActivatableBuild`); anything else is `422 build_not_ready` | `builds: an unfinished upload cannot be activated` |
| 4 | Medium | A malformed percent-escape in `/play/…` or a game address threw `URIError` and became a Worker exception (500) instead of a client error | `decodeURIComponent` was called outside a guard | The decode is wrapped; bad input is `400 bad_path` / JSON `400` | `api: a malformed URL segment is a 400, not a 500` |
| 5 | Medium | Editing a live game rewrote its first publication date, shifting catalogue ordering and the ETag | `published_at` was overwritten on every update | `published_at = COALESCE(?, published_at)`, set only on the draft/coming-soon → published transition | `games: editing a live game keeps its first publication date` |
| 6 | Medium | A metadata request that never settled left a page on its skeleton for ever — no error, so no retry | `fetch` had no deadline | Reads (`GET`/`HEAD`) get a 15 s `AbortSignal.timeout`; timeouts and network failures become one clear `ApiError` (uploads are deliberately exempt) | manual inspection + the unreachable-server state in the suite |
| 7 | Medium | If the ZIP worker failed to start, extraction reported “archive support is unavailable” | The fallback read `fflate` from a cache a background import might not have filled yet | The fallback awaits the dynamic import itself, so it works at exactly the moment it is needed | `tests/build-files.test.ts` + a manual worker-failure run |
| 8 | Low | Toast timers fired after the dashboard unmounted | Timers were created but never cleared | The provider clears its timers on unmount | lint (no dangling effect) + dashboard navigation |
| 9 | Low | Upload failures left an allocated build record behind and offered no recovery | The failure path neither discarded the allocation nor exposed a retry | A failed upload discards its allocation (best effort) and shows the error with a working **Try again** | admin upload flow, `build:` checks |
| 10 | Low | The confirmation dialog was a visual modal only: focus could escape, Escape did nothing | No focus trap, no key handling | `role="alertdialog"`, `aria-modal`, focus trap, `useEscapeKey`, scroll lock, focus returned to the trigger | keyboard pass in the suite |
| 11 | Low | The catalogue theme test compared the result with whichever palette the browser profile happened to start on, and sampled the surface mid-fade | Harness assumed a dark default and measured immediately | The check asserts the measured ivory surface, that the two palettes differ, and a dark → light → dark round trip; both surface reads wait for the cross-fade | `theme:` checks |

Two of those are worth spelling out because they were invisible in the UI:

- **Stale build assets (1).** The entry document was correctly `no-cache`, so a
  replacement looked live — while `main.js` could still come from the previous
  build for up to an hour. The fix is a header change, and the suite now proves
  the whole path: upload a second build with a marker in its `<title>`, activate
  it, fetch the public URL, and run it inside the player.
- **No-op revalidation (2).** `Cache-Control: public, max-age=0, must-revalidate`
  reads like a cache win, but with a clock-derived ETag nothing could ever match.
  Deriving the timestamp from the data makes an unchanged catalogue
  byte-identical, which is what turns the repeat request into a 304.

## 2. Security posture (verified, not assumed)

The owner gate is custom and stays custom: password → one-time code to the
private authentication address → server-validated session → per-request
authorisation. No third-party sign-in was introduced and no client-side guard
carries authority.

`npm run audit:security` proves 66 server-side properties over HTTP with no
browser, including:

- every protected admin route answers `401` without a session, with a tampered
  session cookie, and with a headers-only claim to be the owner — and the row
  counts are compared before/after to show nothing was written;
- the password gate: wrong password, lockout after repeated failures, codes
  required before a password change, weak new passwords refused, other sessions
  revoked, old password dead afterwards;
- the code lifecycle: expiry, single use (replay → `410 challenge_spent`),
  attempt budget, resend cooldown (`429` with `Retry-After`), and a wrong
  password never triggering a code;
- the private address is never returned — only a masked form — and an anonymous
  session report contains no address at all;
- the authentication address can only change after the new address confirms, and
  the public contact address is independent of it.

`npm run verify` adds browser-level checks for the same boundary: anonymous
admin reads, drafts and unpublished builds unreachable, encoded traversal
refused, the build route never serving project files, and the sandboxed player
(`allow-scripts` without `allow-same-origin`).

Unchanged by this pass, and re-read to confirm: PBKDF2 password hashing with a
per-user salt, HttpOnly/SameSite session cookies, server-side checks on every
admin operation, per-file and per-build size limits, archive path validation
(traversal, absolute paths, backslashes, control characters, extension
allow-list) and the opaque-origin iframe.

## 3. Reliability improvements

- **Admin mutations** prevent duplicate submissions (`busy` disables the
  control and the handler is re-entrant-safe), show progress stages while a
  build uploads, report success only after the server answers, and refresh the
  affected records afterwards.
- **Unsaved edits** are protected twice: `beforeunload` for a reload or closed
  tab, plus an in-page banner with a discard action, because client-side
  navigation never fires `beforeunload`.
- **Publishing** is validated in three places that agree: the form
  (`validateGameInput` + server errors on their fields), the API (422 with
  per-field messages) and the publication rule (a published game needs an
  active, finished build; the API activates the newest ready build in the same
  request or refuses with `409 build_required`).
- **Errors** carry a code and, where relevant, field messages. Recoverable
  failures offer a retry; the player's failure state names the build, offers
  Reload / Report and never shows a raw stack trace.
- **Empty vs failed** stays distinct: an empty catalogue is the deliberate empty
  state, a failed request is a retryable `role="alert"` error. No demo game was
  added at any point.

## 4. Performance

Measured on the local Worker during the scripted run (1440×900, decoration layer
running), asserted as bounds rather than reported afterwards:

| Metric | Final run | Bound |
| --- | --- | --- |
| Largest Contentful Paint | **196 ms** | < 2.5 s |
| Cumulative Layout Shift | **0.0001** | < 0.05 |
| First-load transfer | **253 kB over 28 requests** | < 700 kB |

Two catalogues' worth of requests are now answered with `304` instead of a body
(the catalogue after an unchanged publish, and any build asset after the first
load). No lazy-loading, code-splitting or image change was made in this pass:
routes were already split and the measurements were already inside the bounds,
so optimising further would have been change without evidence.

## 5. Upgrades implemented

| Upgrade | What changed | Practical benefit |
| --- | --- | --- |
| Admin diagnostics | Upload stages with a progress bar, per-file skip reasons, validation results, build status/entry, and a retry that allocates cleanly | The owner can tell a bad archive from a slow upload without reading the console |
| Safer save/publish | Duplicate-submit guard, pending states, unsaved-edit warnings, publish blocked without a valid build, confirmation for destructive actions | No half-published games and no double uploads |
| Error recovery | One `ApiError` shape, read deadlines, retry actions, server-side event log without secrets | A transient failure costs a click, not a reload |
| Library usability | Search + filters + deterministic sort, honest empty state, count from the visible results, play buttons only for playable games | The count and the cards can no longer disagree |
| Preferences | Theme applied before first paint from one resolver; storage failures degrade silently; cookie choice persisted | No flash of the wrong palette; private-mode visitors still get a working site |
| Docs | This report plus corrected counts/commands in README and VERIFICATION | The next maintainer can trust the numbers |

## 6. Remaining issues and what is *not* verified

- **No version control in this checkout** (`git` reports “not a repository”), so
  there is no pre-audit snapshot to diff against; see the visual section.
- **Real email delivery is untested.** The whole owner flow is exercised through
  the loopback catcher (refused on any deployed origin) and both Resend paths are
  unit-tested with a stubbed `fetch`; no real message has left this machine. Set
  `RESEND_API_KEY` and `EMAIL_FROM`, then confirm a real inbox.
- **Nothing was run against a deployed database or domain.** Migrations were not
  applied remotely and `sitemap.xml`/canonical URLs stay disabled while the
  production domain is unset.
- **The design audit's detailed card/player checks are skipped** because the
  published catalogue is intentionally empty; the same geometry is covered by
  `npm run verify` against a real uploaded build.
- **Browser coverage is one Chromium-family browser** (installed Brave). Firefox
  and Safari behaviour, and real mobile devices, are not tested.
- **Uploads were tested up to the fixture size**, not against a
  multi-hundred-megabyte Unity export or the storage quota.

## 7. Commands and results

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass — app and Worker, no errors |
| `npm run lint` | pass — 0 errors, 0 warnings |
| `npm test` | **183/183 tests, 10 files** |
| `npm run build:all` | pass — `dist/` + `dist-worker/index.js` (97.1 kB) |
| `BASE_URL=http://127.0.0.1:8787 npm run verify` | **389/389 checks pass** |
| `BASE_URL=http://127.0.0.1:8787 npm run audit:security` | **66/66 checks pass** |
| `BASE_URL=http://127.0.0.1:8787 npm run audit:design` | **42/42** overflow/contrast checks pass on the empty arcade; detailed checks skipped (no published game) |

The browser suite needs `npm run dev:full` running; the security audit shares the
local rate-limit state and must run on its own.

The suite's coverage of the admin workflows named in the brief is explicit:
unauthenticated rejection, wrong password, expired/replayed codes, protected API
refusal, drafts and unpublished builds unreachable, malformed archive refused,
duplicate slugs refused, publishing without a build refused, build replacement
(including a failure path), draft → published → unpublished → deleted, the
unsaved-edits notice, and no horizontal overflow on eight dashboard routes.

## 8. Visual regression status

No stylesheet, design token, font, spacing value or illustration was modified in
this pass; the only UI files touched were admin components, which reuse the
existing classes. Evidence:

1. `npm run audit:design` — 42 computed-style and overflow checks pass (paper
   palette values, hard frames and shadows, texture set, typography tiers,
   reduced motion, contrast, 6 routes × 7 widths with a ≤1 px tolerance).
2. `npm run verify` — layout measurements on the real published game (hero
   columns, art placement, player vs metadata widths), player toolbar tap
   targets, and no horizontal overflow at 320/375/390/768/911/1024/1366/1536/
   1920 px.
3. **Determinism control:** two frames of the same page 1.2 s apart differ by
   **0.13 % of pixels**, so a before/after diff smaller than that is noise.
4. Current captures of home, library, about, contact and the dashboard in both
   palettes were inspected by eye: the neo-brutalist frames, hard offset
   shadows, mono stamps, accent schemes and paper surfaces are intact.

**What could not be done:** the repository has no VCS history, so the only
captured “before” frames on disk predate an intervening design pass and show
copy that no longer exists (for example a “NOW BUILDING / THE FIRST BUILD”
featured card). Diffing against them measures that earlier pass, not this one, so
no pixel-level before/after claim is made here.

This section describes the *audit* pass, which changed no styles. The polish pass
that followed (§9) did change styles on purpose; it was re-verified with the same
design audit (42/42), the full browser suite (389/389) and fresh light/dark
captures at 320/390/768/1440/1776 px.

## 9. Polish pass (after the audit)

A visual pass followed, with no redesign and no stack change. In short: the
fixture slug guard (`isFixtureSlug`) now keeps any development double out of the
public catalogue; the theme control was rebuilt to one geometry (40px frame,
equal 32×32 targets, ink fill for the selected option, the search field's 3px
corner, tooltips, focus ring) and added to the dashboard; a first visit now
follows the operating system's palette, applied before first paint; the
background was quietened (one decorative layer per page instead of five, 1–3
marks instead of up to fifteen, a dot screen that fades out by the first fold,
lighter section textures); the ribbon was reduced from 196px to 172px with a
lighter tint and softer word opacities; and the hero's empty card now carries a
drawn cabinet mark and honest copy. Details, the exact numbers and the checks
that prove each one are in
[VERIFICATION.md § The polish pass](VERIFICATION.md#the-polish-pass-visual-no-redesign).

## 10. Creative director pass

A second visual pass, judged screen by screen at 1440 and 390 in both palettes
rather than from the homepage alone. Six changes, each with a reason, plus one
editorial correction.

| Change | Why | Verified by |
| --- | --- | --- |
| The sticky header became an opaque sheet with an ink hairline | Frosted glass over display type smeared the line behind the search field — legibility traded for a trend, and the only blur left on a site that otherwise uses flat surfaces | Screenshots at every scroll position; the audit's contrast checks on header text |
| The homepage sections are numbered **01 → 04** | *Featured games* and the feature strip had no numeral, so the page started its numbering at 03 and read as if two sections were missing | `audit:design` still finds the featured flourish (now in the eyebrow) and its band accent |
| The empty featured band spans its width, with the copy in two columns | A 56rem note on a 1440px band left nearly 500px of unexplained white space — the one thing the empty state must not do | Measured: 1310px of a 1310px container, `overflow: 0` |
| About's *Areas I work in* became a ruled index | Nine filled pills read as a tag cloud; a numbered list on hairlines reads as a set of positions | `verify` still finds `.about-tags .chip` for skills (unchanged) and the index renders in order |
| The Contact copy stopped talking to the owner | "The owner can add one from the dashboard under Site content → Contact" is developer-facing wording on a public page, and it was said twice | Manual review of both contact states; no check asserted the old copy |
| The missing-artwork cover was redrawn in the paper palette | The old one was neon-on-navy with glows — artwork from the design the paper rework replaced, on every card without cover art | Rendered the SVG directly at 820×520 and inspected it |

The homepage's contact heading is also back to sentence case in the defaults
(`src/data/site.ts`): it was stored as "LET'S CONNECT.", which fought the type
system on a page whose sibling headings are sentence case. An existing install
keeps whatever is in its content document until the owner edits it in the
dashboard — content is data, not CSS.

## 11. Decorations, ambient music and email setup

A third pass, requested directly: bring back the floating background details, add
optional ambient music, and make the two email addresses impossible to confuse.
A later polish pass (below) made the field genuinely bounce, moved the music
under the owner's control, and neutralised the dark theme.

| Change | What it does now | Verified by |
| --- | --- | --- |
| Bouncing field | A budget of 8 / 10 / 12 marks by intensity, capped at 12 on desktop, 7 on a tablet and 5 on a phone, in game-inspired kinds: stars, sparkles, rings, squares, pluses, dpads, buttons, orbits and pixels. One `requestAnimationFrame` loop keeps an independent position and velocity per mark, integrates with delta time, and reflects the velocity component at each wall; positions are clamped to the free area after a resize. The layer is `fixed`, behind the content, `pointer-events: none`, never mounted in the player. | `verify`: 16 checks — travel on both axes, distinct vectors, a measured direction reversal on **both** the horizontal and vertical edges, bounds after a resize, no overflow, click-through, static under reduced motion |
| Marks around the artwork | A star, a dot and a plus in the framed artwork's margin, scrolling with the frame instead of the fixed layer | Screenshots at 1440/390, light and dark |
| Ambient music | One lazily created `<audio>` for the whole app, 24 s seamless pad generated by `scripts/generate-ambient.mjs` as the bundled fallback, 650 ms fade, remembered in `hg.music.v1`. The track itself is uploaded in the dashboard, stored in D1 + R2 and streamed from `/api/media/music` with byte ranges; disabled music hides the public controls. A reload starts nothing at all: the preference shows as `paused` ("Resume") and the first click plays. A refused `play()` is `blocked`, a broken file is `error`. | `verify`: 36 checks — no element or audio request before the visitor asks, one looping element, real volume changes stored separately, mute/unmute preserving the level, upload/replace/disable/remove through the dashboard, the public configuration, `206` ranges, refused uploads, anonymous refusal, and the bundled track restored |
| Neutral dark mode | The dark sheet is `#202124`, cards `#292a2d`, raised surfaces `#303136`, text `#f2f2f3`, secondary text `#b7b8be`, borders `#45464b`. Surfaces sit on the blue-grey axis (blue ≥ green ≥ red), so a full screen reads grey rather than olive; accents stay pastel. | `verify` samples every near-grey fill on the public home page and on the dashboard and rejects a green-dominant channel |
| Two addresses, documented | [SETUP_EMAILS.md](../SETUP_EMAILS.md) names the exact variables, where each address is set locally and in production, how to verify delivery without a code, and why there is no `PUBLIC_CONTACT_EMAIL` env var or `.env.example` | `audit:security` (no public response contains either private address) and `verify` (contact change leaves auth alone; private refused as public) |

The decoration budget is a ceiling per intensity, not a promise of exactly that
many: a phone always gets four, and the `far` flag still drops the outermost
marks there before the count is applied.

## 12. Deployment notes

- **No migration is required.** The schema is `0001`–`0003` as shipped; nothing
  in this pass altered tables or indexes.
- **No new environment variable and no new secret.** `OWNER_AUTH_EMAIL`,
  `RESEND_API_KEY`, `EMAIL_FROM`, `DEV_OWNER_*` keep their existing meanings
  (see [DEPLOYMENT.md](DEPLOYMENT.md) and [SECURITY.md](SECURITY.md)).
- **No dependency added, removed or upgraded**; `package.json` and the lockfile
  are unchanged.
- **Header change to be aware of:** build assets are now `max-age=0,
  must-revalidate` with an ETag. That is intentional — the URL is stable across
  builds, so a long `max-age` would serve stale game code after a replacement.
- After deploying, re-run `npm run audit:security` against the deployment only
  if the loopback seam is disabled there; the owner checks require the local seam
  by design.
