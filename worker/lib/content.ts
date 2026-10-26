/**
 * Editable content: reading, writing and publishing.
 *
 * Every document has a draft and a published copy. Visitors only ever read the
 * published copy (or the shipped defaults before the owner publishes anything);
 * the draft is reachable only with an owner session on the server.
 */

import {
  DEFAULT_ABOUT,
  DEFAULT_APPEARANCE,
  DEFAULT_CONTACT,
  DEFAULT_SOCIAL,
  normaliseAbout,
  normaliseAppearance,
  normaliseContact,
  normaliseSocial,
  type AboutContent,
  type AppearanceSettings,
  type ContactContent,
  type SocialContent,
} from '../../src/shared/site-content';
import { DEFAULT_MUSIC, normaliseMusic, type MusicConfig } from '../../src/shared/music';
import {
  discardContentDraft,
  getContentRowOrSeed,
  getSetting,
  publishContent,
  putSetting,
  saveContentDraft,
} from './db';

export const CONTENT_KEY_ABOUT = 'about';
export const CONTENT_KEY_CONTACT = 'contact';
export const CONTENT_KEY_SOCIAL = 'social';
export const SETTING_APPEARANCE = 'appearance';
export const SETTING_MUSIC = 'music';

/** The documents the editor writes. Each has its own draft and published copy. */
export type ContentKey = 'about' | 'contact' | 'social';

export interface StoredContent<T> {
  draft: T;
  /** Null until the owner has published this document for the first time. */
  published: T | null;
  draftAt: string | null;
  publishedAt: string | null;
}

