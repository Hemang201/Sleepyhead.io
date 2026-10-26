import type { Accent, AdminGame, BuildSummary, CategoryId, GameControls, GameStatus, PublicGame } from '../../src/shared/catalogue';
import { isActivatableBuild, isCatalogueGame, isPubliclyVisible } from '../../src/shared/catalogue';
import { parseItchEmbedUrl, parseItchProjectUrl } from '../../src/shared/itch';

/**
 * Every database read and write in the platform.
 *
 * One naming note: the column is `genres` while the API field is `categories` —
 * the public UI has always called them categories and the database uses the
 * wording from the project brief. The mapping happens here and nowhere else.
 */

export interface GameRow {
  id: string;
  slug: string;
  title: string;
  short_description: string;
  description: string;
  genres: string;
  tags: string;
  instructions: string;
  controls: string;
  playtime: string | null;
  version: string | null;
  update_notes: string | null;
  release_date: string | null;
  cover_alt: string;
  accent: string;
  status: GameStatus;
  listed: number;
  featured: number;
  thumbnail_key: string | null;
  banner_key: string | null;
  screenshots: string;
  itch_url: string | null;
  itch_embed_url: string | null;
  active_build_id: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  archived_at: string | null;
}

export interface BuildRow {
  id: string;
  game_id: string;
  version: string | null;
  status: BuildSummary['status'];
  entry_path: string | null;
  file_count: number;
  total_bytes: number;
  notes: string | null;
  created_at: string;
  ready_at: string | null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ mapping */

const ACCENT_SET = new Set<Accent>(['cyan', 'violet', 'pink', 'lime', 'orange', 'blue']);

export function artworkUrl(gameId: string, kind: 'thumbnail' | 'banner'): string {
  return `/api/media/artwork/${gameId}/${kind}`;
}

export function screenshotUrl(gameId: string, index: number): string {
  return `/api/media/screenshot/${gameId}/${index}`;
}

export function buildSummary(row: BuildRow): BuildSummary {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    entryPath: row.entry_path,
    fileCount: row.file_count,
    totalBytes: row.total_bytes,
    createdAt: row.created_at,
    readyAt: row.ready_at,
    notes: row.notes,
  };
}

function baseGame(row: GameRow, builds: BuildRow[]): Omit<AdminGame, 'builds'> {
  const screenshots = parseJson<string[]>(row.screenshots, []);
  const activeBuild = builds.find((build) => build.id === row.active_build_id);
  /*
   * A build with an entry path is not automatically a working build: a build
   * that failed mid-upload keeps the path it had from an earlier state, so the
   * status has to be finished as well as the path present.
   */
  const hasBuild = Boolean(activeBuild && activeBuild.entry_path && isActivatableBuild(activeBuild.status));
  /*
   * Stored addresses are re-parsed on the way out. The Worker only ever writes
   * canonical values, but a row edited by hand or written before validation
   * existed must not become a player pointing somewhere unexpected.
   */
  const project = parseItchProjectUrl(row.itch_url);
  const embed = parseItchEmbedUrl(row.itch_embed_url);
  const itch = {
    projectUrl: project.ok ? project.value.url : null,
    embedUrl: embed.ok ? embed.value.url : null,
  };
  const playable = row.status === 'published' && Boolean(itch.embedUrl);

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    shortDescription: row.short_description,
    description: row.description,
    categories: parseJson<CategoryId[]>(row.genres, []),
    tags: parseJson<string[]>(row.tags, []),
    status: row.status,
    featured: row.featured === 1,
    listed: row.listed === 1,
    accent: ACCENT_SET.has(row.accent as Accent) ? (row.accent as Accent) : 'cyan',
    releaseDate: row.release_date,
    updatedAt: row.updated_at,
    version: row.version,
    updateNotes: row.update_notes,
    instructions: row.instructions,
    controls: parseJson<GameControls>(row.controls, {}),
    estimatedPlaytime: row.playtime,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    archivedAt: row.archived_at,
    activeBuildId: row.active_build_id,
    artworkKeys: {
      thumbnail: row.thumbnail_key,
      banner: row.banner_key,
      screenshots,
    },
    artwork: {
      thumbnail: row.thumbnail_key ? artworkUrl(row.id, 'thumbnail') : null,
      banner: row.banner_key ? artworkUrl(row.id, 'banner') : null,
      screenshots: screenshots.map((_key, index) => ({ url: screenshotUrl(row.id, index), alt: `${row.title} screenshot ${index + 1}` })),
      placeholder: !row.thumbnail_key && !row.banner_key,
    },
    itch,
    build: {
      available: hasBuild,
      version: activeBuild?.version ?? null,
      entryPath: activeBuild?.entry_path ?? null,
    },
    playable,
    playUrl: playable ? itch.embedUrl : null,
    path: `/games/${row.slug}`,
  };
}

