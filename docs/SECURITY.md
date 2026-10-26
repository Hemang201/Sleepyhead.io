# Owner security

How the private dashboard is protected, what the server enforces, and the one
piece that needs an account you own before real verification emails can be sent.

There is **no third-party sign-in**. The owner is an identity this site owns: a
password hash in the database, and a one-time code emailed to an address the
visitor never sees. Nothing here delegates authentication to a hosted provider.

Everything described here is implemented in [`worker/lib/owner.ts`](../worker/lib/owner.ts),
[`worker/lib/owner-security.ts`](../worker/lib/owner-security.ts),
[`worker/lib/email.ts`](../worker/lib/email.ts) and
[`worker/lib/crypto.ts`](../worker/lib/crypto.ts); the rules the browser also
previews live in [`src/shared/owner-security.ts`](../src/shared/owner-security.ts).

## Three addresses, none of them interchangeable

The administrator identity, the address codes are delivered to, and the public
contact address are three separate settings. They may hold three different
values, and the server never derives one from another.

| | Administrator login email | Code delivery address | Public contact address |
| --- | --- | --- | --- |
| Purpose | The name the owner types to sign in | Receives one-time codes | Visitors asking questions |
| Stored in | `owner_auth.login_email` (server-side table) | `owner_auth.auth_email` (server-side table) | `site_content` key `contact`, field `email` |
| Configured by | `OWNER_LOGIN_EMAIL` secret, or the dashboard's Account security page | `OWNER_OTP_EMAIL` secret (pinned), or the dashboard | The dashboard: **Site content → Contact** |
| Shown to the public | **Never** — masked everywhere (`o••••@e••••••.com`) | **Never** — masked everywhere | Yes: the Contact page and its `mailto:` link |
| Sent to the frontend | No (never in the bundle, never in a public API response) | No | Yes, publicly, because that is its job |

The server enforces the separation rather than trusting the dashboard:

- publishing a private address as the public contact address is refused with
  `422 email_conflict` (`worker/app.ts`, the `content/contact` save);
- neither private address is part of `/api/content/about`, `/api/content/contact`
  or `/api/settings`, and every admin response masks them with `maskEmail`;
- changing one address never writes another: the contact document and the
  `owner_auth` row are separate records written by separate endpoints, and the
  browser test suite asserts both directions.

`OWNER_AUTH_EMAIL` / `OWNER_EMAIL` are the older names for the delivery address
and are still honoured as a fallback, so an existing deployment keeps working
through the upgrade; `OWNER_OTP_EMAIL` wins over the stored value when it is set.

If you change your contact address, your sign-in address is untouched. If you move
your code-delivery address, your contact address is untouched — and the move is
emailed to the **old** address as a notice, because an address change is exactly
what an attacker holding your password would try.

## Who is allowed in, and how

1. **Identity — the login email and a password, both checked on the server.**
   The typed address is compared against the configured `OWNER_LOGIN_EMAIL` (or
   the stored `owner_auth.login_email`), and the password against a PBKDF2 hash in
   the database. There is no registration form and no way for a visitor to make
   themselves an administrator: the password is established exactly once, by the
   owner, through first-run provisioning with `OWNER_SETUP_TOKEN`, and that route
   refuses with `409 already_setup` the moment a password exists.
2. **Second factor — a code emailed to the delivery address.** A dashboard
   session row is written *only* after a six-digit code that was sent to that
   address is accepted. A correct password with no code leaves every admin API at
   `401 verification_required`, and the dashboard shows the gate instead of the
   dashboard.
3. **Authorisation — on every request.** Each admin API call re-resolves the owner
   and re-reads the session row; a session that was revoked, expired or signed out
   stops working immediately. Mutating admin requests must also come from the
   site's own origin (`isSameOriginRequest`), so a cross-site page cannot drive the
   dashboard with your cookie.

### Codes

| Property | Value |
| --- | --- |
| Length | 6 digits, from `crypto.getRandomValues` |
| Stored | Only `hash(challenge id + code)` — the plaintext never touches the database |
| Lifetime | 10 minutes |
| Guesses allowed | 5 per challenge, then it is dead |
| Reuse | Impossible: a spent challenge answers `410 challenge_spent` |
| Resend | One per 60 seconds per purpose, 8 per hour per purpose |
| New request | Supersedes the previous challenge for that purpose |