function parse<T>(raw: string | null, fallback: T, normalise: (value: unknown) => T): T {
  if (!raw) return fallback;
  try {
    return normalise(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

/**
 * Seeds a document from the shipped defaults on first read, so the dashboard
 * always has something real to edit and the public site never has to special
 * case "nothing has been published yet".
 */
async function readDoc<T>(
  db: D1Database,
  key: string,
  fallback: T,
  normalise: (value: unknown) => T,
): Promise<StoredContent<T>> {
  const row = await getContentRowOrSeed(db, key, JSON.stringify(fallback));
  return {
    draft: parse(row.draft, fallback, normalise),
    published: row.published ? parse(row.published, fallback, normalise) : null,
    draftAt: row.draft_at,
    publishedAt: row.published_at,
  };
}

export function readAbout(db: D1Database): Promise<StoredContent<AboutContent>> {
  return readDoc(db, CONTENT_KEY_ABOUT, DEFAULT_ABOUT, normaliseAbout);
}

export function readContact(db: D1Database): Promise<StoredContent<ContactContent>> {
  return readDoc(db, CONTENT_KEY_CONTACT, DEFAULT_CONTACT, normaliseContact);
}

export function readSocial(db: D1Database): Promise<StoredContent<SocialContent>> {
  return readDoc(db, CONTENT_KEY_SOCIAL, DEFAULT_SOCIAL, normaliseSocial);
}

/** The public view: published when it exists, otherwise the shipped defaults.
 * Drafts are never a public fallback; a draft-only row can exist briefly after
 * a direct admin API write on a fresh database. */
export async function publicAbout(db: D1Database): Promise<{ content: AboutContent; updatedAt: string | null }> {
  const stored = await readAbout(db);
  return { content: stored.published ?? DEFAULT_ABOUT, updatedAt: stored.publishedAt };
}

export async function publicContact(db: D1Database): Promise<{ content: ContactContent; updatedAt: string | null }> {
  const stored = await readContact(db);
  return { content: stored.published ?? DEFAULT_CONTACT, updatedAt: stored.publishedAt };
}

export async function publicSocial(db: D1Database): Promise<{ content: SocialContent; updatedAt: string | null }> {
  const stored = await readSocial(db);
  return { content: stored.published ?? DEFAULT_SOCIAL, updatedAt: stored.publishedAt };
}

export async function readAppearance(db: D1Database): Promise<AppearanceSettings> {
  const raw = await getSetting(db, SETTING_APPEARANCE);
  if (!raw) return DEFAULT_APPEARANCE;
  try {
    return normaliseAppearance(JSON.parse(raw));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export async function writeAppearance(db: D1Database, value: unknown): Promise<AppearanceSettings> {
  const settings = normaliseAppearance(value);
  // Settings apply immediately: unlike page content they have no draft state.
  await putSetting(db, SETTING_APPEARANCE, JSON.stringify(settings));
  return settings;
}

/**
 * The background-music document. Like the appearance settings it applies
 * immediately and has no draft: the owner's saved track is the published one.
 * The audio bytes live in R2; only the key and its metadata are stored here.
 */
export async function readMusic(db: D1Database): Promise<MusicConfig> {
  const raw = await getSetting(db, SETTING_MUSIC);
  if (!raw) return DEFAULT_MUSIC;
  try {
    return normaliseMusic(JSON.parse(raw));
  } catch {
    return DEFAULT_MUSIC;
  }
}

export async function writeMusic(db: D1Database, value: unknown): Promise<MusicConfig> {
  const music = normaliseMusic(value);
  await putSetting(db, SETTING_MUSIC, JSON.stringify(music));
  return music;
}

/** Only ever touches the `music/` prefix, so builds and artwork are safe. */
export function isMusicKey(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('music/');
}

/**
 * Restores the shipped track and deletes every uploaded one.
 *
 * Used by the local-development reset the verification harness calls before a
 * run, so a previous run's upload can never be mistaken for the owner's own
 * configuration. Only the `music/` prefix is listed and deleted, so game builds
 * and artwork are never at risk; the document is then rewritten to the bundled
 * default instead of being deleted, which keeps the public page's behaviour
 * identical to a fresh deployment.
 */
export async function resetMusicToDefaults(env: { DB: D1Database; FILES: R2Bucket }): Promise<number> {
  const listed = await env.FILES.list({ prefix: 'music/', limit: 1000 });
  const keys = listed.objects.map((object) => object.key).filter(isMusicKey);
  if (keys.length > 0) await env.FILES.delete(keys);
  await writeMusic(env.DB, DEFAULT_MUSIC);
  return keys.length;
}

/** Reads the document just written, so write/publish/discard all return the
 *  same shape the editor expects. */
function readDocAs<T>(db: D1Database, key: ContentKey): Promise<StoredContent<T>> {
  switch (key) {
    case 'about':
      return readAbout(db) as unknown as Promise<StoredContent<T>>;
    case 'contact':
      return readContact(db) as unknown as Promise<StoredContent<T>>;
    default:
      return readSocial(db) as unknown as Promise<StoredContent<T>>;
  }
}

export async function writeDraft<T>(db: D1Database, key: ContentKey, value: unknown): Promise<StoredContent<T>> {
  const serialised = JSON.stringify(value);
  if (serialised.length > 128 * 1024) throw new Error('That content document is too large to store.');
  await saveContentDraft(db, key, serialised);
  return readDocAs<T>(db, key);
}

export async function publishDoc<T>(db: D1Database, key: ContentKey): Promise<StoredContent<T>> {
  await publishContent(db, key);
  return readDocAs<T>(db, key);
}

export async function discardDoc<T>(db: D1Database, key: ContentKey): Promise<StoredContent<T>> {
  await discardContentDraft(db, key);
  return readDocAs<T>(db, key);
}

/** The shipped defaults, keyed by document, as the only reset source there is. */
const DEFAULT_DOCUMENTS: Record<ContentKey, unknown> = {
  about: DEFAULT_ABOUT,
  contact: DEFAULT_CONTACT,
  social: DEFAULT_SOCIAL,
};

/**
 * Puts every editable document back to the shipped defaults, draft *and*
 * published.
 *
 * This exists for local development and for the verification harness, which
 * edits the About page and the social links and has to start from a known
 * baseline every time. It is reached only through the loopback development seam
 * (see `worker/app.ts`), never with an ordinary owner session, so a deployed
 * site cannot call it — the defaults are a build artefact, not owner data, and
 * there is no way to express "the owner asked for this".
 */
export async function resetContentToDefaults(db: D1Database): Promise<ContentKey[]> {
  const keys: ContentKey[] = ['about', 'contact', 'social'];
  for (const key of keys) {
    const serialised = JSON.stringify(DEFAULT_DOCUMENTS[key]);
    await saveContentDraft(db, key, serialised);
    await publishContent(db, key);
  }
  return keys;
}

/* ------------------------------------------------------------------ avatar */

const AVATAR_PREFIX = 'content/avatar/';

export function isAvatarKey(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(AVATAR_PREFIX);
}

/**
 * Deletes avatar objects that no live document references any more.
 *
 * Only ever touches this prefix, so game builds and artwork are never at risk,
 * and it runs after the database has already been updated — a failure here
 * leaves an orphaned object, never a broken page.
 */
export async function pruneAvatars(env: { FILES: R2Bucket }, keep: (string | null | undefined)[]): Promise<number> {
  const keepSet = new Set(keep.filter(isAvatarKey));
  const listed = await env.FILES.list({ prefix: AVATAR_PREFIX, limit: 100 });
  const doomed = listed.objects.map((object) => object.key).filter((key) => !keepSet.has(key));
  if (doomed.length > 0) await env.FILES.delete(doomed);
  return doomed.length;
}

export async function avatarKeyFor(db: D1Database, preview: boolean): Promise<string | null> {
  const stored = await readAbout(db);
  const source = preview ? stored.draft : stored.published;
  return source?.avatarKey ?? null;
}

export type { AboutContent, AppearanceSettings, ContactContent, SocialContent };