export function toAdminGame(row: GameRow, builds: BuildRow[]): AdminGame {
  return { ...baseGame(row, builds), builds: builds.map(buildSummary) };
}

export function toPublicGame(row: GameRow, builds: BuildRow[]): PublicGame {
  const { listed: _listed, createdAt: _createdAt, publishedAt: _publishedAt, archivedAt: _archivedAt, activeBuildId: _activeBuildId, artworkKeys: _artworkKeys, builds: _builds, ...rest } =
    toAdminGame(row, builds);
  return rest;
}

/** Public visibility is decided in exactly one place, on the server. */
export function isVisible(row: GameRow): boolean {
  return isPubliclyVisible(row.status, row.listed === 1);
}

/* ------------------------------------------------------------------- games */

export async function listBuilds(db: D1Database, gameIds: string[]): Promise<Map<string, BuildRow[]>> {
  const grouped = new Map<string, BuildRow[]>();
  if (gameIds.length === 0) return grouped;
  const placeholders = gameIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT * FROM builds WHERE game_id IN (${placeholders}) ORDER BY created_at DESC`)
    .bind(...gameIds)
    .all<BuildRow>();
  for (const row of results ?? []) {
    grouped.set(row.game_id, [...(grouped.get(row.game_id) ?? []), row]);
  }
  return grouped;
}

export async function listAllGames(db: D1Database): Promise<AdminGame[]> {
  const { results } = await db.prepare('SELECT * FROM games ORDER BY updated_at DESC').all<GameRow>();
  const rows = results ?? [];
  const builds = await listBuilds(db, rows.map((row) => row.id));
  return rows.map((row) => toAdminGame(row, builds.get(row.id) ?? []));
}

/**
 * The public catalogue: games a visitor can actually play, and nothing else.
 *
 * A row existing in the database is not the same thing as a published game.
 * Drafts, archives, unlisted work, announcements and temporarily unavailable
 * entries are all excluded, and a published row without an activated, valid
 * build is excluded too — a card with no game behind it is worse than an honest
 * empty shelf. The public site decides its empty state from this one list.
 */
export async function listPublicGames(db: D1Database): Promise<PublicGame[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM games
       WHERE status = 'published'
       ORDER BY featured DESC, updated_at DESC`,
    )
    .all<GameRow>();
  const rows = results ?? [];
  const builds = await listBuilds(db, rows.map((row) => row.id));
  return rows
    .map((row) => toPublicGame(row, builds.get(row.id) ?? []))
    .filter(isCatalogueGame);
}

export async function getGameRow(db: D1Database, idOrSlug: string, by: 'id' | 'slug'): Promise<GameRow | null> {
  const column = by === 'id' ? 'id' : 'slug';
  return db.prepare(`SELECT * FROM games WHERE ${column} = ?`).bind(idOrSlug).first<GameRow>();
}

export async function getGameWithBuilds(db: D1Database, idOrSlug: string, by: 'id' | 'slug'): Promise<AdminGame | null> {
  const row = await getGameRow(db, idOrSlug, by);
  if (!row) return null;
  const builds = await listBuilds(db, [row.id]);
  return toAdminGame(row, builds.get(row.id) ?? []);
}

export async function slugExists(db: D1Database, slug: string, exceptId?: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM games WHERE slug = ? AND id IS NOT ?')
    .bind(slug, exceptId ?? null)
    .first<{ id: string }>();
  return Boolean(row);
}

