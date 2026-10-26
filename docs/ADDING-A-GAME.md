# Publishing a game

Games are **data on this site and code on itch.io**. Nothing on this site needs
editing, rebuilding or redeploying to publish one: you connect the itch.io release,
upload the artwork and press Publish. The public pages read the catalogue from the
Worker, which reads it from D1; the game itself is framed from itch.io.

## Before you start

- Sign in at `/admin` (password, then the code emailed to your private
  authentication address — see [SECURITY.md](SECURITY.md)).
- Have the game released on itch.io as an **HTML5** project, with the file
  available to the audience you want to play it. An unlisted itch.io page is still
  reachable by anyone with its address.
- Copy two addresses from itch.io:
  1. the public page: `https://yourname.itch.io/your-game`;
  2. the playable iframe: open *Edit game → Embed*, choose the HTML5 upload, and
     copy the iframe `src`, which starts with `https://itch.io/embed-upload/`.
     This id belongs to the uploaded file, not the project, and cannot be derived
     from the page address.

## The four steps

**Games → Add new game**, then work through the stepper. Each step can be
revisited, and a new game always starts as a **draft**.

### 1. Info (and the itch.io connection)

| Field | Notes |
| --- | --- |
| Title | Shown everywhere. Required. |
| Slug | The URL segment: `/games/<slug>`. Generated from the title, editable, must be unique. |
| Short description | One line for cards and search results. |
| Description | Detail-page copy. |
| itch.io Game URL | The public project page. Required before publishing. |
| itch.io Embed URL | The playable `/embed-upload/<id>` address. Required before publishing. |
| Genres | From the fixed category list. |
| Tags | Free-form, capped, used by search and filtering. |
| Instructions / controls | Shown on the detail page. Optional but useful. |
| Estimated playtime / version / release date | Metadata for the detail page and cards. |
| Accent | Card colour accent. |
| Featured | Pins it into the home page's featured row (a curated order, not a ranking). |
| Status | See the table below. Publishing additionally requires cover art. |

Both addresses are validated in the browser and in the Worker. Only HTTPS on the
exact itch.io hosts is accepted. `http://`, other domains, lookalikes,
`javascript:`/`data:` URLs, credentials, ports, extra query parameters and the
`/embed/<id>` store widget are refused with an explanation. `/embed/<id>` is a
buy/download card, not a game.

### 2. Player

Shows exactly what is saved, explains where the embed address comes from, and can
load the real itch.io player in a preview. The preview is opt-in (nothing is
requested from itch.io until you press the button), is sandboxed, and **never
changes publication state**. A blank preview usually means the itch.io project is
private, still processing, or not an HTML5 build; open the embed address directly
to see itch.io's own message.

### 3. Artwork

Thumbnail, banner and up to twelve screenshots. PNG, JPEG, WebP, GIF or AVIF, 8 MB
each; the type is sniffed from the bytes, not trusted from the filename. The files
are stored in this site's R2 bucket and served from `/api/media/**` — nothing is
fetched from itch.io automatically, and missing artwork shows the site's labelled
placeholder. A game cannot be published without cover art.

### 4. Publish

The last step previews the real card and header, then publishes. Publishing
requires a title, cover art, and both itch.io addresses. The API enforces the same
rules, so a direct request cannot publish an incomplete listing; the editor lists
what is still missing.

## Statuses and what visitors see

| Status | Public? | Playable | Notes |
| --- | --- | --- | --- |
| Draft | Never | No | The initial state. Only you can see it. |
| In development | Only if listed | No | A public preview with no Play button. |
| Coming soon | Only if listed | No | An announcement. |
| Published | Yes | Yes, with both addresses saved | The normal state for a finished game. |
| Temporarily unavailable | Only if listed | No | For a game that is being fixed on itch.io. |
| Archived | Never | No | Hidden from the public site, kept in the dashboard. |

Drafts and archived games are never public whichever way the "listed" switch is
set, which the browser suite asserts from an anonymous context.

## Editing, unpublishing and deleting

- **Edit** title, descriptions, artwork or either itch.io address at any time. It
  is a database write: the public page reflects it on the next revalidation, with
  no deploy. Replacing the game file on itch.io produces a new embed id — paste
  the new address into the listing.
- **Unpublish** (status → Draft, or the *Unpublish* action in the table) removes
  the listing from the library while keeping its artwork and addresses.
- **Archive** hides it from the public site without deleting anything.
- **Delete** removes the database record and the artwork stored on this site. It
  never touches the itch.io project. There is no undo, and the confirmation says
  so.

## What the public site does with it

- `/games` lists everything publicly visible, with search, genre filters and four
  sort modes (`featured`, `newest`, `A–Z`, `recently updated`).
- `/games/<slug>` renders the cover, description, screenshots, controls and the
  player. The player is the saved itch.io embed; the page also always offers the
  direct itch.io link, including when the frame stays blank.
- The home page shows the featured row, and `sitemap.xml` lists published games
  only.
- Nothing is cached in a way that hides a change: the catalogue and content APIs
  revalidate every request (`max-age=0, must-revalidate` with an ETag), and open
  tabs refresh on focus after a minute. No rebuild is involved at any point.

## Tuning the itch.io side

- **HTML5 only.** The embed plays an HTML5 upload; a downloadable ZIP is not a
  playable embed.
- **Embed options.** The `/embed-upload/` snippet from *Edit game → Embed* is the
  supported player. Setting viewport dimensions there affects itch.io's own page;
  this site gives the frame a large area and lets itch scale the game.
- **Mobile friendly.** Enable it on itch.io if the game works on phones; itch.io
  handles its touch controls.
- **Access.** Public is simplest. Restricted projects may work if the visitor is
  allowed to see them, but the site cannot detect that — the frame will show
  itch.io's own message and the direct link is the fallback.
