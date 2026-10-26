# Building and deploying

This site is a Cloudflare Worker that serves a static React build, owns the
game/content API, and holds the database (D1) and uploaded files (R2). There is no
separate backend server to run and no Node process in production.

```
Worker (worker/index.ts)
├── /api/**            the API: catalogue, content, music, admin, auth, media
├── /play/**           legacy locally stored builds (the public player now uses itch.io)
└── everything else    the static build in dist/, via the ASSETS binding
```

The games themselves are hosted by itch.io. This site stores the listing and the
uploaded artwork; no game files are needed for a new listing.

## Local development

```bash
npm ci
npm run db:migrate     # apply migrations to the local D1 emulation
npm run dev:full       # wrangler dev on http://127.0.0.1:8787
# optional, after the Worker is running: unpublished dashboard fixtures only
npm run seed
```

`npm run dev` (plain Vite) serves the frontend only; API routes will 404 there.
`.dev.vars` holds the local-only values: `APP_ORIGIN`, the private
`OWNER_LOGIN_EMAIL` / `OWNER_OTP_EMAIL` / `OWNER_SETUP_TOKEN` trio and the
development owner seam (`DEV_OWNER_SUB`, `DEV_OWNER_EMAIL`, `DEV_OWNER_PASSWORD`). It is gitignored —
never commit it, and never copy `DEV_OWNER_SUB` into a deployed environment.

## Build

```bash
npm run build          # frontend into dist/ (does not type-check)
npm run build:worker   # bundle the Worker into dist-worker/index.js
npm run build:all      # both, in that order
```

`dist/` is plain static output (hashed assets, `manifest.webmanifest`, `sw.js`,
`robots.txt`, `offline.html`). `dist-worker/index.js` is a single ESM file with its
dependencies bundled in — the runtime has no package manager, so nothing is
installed at deploy time.

## Deploying

Two supported routes, and they differ in who creates the resources:

- **Freebuff Sites** — the platform creates the D1 database and the R2 bucket,
  injects `APP_ORIGIN` (plus reserved platform variables this app does not use) and
  uploads the prebuilt `dist/` assets plus the Worker module. Deploy a preview first, check it,
  then publish production. Run the migrations against the deployed database
  afterwards.
- **Your own Cloudflare account** — `wrangler deploy` with the bindings already in
  [`wrangler.jsonc`](../wrangler.jsonc). Create the resources once:

  ```bash
  npx wrangler d1 create hg-arcade        # put the returned id in wrangler.jsonc
  npx wrangler r2 bucket create hg-arcade-files
  npm run db:migrate:remote
  npx wrangler deploy
  ```

**itch.io and Cloudflare Pages.** The public site is a static SPA and could be
served from Pages, but the dashboard, catalogue, D1 records and R2 artwork need
the Worker in front. Do not deploy `dist/` to Pages *instead* of the Worker: the
admin would 404 and every `/api/*` request would fail. The current single Worker
(Worker + `ASSETS`) is the supported shape, and it is already Pages-compatible in
the sense that it serves the static build. Connecting a Cloudflare Pages project
as a custom domain in front of this Worker would put a second, static layer where
the API needs to answer, so keep the existing Worker custom domain.

No new environment variables are required for itch.io embedding. The legacy build
limits (`MAX_BUILD_BYTES`, `MAX_FILE_BYTES`, `MAX_BUILD_FILES`, `MAX_ZIP_BYTES`)
still apply to the retained `/play/**` endpoints, but new listings never use them.
Apply migration `0003_itch_games.sql` with `npm run db:migrate` locally and
`npm run db:migrate:remote` on the deployment; it adds the two itch.io address
columns and leaves existing artwork and build rows untouched.

Background music needs **no extra resource or environment variable**: uploads go
to the same `FILES` R2 bucket under `music/<uuid>.<ext>` and their metadata to the
`site_settings` row created by migration `0002`. The 12 MB audio limit and the
accepted formats are application constants (`src/shared/music.ts`), not Worker
vars. If the bucket is missing or the configured object is later deleted, the
public site simply reports no music and the dashboard shows a "file is missing"
warning; upload the track again (or remove it) to clear that state.

## Secrets

Nothing secret belongs in the repo, in `wrangler.jsonc` `vars`, or in the frontend
bundle. Set these as Worker secrets (Sites → Secrets, or `npx wrangler secret put`):

| Secret | Required for | Notes |
| --- | --- | --- |
| `OWNER_LOGIN_EMAIL` | Owner sign-in | The administrator's identity: the address typed at the gate. Never shown publicly. |
| `OWNER_OTP_EMAIL` | Owner sign-in | Where one-time codes are delivered. Defaults to the login address; set it when codes should go to a different, private inbox. |
| `OWNER_SETUP_TOKEN` | First run only | A long random value that lets the owner set the first password. The setup route answers `409 already_setup` once a password exists — delete the secret anyway. |
| `RESEND_API_KEY` | Email delivery | Owner verification codes. Without it, codes cannot be sent and the dashboard says so. |
| `EMAIL_FROM` | Email delivery | Verified sender, e.g. `Arcade <verify@your-domain.example>`. |
| `EMAIL_PROVIDER` | Optional | `resend` forces Resend; the default `auto` uses it as soon as a key and sender exist. |
| `EMAIL_REPLY_TO` | Optional | Shown on verification mail. |