export interface GameWrite {
  slug: string;
  title: string;
  shortDescription: string;
  description: string;
  categories: string[];
  tags: string[];
  instructions: string;
  controls: GameControls;
  estimatedPlaytime: string | null;
  version: string | null;
  updateNotes: string | null;
  releaseDate: string | null;
  coverAlt: string;
  accent: Accent;
  status: GameStatus;
  listed: boolean;
  featured: boolean;
  /** Raw owner input; canonicalised by insert/update below. */
  itchUrl: string | null;
  itchEmbedUrl: string | null;
}

/** The canonical form of an owner-supplied address, or null when invalid. */
function storedProjectUrl(raw: string | null): string | null {
  const parsed = parseItchProjectUrl(raw);
  return parsed.ok ? parsed.value.url : null;
}

function storedEmbedUrl(raw: string | null): string | null {
  const parsed = parseItchEmbedUrl(raw);
  return parsed.ok ? parsed.value.url : null;
}

export async function insertGame(db: D1Database, id: string, write: GameWrite): Promise<void> {
  const timestamp = nowIso();
  await db
    .prepare(
      `INSERT INTO games (
        id, slug, title, short_description, description, genres, tags, instructions, controls,
        playtime, version, update_notes, release_date, cover_alt, accent, status, listed, featured,
        itch_url, itch_embed_url, created_at, updated_at, published_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id,
      write.slug,
      write.title,
      write.shortDescription,
      write.description,
      JSON.stringify(write.categories),
      JSON.stringify(write.tags),
      write.instructions,
      JSON.stringify(write.controls),
      write.estimatedPlaytime,
      write.version,
      write.updateNotes,
      write.releaseDate,
      write.coverAlt,
      write.accent,
      write.status,
      write.listed ? 1 : 0,
      write.featured ? 1 : 0,
      storedProjectUrl(write.itchUrl),
      storedEmbedUrl(write.itchEmbedUrl),
      timestamp,
      timestamp,
      write.status === 'published' ? timestamp : null,
    )
    .run();
}

export async function updateGame(db: D1Database, id: string, write: GameWrite, previousStatus: GameStatus): Promise<void> {
  const timestamp = nowIso();
  const publishedAt = write.status === 'published' ? (previousStatus === 'published' ? null : timestamp) : null;

  await db
    .prepare(
      `UPDATE games SET
        slug = ?, title = ?, short_description = ?, description = ?, genres = ?, tags = ?,
        instructions = ?, controls = ?, playtime = ?, version = ?, update_notes = ?,
        release_date = ?, cover_alt = ?, accent = ?, status = ?, listed = ?, featured = ?,
        itch_url = ?, itch_embed_url = ?,
        updated_at = ?, published_at = COALESCE(?, published_at),
        archived_at = CASE WHEN ? = 'archived' THEN ? ELSE NULL END
      WHERE id = ?`,
    )
    .bind(
      write.slug,
      write.title,
      write.shortDescription,
      write.description,
      JSON.stringify(write.categories),
      JSON.stringify(write.tags),
      write.instructions,
      JSON.stringify(write.controls),
      write.estimatedPlaytime,
      write.version,
      write.updateNotes,
      write.releaseDate,
      write.coverAlt,
      write.accent,
      write.status,
      write.listed ? 1 : 0,
      write.featured ? 1 : 0,
      storedProjectUrl(write.itchUrl),
      storedEmbedUrl(write.itchEmbedUrl),
      timestamp,
      publishedAt,
      write.status,
      timestamp,
      id,
    )
    .run();
}

export async function touchGame(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE games SET updated_at = ? WHERE id = ?').bind(nowIso(), id).run();
}

export async function deleteGame(db: D1Database, id: string): Promise<void> {
  // build_files and builds follow through ON DELETE CASCADE.
  await db.prepare('DELETE FROM games WHERE id = ?').bind(id).run();
}

/** Sets featured to a single value and returns the previous state, for undo. */
export async function setFeatured(db: D1Database, id: string, featured: boolean): Promise<void> {
  await db.prepare('UPDATE games SET featured = ?, updated_at = ? WHERE id = ?').bind(featured ? 1 : 0, nowIso(), id).run();
}

/* ------------------------------------------------------------------ artwork */

export async function setArtworkKey(
  db: D1Database,
  id: string,
  kind: 'thumbnail' | 'banner',
  key: string | null,
): Promise<void> {
  const column = kind === 'thumbnail' ? 'thumbnail_key' : 'banner_key';
  await db.prepare(`UPDATE games SET ${column} = ?, updated_at = ? WHERE id = ?`).bind(key, nowIso(), id).run();
}

export async function setScreenshotKeys(db: D1Database, id: string, keys: string[]): Promise<void> {
  await db.prepare('UPDATE games SET screenshots = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(keys), nowIso(), id).run();
}

/* ------------------------------------------------------------------- builds */

export async function createBuild(db: D1Database, build: { id: string; gameId: string; version: string | null; notes: string | null }): Promise<void> {
  await db
    .prepare('INSERT INTO builds (id, game_id, version, status, notes, created_at) VALUES (?,?,?,?,?,?)')
    .bind(build.id, build.gameId, build.version, 'uploading', build.notes, nowIso())
    .run();
}

export async function getBuildRow(db: D1Database, buildId: string): Promise<BuildRow | null> {
  return db.prepare('SELECT * FROM builds WHERE id = ?').bind(buildId).first<BuildRow>();
}

export async function getBuildFiles(db: D1Database, buildId: string): Promise<{ path: string; size: number; content_type: string }[]> {
  const { results } = await db
    .prepare('SELECT path, size, content_type FROM build_files WHERE build_id = ? ORDER BY path')
    .bind(buildId)
    .all<{ path: string; size: number; content_type: string }>();
  return results ?? [];
}

export async function getBuildFile(db: D1Database, buildId: string, path: string): Promise<{ size: number; content_type: string } | null> {
  return db
    .prepare('SELECT size, content_type FROM build_files WHERE build_id = ? AND path = ?')
    .bind(buildId, path)
    .first<{ size: number; content_type: string }>();
}

export async function recordBuildFile(
  db: D1Database,
  buildId: string,
  file: { path: string; size: number; contentType: string },
): Promise<void> {
  /*
   * The file row and the cached totals are one logical write: a file that is
   * stored but not counted makes the upload quotas wrong, and a rollup without
   * the row describes a file that does not exist. D1 `batch` runs both in one
   * implicit transaction, so a failed update cannot leave the build half-counted.
   */
  await db.batch([
    db
      .prepare(
        `INSERT INTO build_files (build_id, path, size, content_type) VALUES (?,?,?,?)
         ON CONFLICT(build_id, path) DO UPDATE SET size = excluded.size, content_type = excluded.content_type`,
      )
      .bind(buildId, file.path, file.size, file.contentType),
    db
      .prepare(
        `UPDATE builds SET
           file_count = (SELECT COUNT(*) FROM build_files WHERE build_id = ?1),
           total_bytes = (SELECT COALESCE(SUM(size), 0) FROM build_files WHERE build_id = ?1)
         WHERE id = ?1`,
      )
      .bind(buildId),
  ]);
}

export async function markBuildStatus(
  db: D1Database,
  buildId: string,
  status: BuildSummary['status'],
  entryPath?: string | null,
  notes?: string | null,
): Promise<void> {
  const ready = status === 'ready' || status === 'active';
  await db
    .prepare(
      `UPDATE builds SET status = ?, entry_path = COALESCE(?, entry_path), notes = COALESCE(?, notes),
        ready_at = CASE WHEN ? = 1 THEN COALESCE(ready_at, ?) ELSE ready_at END
       WHERE id = ?`,
    )
    .bind(status, entryPath ?? null, notes ?? null, ready ? 1 : 0, nowIso(), buildId)
    .run();
}

/**
 * Makes a build the live one for its game. The previously active build is kept
 * (marked `superseded`) so it can be restored with one click.
 *
 * The three statements are one batch: a partial activation would leave two
 * builds marked active, or a game pointing at a build that was never switched,
 * and the public page reads exactly those rows.
 */
export async function activateBuild(db: D1Database, gameId: string, buildId: string): Promise<void> {
  const timestamp = nowIso();
  await db.batch([
    db.prepare("UPDATE builds SET status = 'superseded' WHERE game_id = ? AND status = 'active'").bind(gameId),
    db.prepare("UPDATE builds SET status = 'active', ready_at = COALESCE(ready_at, ?) WHERE id = ? AND game_id = ?").bind(timestamp, buildId, gameId),
    db.prepare('UPDATE games SET active_build_id = ?, updated_at = ? WHERE id = ?').bind(buildId, timestamp, gameId),
  ]);
}

export async function deleteBuildRow(db: D1Database, buildId: string): Promise<void> {
  await db.prepare('DELETE FROM build_files WHERE build_id = ?').bind(buildId).run();
  await db.prepare('DELETE FROM builds WHERE id = ?').bind(buildId).run();
}

export async function clearActiveBuild(db: D1Database, gameId: string): Promise<void> {
  await db.prepare('UPDATE games SET active_build_id = NULL, updated_at = ? WHERE id = ?').bind(nowIso(), gameId).run();
}

export async function buildsForGame(db: D1Database, gameId: string): Promise<BuildRow[]> {
  const { results } = await db.prepare('SELECT * FROM builds WHERE game_id = ? ORDER BY created_at DESC').bind(gameId).all<BuildRow>();
  return results ?? [];
}

/* ------------------------------------------------------------------- admins */

export async function adminExists(db: D1Database, sub: string): Promise<boolean> {
  return Boolean(await db.prepare('SELECT sub FROM admins WHERE sub = ?').bind(sub).first<{ sub: string }>());
}

export async function countAdmins(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS total FROM admins').first<{ total: number }>();
  return row?.total ?? 0;
}

export async function addAdmin(db: D1Database, sub: string, email: string | null): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO admins (sub, email, created_at) VALUES (?,?,?)').bind(sub, email, nowIso()).run();
}

/* ------------------------------------------------------------------- events */

export async function recordEvent(
  db: D1Database,
  event: { actor: string; kind: string; gameId?: string | null; buildId?: string | null; detail?: string; size?: number },
): Promise<void> {
  await db
    .prepare('INSERT INTO upload_events (id, actor, game_id, build_id, kind, detail, size, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(
      crypto.randomUUID(),
      event.actor,
      event.gameId ?? null,
      event.buildId ?? null,
      event.kind,
      event.detail ?? null,
      event.size ?? 0,
      nowIso(),
    )
    .run();
}

export async function countEventsSince(
  db: D1Database,
  actor: string,
  kinds: string | string[],
  sinceIso: string,
): Promise<number> {
  const list = Array.isArray(kinds) ? kinds : [kinds];
  if (list.length === 0) return 0;
  const placeholders = list.map(() => '?').join(',');
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM upload_events
       WHERE actor = ? AND kind IN (${placeholders}) AND created_at >= ?`,
    )
    .bind(actor, ...list, sinceIso)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/* ------------------------------------------------- editable site content */

/**
 * Draft + published copies of one editable document.
 *
 * The published copy is what visitors get; the draft is what the dashboard
 * edits. Publishing copies draft over published in place, so a visitor never
 * sees a half-written document.
 */
export interface ContentRow {
  key: string;
  draft: string;
  published: string | null;
  draft_at: string | null;
  published_at: string | null;
}

export async function getContentRow(db: D1Database, key: string): Promise<ContentRow | null> {
  return db.prepare('SELECT * FROM site_content WHERE key = ?').bind(key).first<ContentRow>();
}

export async function getContentRowOrSeed(db: D1Database, key: string, seed: string): Promise<ContentRow> {
  const existing = await getContentRow(db, key);
  if (existing) return existing;
  const timestamp = nowIso();
  await db
    .prepare('INSERT OR IGNORE INTO site_content (key, draft, published, draft_at, published_at) VALUES (?,?,?,?,?)')
    .bind(key, seed, seed, timestamp, timestamp)
    .run();
  const created = await getContentRow(db, key);
  return created ?? { key, draft: seed, published: seed, draft_at: timestamp, published_at: timestamp };
}

export async function saveContentDraft(db: D1Database, key: string, json: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO site_content (key, draft, draft_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET draft = excluded.draft, draft_at = excluded.draft_at`,
    )
    .bind(key, json, nowIso())
    .run();
}

export async function publishContent(db: D1Database, key: string): Promise<ContentRow | null> {
  const timestamp = nowIso();
  await db
    .prepare('UPDATE site_content SET published = draft, published_at = ?, draft_at = ? WHERE key = ?')
    .bind(timestamp, timestamp, key)
    .run();
  return getContentRow(db, key);
}

export async function discardContentDraft(db: D1Database, key: string): Promise<ContentRow | null> {
  await db
    .prepare('UPDATE site_content SET draft = COALESCE(published, draft), draft_at = ? WHERE key = ?')
    .bind(nowIso(), key)
    .run();
  return getContentRow(db, key);
}

/* ------------------------------------------------------------- settings */

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM site_settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function putSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO site_settings (key, value, updated_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, nowIso())
    .run();
}

/**
 * Fetches a server-generated secret, creating it on first use. The value is
 * written to D1 and never leaves the server; `INSERT OR IGNORE` makes two
 * concurrent first requests agree on one value.
 */
export async function getOrCreateSecret(db: D1Database, name: string, make: () => string): Promise<string> {
  const existing = await db.prepare('SELECT value FROM app_secrets WHERE name = ?').bind(name).first<{ value: string }>();
  if (existing?.value) return existing.value;

  await db
    .prepare('INSERT OR IGNORE INTO app_secrets (name, value, created_at) VALUES (?,?,?)')
    .bind(name, make(), nowIso())
    .run();
  const stored = await db.prepare('SELECT value FROM app_secrets WHERE name = ?').bind(name).first<{ value: string }>();
  if (!stored?.value) throw new Error('Could not initialise a server secret.');
  return stored.value;
}

/* ---------------------------------------------- owner authentication record */

export interface OwnerAuthRow {
  sub: string;
  /** The administrator's login identity, separate from the OTP destination. */
  login_email: string | null;
  auth_email: string | null;
  auth_email_verified_at: string | null;
  passphrase_hash: string | null;
  passphrase_salt: string | null;
  passphrase_iters: number | null;
  passphrase_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getOwnerAuth(db: D1Database, sub: string): Promise<OwnerAuthRow | null> {
  return db.prepare('SELECT * FROM owner_auth WHERE sub = ?').bind(sub).first<OwnerAuthRow>();
}

/** Every key in `owner_auth`. Used once, to adopt a pre-upgrade row. */
export async function ownerAuthSubs(db: D1Database): Promise<string[]> {
  const rows = await db.prepare('SELECT sub FROM owner_auth ORDER BY created_at ASC LIMIT 2').all<{ sub: string }>();
  return (rows.results ?? []).map((row) => row.sub);
}

export async function setOwnerLoginEmail(db: D1Database, sub: string, email: string): Promise<void> {
  await db
    .prepare('UPDATE owner_auth SET login_email = ?, updated_at = ? WHERE sub = ?')
    .bind(email, nowIso(), sub)
    .run();
}

export async function ensureOwnerAuth(db: D1Database, sub: string): Promise<OwnerAuthRow> {
  const existing = await getOwnerAuth(db, sub);
  if (existing) return existing;
  const timestamp = nowIso();
  await db
    .prepare('INSERT OR IGNORE INTO owner_auth (sub, created_at, updated_at) VALUES (?,?,?)')
    .bind(sub, timestamp, timestamp)
    .run();
  const created = await getOwnerAuth(db, sub);
  if (!created) throw new Error('Could not create the owner authentication record.');
  return created;
}

export async function setOwnerAuthEmail(db: D1Database, sub: string, email: string): Promise<void> {
  const timestamp = nowIso();
  await db
    .prepare(
      `UPDATE owner_auth SET auth_email = ?, auth_email_verified_at = ?, updated_at = ? WHERE sub = ?`,
    )
    .bind(email, timestamp, timestamp, sub)
    .run();
}

export async function setOwnerPassphrase(
  db: D1Database,
  sub: string,
  hash: { hash: string; salt: string; iterations: number },
): Promise<void> {
  const timestamp = nowIso();
  await db
    .prepare(
      `UPDATE owner_auth SET passphrase_hash = ?, passphrase_salt = ?, passphrase_iters = ?, passphrase_at = ?, updated_at = ?
       WHERE sub = ?`,
    )
    .bind(hash.hash, hash.salt, hash.iterations, timestamp, timestamp, sub)
    .run();
}

/** Roll back a first-run record when the verification message could not be sent. */
export async function clearOwnerProvisioning(db: D1Database, sub: string): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE owner_auth
         SET login_email = NULL, auth_email = NULL, auth_email_verified_at = NULL,
             passphrase_hash = NULL, passphrase_salt = NULL, passphrase_iters = NULL,
             passphrase_at = NULL, updated_at = ?
         WHERE sub = ? AND passphrase_hash IS NOT NULL`,
      )
      .bind(nowIso(), sub),
    db.prepare("DELETE FROM auth_challenges WHERE sub = ? AND purpose = 'login' AND detail = 'setup'").bind(sub),
  ]);
}