Rate limits are sticky on purpose: five wrong passwords in fifteen minutes locks
password checks for the rest of the window (`429 too_many_attempts`), and the
counters survive a reload because they are rows, not memory.

### Passwords

At least 12 characters, with a letter, a number and a symbol; common passwords,
four-in-a-row repeats, keyboard runs, and anything containing your own address or
name are refused. Stored as PBKDF2-SHA256, 100 000 iterations — the most the
Workers runtime will do — with a random salt per password. The password is never emailed, never echoed back, never logged, and
never stored in plaintext.

### Changing the password

A password change requires a **fresh** code, every time:

1. `POST /api/admin/auth/challenge` with `purpose: 'password-change'` and the
   current password → a code is emailed to the code-delivery address.
2. `POST /api/admin/auth/verify` with that code → the response sets a signed
   **change ticket** cookie (10 minutes, one use) and nothing else.
3. `POST /api/admin/security/password` with the ticket, the new password twice
   (and the current one again) → the stored hash is replaced.

Without a ticket the endpoint answers `403 fresh_verification_required`, so being
signed in is never enough. A successful change revokes **every other session**;
the device you changed it from stays signed in.

### Changing the authentication address

Requires the password *and* a code delivered to the **new** address, so a
mistyped or hostile address can never take over by itself. The old address
receives a notice. Until the code is entered the address is unchanged.

### Sessions, activity and recovery

- Sessions live in `auth_sessions` for 12 hours, identified by a signed,
  `HttpOnly`, `SameSite=Lax` cookie. The signing key is generated on first use and
  lives in `app_secrets` — server-side only.
- **Account security** lists active sessions and can sign out this device, other
  devices, or everywhere.
- The audit trail (`security_events`) records sign-ins, failed codes, failed
  password attempts, codes sent, password changes, address changes and recovery
  guidance. Several of these events are also emailed to the private address where
  the provider is configured.
- **There is no public password reset.** Anyone offering one is describing a
  vulnerability — a reset form reachable by an anonymous visitor is a way in, not
  a way back. Recovery is operator work: set `OWNER_LOGIN_EMAIL` (and
  `OWNER_OTP_EMAIL`) in the Worker environment, delete the `owner_auth` row for
  the owner (`DELETE FROM owner_auth WHERE sub = 'owner'`), then visit `/admin`
  and use **Set up owner security** with `OWNER_SETUP_TOKEN`. The dashboard prints
  these same steps, from the server, on the Account security page.

## Content the owner writes, and how it is treated

The About page, the Contact details and the social links are all stored as JSON
content documents (`site_content`, keys `about`, `contact`, `social`). They are
owner-written text that later appears on a public page, so they are treated as
untrusted at every step:

- **Authorisation is the same everywhere.** `PUT /api/admin/content/:kind`,
  `/publish` and `/discard` resolve the owner and re-read the session row on the
  request, and mutating admin requests must come from the site's own origin
  (`isSameOriginRequest`). An anonymous session is answered `401` — the browser
  suite asserts that for the social document specifically, not only for the pages
  that came before it — and an unverified session is refused the same way on every
  content route.
- **Stored text is never HTML.** Every string is stripped of tags and control
  characters when the document is normalised, and the only formatting the site
  renders is the restricted inline syntax (bold, emphasis, a safe link) emitted by
  `renderInline`, which escapes its input first. Nothing in a document can inject a
  tag, an attribute or an event handler.
- **Link URLs are validated on the server, not only in the form.**
  `socialUrlFor` (shared) and `validateSocial` (Worker) accept `https:` for external
  profiles and `mailto:` for the email platform; a value typed without a scheme is
  completed with `https://` (`github.com/you` and `//github.com/you` both become
  `https://github.com/you`); fragments and embedded credentials are dropped; and
  **every other scheme — `http:`, `javascript:`, `data:`, `file:`, `vbscript:`, `ftp:`
  — is refused rather than cleaned up**, so only `https://` or `mailto:` can reach
  an `href`. A refused URL is a `422` with the message attached to the field it came
  from, and it is not written to the stored document. Duplicate profiles are refused
  the same way.