Where each of those values goes, what to type and how to check delivery without
seeing a code is spelled out step by step in [SETUP_EMAILS.md](../SETUP_EMAILS.md).
The **public** contact address is deliberately not in this table: it is site
content in D1, edited at **Site content → Contact**, so it can never be confused
with an authentication inbox.

`APP_ORIGIN` must be the site's own origin; the deployment injects it, and origin
matching, the session cookies and the development seam all depend on it.
The full setup walkthrough, including the DNS records and the current free-tier
limits, is in [SECURITY.md](SECURITY.md#enabling-real-delivery-with-resend).

## First run on a new deployment

1. Set `OWNER_LOGIN_EMAIL`, optionally `OWNER_OTP_EMAIL`, and `OWNER_SETUP_TOKEN`
   as Worker secrets, then deploy.
2. Open `/admin`. With no password stored the gate offers **Set up owner security**:
   enter the setup token, an administrator address, and a password (≥ 12 characters
   with a letter, a number and a symbol).
3. Enter the six-digit code that is emailed to the delivery address. Only then does
   the dashboard unlock — a password alone never does.
4. **Remove `OWNER_SETUP_TOKEN`** and redeploy. The route is already refused once a
   password exists (`409 already_setup`); removing the secret is the second lock.
5. Set the **public** contact address separately under **Site content → Contact**.
   The three addresses are independent records written by different endpoints, and
   the server refuses to publish a private one as the public address.
6. Fill in **Site content → About** and publish. The public pages update without a
   rebuild or a redeploy.

There is no seeded password, no demo account and no way to become the owner by
visiting `/admin` first: the only writer of `owner_auth.passphrase_hash` is the
setup route, and only while no password exists.

## Domain, canonical URLs and sitemap

Set the real domain once in [`src/data/site.ts`](../src/data/site.ts):

```ts
productionDomain: 'https://your-domain.example',
```

That switches on `<link rel="canonical">`, absolute `og:url` / `og:image`,
`sitemap.xml` (served by the Worker from the published games plus the static
pages) and the reminder to uncomment the sitemap line in `public/robots.txt`.
Until it is set, those are skipped rather than invented and the build logs a
warning. Attach the domain in the hosting dashboard (or a Workers custom-domain
binding) and keep `APP_ORIGIN` in step with it.

## Caching

| Route | Policy |
| --- | --- |
| `/assets/*` | `public, max-age=31536000, immutable` — content-hashed |
| `/api/catalogue`, `/api/content/*`, `/api/settings` | `public, max-age=0, must-revalidate` + weak `ETag`, so an unchanged body costs a 304 |
| `/api/media/*` (artwork, avatars, builds) | `public, max-age=0, must-revalidate` + object ETag |
| `/play/<slug>/*` (legacy local build) | entry document and JSON `no-cache`; every other build file `public, max-age=0, must-revalidate` + object ETag |
| the itch.io frame | cross-origin, cached by itch.io and the browser; never stored by this site’s service worker |
| admin and auth routes | `private, no-store` |
| `index.html`, `sw.js` | `no-cache`, so a deploy is picked up |

The frontend revalidates the catalogue and content on focus after a minute, which
is why publishing shows up for a visitor with a tab already open.

## Progressive web app

`public/manifest.webmanifest` plus generated icons make the site installable, and
`public/sw.js` caches the shell and hashed `/assets/*` while deliberately never
caching `/games/*` or the cross-origin itch.io frame: no claim is made that games
work offline. The service
worker only registers for production builds.

```bash
npm run icons   # deterministic, dependency-free PNG drawing
```

## Post-deploy checklist

1. Load `/`, `/games`, a game detail page and a deep link with `#play`.
2. Hard-refresh a game detail page (the Worker's SPA fallback serves `index.html`).
3. Play an uploaded build and confirm it runs inside the frame, and that the console
   shows no errors and no third-party requests.
4. Sign in at `/admin`: password, then a code that actually arrives at the private
   authentication address. Confirm the Contact page still shows the **public**
   address and never the private one.
5. From a signed-out browser, confirm `/api/admin/*` answers `401` and `/admin`
   shows the gate. Then confirm the same while *removing* the gate in devtools: the
   API must still refuse, because only the server's session check decides.
6. Check `Cache-Control` and `ETag` on `/api/content/about`.
7. Run the public-site checks against the deployment (the owner checks in the suite
   need the local seam, so they are expected to be skipped):

```bash
BASE_URL=https://your-domain.example npm run verify
```