/* -------------------------------------------------------- email challenges */

export interface ChallengeRow {
  id: string;
  sub: string;
  purpose: 'login' | 'password-change' | 'email-change';
  target_email: string;
  code_hash: string;
  attempts: number;
  status: 'sent' | 'verified' | 'failed' | 'expired' | 'superseded';
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
  provider: string | null;
  provider_ref: string | null;
  detail: string | null;
}

export async function insertChallenge(db: D1Database, row: ChallengeRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO auth_challenges (id, sub, purpose, target_email, code_hash, attempts, status, created_at, expires_at, provider, provider_ref, detail)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      row.id,
      row.sub,
      row.purpose,
      row.target_email,
      row.code_hash,
      row.attempts,
      row.status,
      row.created_at,
      row.expires_at,
      row.provider,
      row.provider_ref,
      row.detail,
    )
    .run();
}

export async function getChallenge(db: D1Database, id: string): Promise<ChallengeRow | null> {
  return db.prepare('SELECT * FROM auth_challenges WHERE id = ?').bind(id).first<ChallengeRow>();
}

/**
 * Conditionally moves a challenge between states. The expected attempt count is
 * part of the predicate so two concurrent requests cannot both spend or update
 * the same code.
 */
export async function transitionChallenge(
  db: D1Database,
  id: string,
  from: ChallengeRow['status'],
  to: ChallengeRow['status'],
  resolvedAt: string,
  attempts: number,
  detail: string | null,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE auth_challenges
       SET status = ?, resolved_at = ?, attempts = ?, detail = ?
       WHERE id = ? AND status = ? AND attempts = ?`,
    )
    .bind(to, resolvedAt, attempts, detail, id, from, attempts)
    .run();
  return result.meta.changes === 1;
}

/** Atomically increments a wrong-code counter while the challenge is still live. */
export async function incrementChallengeAttempt(
  db: D1Database,
  id: string,
  expectedAttempts: number,
  exhausted: boolean,
  now: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE auth_challenges
       SET attempts = attempts + 1,
           status = ?,
           resolved_at = ?,
           detail = ?
       WHERE id = ? AND status = 'sent' AND attempts = ?`,
    )
    .bind(exhausted ? 'failed' : 'sent', exhausted ? now : null, exhausted ? 'attempts exhausted' : null, id, expectedAttempts)
    .run();
  return result.meta.changes === 1;
}