- **Nothing secret is in a public response.** The private authentication address
  is never part of the public content payloads and is masked in every admin
  response (`maskEmail`); the social document contains only what the owner typed
  into it.
- **External links open safely.** A card carries
  `rel="noreferrer noopener"` with `target="_blank"`, and it announces the new tab
  to assistive technology instead of relying on an icon to imply it.
- **The game iframe can only point at itch.io.** Both addresses are parsed by
  `src/shared/itch.ts` in the dashboard and again in the Worker before storage, so
  a direct API call cannot bypass the form. The project address must be exactly
  `https://<creator>.itch.io/<game>`; the embed address must be exactly
  `https://itch.io/embed-upload/<digits>` with at most one six-digit `color`
  parameter. Lookalike hosts, ports, credentials, fragments, extra parameters,
  `javascript:`/`data:` URLs and the unplayable `/embed/<id>` widget are refused.
  The site never authenticates to itch.io and needs no API key, so no personal
  credential exists here to leak.
- **The embed is cross-origin and sandboxed.** The frame is served by itch.io, not
  this origin: it has no access to the site's DOM, cookies, storage or admin
  session. The `sandbox` attribute still withholds top navigation, and only
  `fullscreen; gamepad; autoplay` are delegated. A cross-origin frame cannot be
  inspected, so failures are handled by telling the visitor what to do — the
  direct itch.io link is always present and the timeout explains a stalled embed
  instead of leaving a spinner.
- **Uploads still belong to you, not to itch.io.** Cover art and screenshots are
  sniffed by magic bytes, size-capped, and stored in your own Get Pronto account
  under server-generated names. The upload endpoint requires a verified owner
  session, and the API key is a server-side secret: it is never in the bundle, a
  response or a log line. Deleting a listing deletes those files; it never touches
  itch.io. One trade-off is worth stating plainly: a Get Pronto file is addressed
  by its own URL, so a draft's artwork is not gated behind a session the way the
  old `/api/media/**` route was — the address is unguessable (a UUID filename) but
  it is public if it is shared.

## Email delivery: configured, or honestly reported as unconfigured

Codes are sent by [`worker/lib/email.ts`](../worker/lib/email.ts). The provider is
chosen at request time and its state is always reported rather than guessed:

| `EMAIL_PROVIDER` | Behaviour |
| --- | --- |
| unset / `auto` | Uses Resend when a key **and** a sender are configured; otherwise the loopback catcher on localhost, otherwise refuses |
| `resend` | Resend only |
| `local` | The development catcher, **only** when both the request origin and `APP_ORIGIN` are loopback |
| `none` | Refuses, always |

A deployment can never use the local catcher: `local` requires a loopback
`APP_ORIGIN` *and* a loopback request, and unit tests cover both refusals. With
nothing configured, requesting a code answers `503 email_unconfigured` and the
dashboard says so — it does not invent a code, log one, or accept a test code.

### Enabling real delivery with Resend

1. Create a Resend account and add the domain you will send from.
2. Add the DNS records Resend shows on the domain's **Records** tab (typically a
   DKIM `TXT` record plus SPF-related `TXT`/`MX`, sometimes `CNAME`s) and wait for
   the domain to read *verified*.
   For a quick trial without a domain, `onboarding@resend.dev` works **only** when
   sending to the address on your own Resend account.
3. Create an API key.
4. Set these as Worker secrets (never in the repo, never in `wrangler.jsonc`
   `vars`, never in the frontend):

   | Secret | Example | Notes |
   | --- | --- | --- |
   | `RESEND_API_KEY` | `re_...` | From step 3 |
   | `EMAIL_FROM` | `Arcade <verify@your-domain.example>` | Must be on the verified domain |
   | `OWNER_LOGIN_EMAIL` | `you@your-domain.example` | The administrator identity, typed at sign-in |
   | `OWNER_OTP_EMAIL` | `codes@your-domain.example` | Where codes are delivered; defaults to the login address |
   | `OWNER_SETUP_TOKEN` | a long random value | Only for the first provisioning; remove afterwards |
   | `EMAIL_PROVIDER` | `resend` | Optional; `auto` is fine |
   | `EMAIL_REPLY_TO` | `you@your-domain.example` | Optional |
   | `EMAIL_APP_NAME` | `the arcade dashboard` | Already a non-secret `var` |

5. Deploy, open `/admin`, complete **Set up owner security**, and confirm the
   email actually arrives before trusting the flow.

Cost: Resend's free plan is 3 000 emails a month and 100 a day
(<https://resend.com/pricing>, <https://resend.com/docs/knowledge-base/account-quotas-and-limits>).
Owner verification uses a handful of messages per session, so the free plan is
comfortably enough; there is no paid dependency anywhere else in this app.

> **Honest status.** Until `RESEND_API_KEY` and `EMAIL_FROM` are set on the
> deployment, **email verification is not working there** — the integration point
> exists and is exercised, delivery is not configured. The automated run proves the
> flow end to end through the loopback catcher, and the two Resend paths are unit
> tested with a stubbed `fetch`; neither of those is the same as a real message
> landing in a real inbox, and this document will not claim otherwise.

## The local development seam

`DEV_OWNER_SUB` plus a loopback `APP_ORIGIN` plus a loopback request plus the
`x-dev-owner` header makes a request count as the owner, so the dashboard can be
worked on without a second device. A deployed `https` site cannot satisfy any of
those conditions, so the seam cannot be reached there; the header alone does
nothing when `DEV_OWNER_SUB` is unset.

Two routes exist only behind that seam:

- `POST /api/admin/dev/security-reset` — clears stored security state. It takes an
  optional body to narrow the scope: `{ sessions: false }` keeps the signed-in
  session, `{ events: false }` keeps the audit trail, and `{ authEmail: true }`
  points verification back at the configured delivery address. It exists because
  the rate limits above are deliberately sticky, which makes a verification run
  unable to repeat itself without clearing the rows those limits are derived from.
- `POST /api/admin/dev/content-reset` — rewrites the About, Contact and Social
  documents to the shipped defaults, draft and published alike, so a run that
  crashed before its own cleanup cannot leave its text published. It touches only
  `site_content`, never games, builds, artwork or the owner record.

Never set `DEV_OWNER_SUB` in a production environment.

## What the automated run proves, and what is still pending

Verified in a browser against the real Worker by `npm run verify`, and directly
against the Worker's HTTP surface by `npm run audit:security` (see
[VERIFICATION.md](VERIFICATION.md)) with the loopback catcher:

- a wrong password never opens the dashboard and admin APIs answer `401`;
- a correct password alone is not a session: the dashboard still answers
  `401 verification_required` until the emailed code is accepted;
- a code is requested with the password and reported as sent to the *masked*
  delivery address;
- a wrong code is rejected and its remaining attempts reported; the right code is
  accepted; the same code cannot be replayed; the resend cooldown and its
  `Retry-After` are enforced; a wrong password never triggers a code;
- a password change without a fresh code is refused; a weak new password is
  refused; a verified change succeeds and revokes the other sessions; the old
  password stops working; the current device stays signed in;
- the authentication address changes only after a code sent to the **new** address,
  the public contact address is untouched by that, the private address is refused
  as a public one, and the address can be moved back;
- recovery guidance is server-provided and no public reset is offered;
- an anonymous visitor is refused (`401`) when it tries to write, publish or delete
  the social links, and the server itself refuses a `javascript:`, `data:` or
  plain-`http` profile URL with a `422` even when the request is made by the owner;
- password changes, address changes and failed codes all reach the audit trail;
- signing out everywhere invalidates the session immediately, and a fresh code
  restores access.

Pending, and reported as such: delivery through Resend, which needs the account
and the secrets above. Unit tests cover the provider selection and refusal paths
(`tests/email-provider.test.ts`) and the password, code, cookie and policy
primitives (`tests/owner-security.test.ts`).