/** Any earlier challenge for the same purpose is burned when a new one is sent. */
export async function supersedeChallenges(db: D1Database, sub: string, purpose: ChallengeRow['purpose']): Promise<void> {
  await db
    .prepare(
      `UPDATE auth_challenges SET status = 'superseded', resolved_at = ?
       WHERE sub = ? AND purpose = ? AND status = 'sent'`,
    )
    .bind(nowIso(), sub, purpose)
    .run();
}

export async function countChallengesSince(
  db: D1Database,
  sub: string,
  purpose: ChallengeRow['purpose'],
  sinceIso: string,
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS total FROM auth_challenges WHERE sub = ? AND purpose = ? AND created_at >= ?')
    .bind(sub, purpose, sinceIso)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function latestChallenge(
  db: D1Database,
  sub: string,
  purpose: ChallengeRow['purpose'],
): Promise<ChallengeRow | null> {
  return db
    .prepare('SELECT * FROM auth_challenges WHERE sub = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1')
    .bind(sub, purpose)
    .first<ChallengeRow>();
}

/* ------------------------------------------------------- verified sessions */

export interface SessionRow {
  id: string;
  sub: string;
  verified_at: string;
  expires_at: string;
  created_at: string;
  user_agent: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export async function insertSession(db: D1Database, row: SessionRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO auth_sessions (id, sub, verified_at, expires_at, created_at, user_agent)
       VALUES (?,?,?,?,?,?)`,
    )
    .bind(row.id, row.sub, row.verified_at, row.expires_at, row.created_at, row.user_agent)
    .run();
}

export async function getSession(db: D1Database, id: string): Promise<SessionRow | null> {
  return db.prepare('SELECT * FROM auth_sessions WHERE id = ?').bind(id).first<SessionRow>();
}

export async function revokeSession(db: D1Database, id: string, reason: string): Promise<void> {
  await db.prepare('UPDATE auth_sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL').bind(nowIso(), reason, id).run();
}

export async function revokeSessions(db: D1Database, sub: string, reason: string, exceptId?: string): Promise<number> {
  const result = await db
    .prepare('UPDATE auth_sessions SET revoked_at = ?, revoked_reason = ? WHERE sub = ? AND revoked_at IS NULL AND id IS NOT ?')
    .bind(nowIso(), reason, sub, exceptId ?? null)
    .run();
  return result.meta.changes ?? 0;
}

export async function countActiveSessions(db: D1Database, sub: string, nowIsoValue: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS total FROM auth_sessions WHERE sub = ? AND revoked_at IS NULL AND expires_at > ?')
    .bind(sub, nowIsoValue)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function listActiveSessions(db: D1Database, sub: string, nowIsoValue: string, limit = 10): Promise<SessionRow[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM auth_sessions WHERE sub = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY verified_at DESC LIMIT ?',
    )
    .bind(sub, nowIsoValue, limit)
    .all<SessionRow>();
  return results ?? [];
}

/* -------------------------------------------------------- security events */

export async function recordSecurityEvent(
  db: D1Database,
  event: { sub: string; kind: string; detail?: string | null },
): Promise<void> {
  await db
    .prepare('INSERT INTO security_events (id, sub, kind, detail, created_at) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(), event.sub, event.kind, event.detail ?? null, nowIso())
    .run();
}

export async function listSecurityEvents(db: D1Database, sub: string, limit = 20): Promise<SecurityEventRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM security_events WHERE sub = ? ORDER BY created_at DESC LIMIT ?')
    .bind(sub, limit)
    .all<SecurityEventRow>();
  return results ?? [];
}

export async function countSecurityEventsSince(
  db: D1Database,
  sub: string,
  kind: string,
  sinceIso: string,
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS total FROM security_events WHERE sub = ? AND kind = ? AND created_at >= ?')
    .bind(sub, kind, sinceIso)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export interface SecurityEventRow {
  id: string;
  sub: string;
  kind: string;
  detail: string | null;
  created_at: string;
}

/** Recent games for the dashboard overview, newest update first. */
export async function recentlyUpdated(db: D1Database, limit = 6): Promise<AdminGame[]> {
  const { results } = await db
    .prepare('SELECT * FROM games WHERE status != ? ORDER BY updated_at DESC LIMIT ?')
    .bind('archived', limit)
    .all<GameRow>();
  const rows = results ?? [];
  const builds = await listBuilds(db, rows.map((row) => row.id));
  return rows.map((row) => toAdminGame(row, builds.get(row.id) ?? []));
}
