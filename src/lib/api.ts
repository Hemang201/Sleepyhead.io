import type {
  AdminGame,
  CatalogueResponse,
  GameInput,
  OverviewResponse,
  PublicGame,
  Screenshot,
} from '../shared/catalogue';
import type { ChallengePurpose, ChallengeResponse, SecurityEvent, SecurityState } from '../shared/owner-security';
import type { MusicConfig, PublicMusic } from '../shared/music';
import type { AboutContent, AppearanceSettings, ContactContent, SocialContent } from '../shared/site-content';

/**
 * The one place the browser talks to the Worker.
 *
 * Everything the catalogue shows comes from here — there is no bundled game
 * data anywhere in the frontend.
 */

export class ApiError extends Error {
  status: number;
  /** Machine-readable error code from the API, e.g. `entry_ambiguous`. */
  code?: string;
  fields?: Record<string, string>;

  constructor(status: number, message: string, code?: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/** How long a metadata read may hang before it is reported as unreachable. */
const READ_TIMEOUT_MS = 15_000;

/**
 * A read gets a deadline; an upload does not.
 *
 * A fetch that never settles leaves a page on its skeleton for ever, with no
 * error and therefore no retry. Uploads are excluded because a large build on a
 * slow connection legitimately takes minutes.
 */
function timeoutSignal(method: string): AbortSignal | undefined {
  const normalised = method.toUpperCase();
  if (normalised !== 'GET' && normalised !== 'HEAD') return undefined;
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return undefined;
  return AbortSignal.timeout(READ_TIMEOUT_MS);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  const signal = init.signal ?? timeoutSignal(init.method ?? 'GET');
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      ...(signal ? { signal } : {}),
      headers: { accept: 'application/json', ...(init.headers ?? {}) },
    });
  } catch (caught) {
    const timedOut = caught instanceof DOMException && caught.name === 'TimeoutError';
    throw new ApiError(
      0,
      timedOut
        ? 'The server took too long to answer. Check your connection and try again.'
        : 'Could not reach the server. Check your connection and try again.',
    );
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const payload = (body ?? {}) as { message?: string; error?: string; fields?: Record<string, string> };
    throw new ApiError(
      response.status,
      payload.message ?? payload.error ?? `Request failed (${response.status}).`,
      payload.error,
      payload.fields,
    );
  }

  return body as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) };
}

/* --------------------------------------------------------------- admin types */

export interface AdminSession {
  /**
   * The owner identity, returned only to a session that passed both factors.
   * Null for everyone else — an anonymous visitor never learns the address.
   */
  owner: { sub: string; email: string | null } | null;
  ownerConfigured: boolean;
  /** True when first-run provisioning is enabled on this deployment. */
  setupEnabled: boolean;
  /**
   * What the gate is allowed to know before sign-in: whether this is first-run
   * setup or a normal sign-in, and whether codes can be delivered at all.
   */
  gate: { mode: 'setup' | 'signin'; mailConfigured: boolean } | null;
  /**
   * The factors, reported by the server: whether a login address and OTP
   * destination exist, whether a password is set, whether this session passed
   * verification, and whether email delivery is configured at all.
   */
  security: SecurityState | null;
  /** The upload limits the Worker is actually enforcing. */
  limits: { maxBuildBytes: number; maxFileBytes: number; maxBuildFiles: number; maxZipBytes: number };
}

/* ----------------------------------------------------------- site content */

export interface StoredDocument<T> {
  /** The working copy the editor writes. */
  draft: T;
  /** Null until the owner publishes this document for the first time. */
  published: T | null;
  draftAt: string | null;
  publishedAt: string | null;
}

export interface ContentResponse {
  about: StoredDocument<AboutContent>;
  contact: StoredDocument<ContactContent>;
  social: StoredDocument<SocialContent>;
  appearance: AppearanceSettings;
}

export interface SiteSettingsResponse {
  appearance: AppearanceSettings;
}

export interface MusicResponse {
  music: PublicMusic;
}

export interface AdminMusicResponse {
  music: MusicConfig;
  /** Whether the track the document points at actually exists in storage. */
  available: boolean;
  /** A playable URL for the dashboard preview, even while disabled. */
  previewUrl: string | null;
  limits: { maxBytes: number; maxTitle: number };
}

export interface PublicContactResponse {
  contact: ContactContent;
  updatedAt: string | null;
}

export interface PublicSocialResponse {
  social: SocialContent;
  updatedAt: string | null;
}

export interface PublicAboutResponse {
  about: AboutContent;
  avatar: { url: string; alt: string } | null;
  updatedAt: string | null;
  preview: boolean;
}

export interface SecurityEventsResponse {
  events: SecurityEvent[];
  sessions: { id: string; verifiedAt: string; expiresAt: string; userAgent: string | null }[];
  currentSessionId: string;
}

export interface RecoveryResponse {
  recovery: { possible: boolean; steps: string[]; note: string };
}

/* --------------------------------------------------------------- the client */

export const api = {
  /* public */
  catalogue: () => request<CatalogueResponse>('/api/catalogue'),
  game: (slug: string) => request<{ game: PublicGame }>(`/api/catalogue/${encodeURIComponent(slug)}`),
  /** Public presentation settings: the decorative background. */
  settings: () => request<SiteSettingsResponse>('/api/settings'),
  /** The published background-music document (never a storage key). */
  music: () => request<MusicResponse>('/api/music'),
  /** The published About content; `preview` returns the owner's draft instead. */
  about: (preview = false) => request<PublicAboutResponse>(`/api/content/about${preview ? '?preview=1' : ''}`),
  /** The published Contact content, including the public contact address. */
  contact: () => request<PublicContactResponse>('/api/content/contact'),
  /** The published social links, in the owner's saved order. */
  social: () => request<PublicSocialResponse>('/api/content/social'),

  /* admin */
  admin: {
    session: () => request<AdminSession>('/api/admin/session'),
    overview: () => request<OverviewResponse>('/api/admin/overview'),
    games: () => request<{ games: AdminGame[] }>('/api/admin/games'),
    game: (id: string) => request<{ game: AdminGame }>(`/api/admin/games/${encodeURIComponent(id)}`),

    createGame: (input: Partial<GameInput>) => request<{ game: AdminGame }>('/api/admin/games', jsonInit('POST', input)),
    updateGame: (id: string, input: Partial<GameInput>) =>
      request<{ game: AdminGame }>(`/api/admin/games/${encodeURIComponent(id)}`, jsonInit('PATCH', input)),
    duplicateGame: (id: string) => request<{ game: AdminGame }>(`/api/admin/games/${id}/duplicate`, { method: 'POST' }),
    archiveGame: (id: string) => request<{ game: AdminGame }>(`/api/admin/games/${id}?mode=archive`, { method: 'DELETE' }),
    purgeGame: (id: string) => request<{ deleted: boolean; objects: number }>(`/api/admin/games/${id}?mode=purge`, { method: 'DELETE' }),

    /* artwork */
    uploadArtwork: (gameId: string, kind: 'thumbnail' | 'banner', image: Blob) =>
      request<{ game: AdminGame }>(`/api/admin/games/${gameId}/artwork?kind=${kind}`, { method: 'PUT', body: image }),
    deleteArtwork: (gameId: string, kind: 'thumbnail' | 'banner') =>
      request<{ game: AdminGame }>(`/api/admin/games/${gameId}/artwork?kind=${kind}`, { method: 'DELETE' }),
    addScreenshot: (gameId: string, image: Blob) =>
      request<{ game: AdminGame }>(`/api/admin/games/${gameId}/screenshots`, { method: 'POST', body: image }),
    deleteScreenshot: (gameId: string, index: number) =>
      request<{ game: AdminGame }>(`/api/admin/games/${gameId}/screenshots?index=${index}`, { method: 'DELETE' }),

    /* ------------------------------------------------------- site content */
    content: () => request<ContentResponse>('/api/admin/content'),
    saveAbout: (document: AboutContent) =>
      request<{ document: StoredDocument<AboutContent> }>('/api/admin/content/about', jsonInit('PUT', document)),
    publishAbout: () =>
      request<{ document: StoredDocument<AboutContent> }>('/api/admin/content/about/publish', { method: 'POST' }),
    discardAbout: () =>
      request<{ document: StoredDocument<AboutContent> }>('/api/admin/content/about/discard', { method: 'POST' }),
    saveContact: (document: ContactContent) =>
      request<{ document: StoredDocument<ContactContent> }>('/api/admin/content/contact', jsonInit('PUT', document)),
    publishContact: () =>
      request<{ document: StoredDocument<ContactContent> }>('/api/admin/content/contact/publish', { method: 'POST' }),
    discardContact: () =>
      request<{ document: StoredDocument<ContactContent> }>('/api/admin/content/contact/discard', { method: 'POST' }),
    saveSocial: (document: SocialContent) =>
      request<{ document: StoredDocument<SocialContent> }>('/api/admin/content/social', jsonInit('PUT', document)),
    publishSocial: () =>
      request<{ document: StoredDocument<SocialContent> }>('/api/admin/content/social/publish', { method: 'POST' }),
    discardSocial: () =>
      request<{ document: StoredDocument<SocialContent> }>('/api/admin/content/social/discard', { method: 'POST' }),
    uploadAvatar: (image: Blob) =>
      request<{ document: StoredDocument<AboutContent> }>('/api/admin/content/about/avatar', { method: 'PUT', body: image }),
    deleteAvatar: () =>
      request<{ document: StoredDocument<AboutContent> }>('/api/admin/content/about/avatar', { method: 'DELETE' }),
    saveAppearance: (settings: AppearanceSettings) =>
      request<{ appearance: AppearanceSettings }>('/api/admin/settings/appearance', jsonInit('PUT', settings)),

    /* ---------------------------------------------------- background music */
    music: () => request<AdminMusicResponse>('/api/admin/music'),
    saveMusic: (input: { title: string; enabled: boolean }) =>
      request<AdminMusicResponse>('/api/admin/music', jsonInit('PUT', input)),
    uploadMusic: (file: Blob, title: string) =>
      request<AdminMusicResponse>(`/api/admin/music/file?title=${encodeURIComponent(title)}`, {
        method: 'PUT',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      }),
    removeMusic: () => request<AdminMusicResponse>('/api/admin/music/file', { method: 'DELETE' }),

    /* --------------------------------------------------- account security */
    securityState: () => request<{ security: SecurityState }>('/api/admin/security/state'),
    challenge: (body: { purpose: ChallengePurpose; password: string; newEmail?: string }) =>
      request<ChallengeResponse>('/api/admin/auth/challenge', jsonInit('POST', body)),
    verify: (body: { challengeId: string; code: string }) =>
      request<{ verified: boolean; purpose: ChallengePurpose; appliedEmail: string | null; sessionEstablished: boolean; changeAuthorised: boolean }>(
        '/api/admin/auth/verify',
        jsonInit('POST', body),
      ),
    /** Step one of sign-in: login address and password, then a code is sent. */
    login: (body: { email: string; password: string }) =>
      request<ChallengeResponse>('/api/admin/auth/login', jsonInit('POST', body)),
    /** First run only: provisions the single owner, authorised by a setup token. */
    setup: (body: { email: string; password: string; confirm: string; setupToken: string }) =>
      request<ChallengeResponse>('/api/admin/auth/setup', jsonInit('POST', body)),
    changePassword: (body: { currentPassword: string; newPassword: string; confirm: string }) =>
      request<{ changed: boolean; revokedSessions: number }>('/api/admin/security/password', jsonInit('POST', body)),
    changeEmail: (body: { newEmail: string; password: string }) =>
      request<ChallengeResponse>('/api/admin/security/email', jsonInit('POST', body)),
    revokeSessions: (target: 'all' | 'others') =>
      request<{ revoked: number; clearedCurrent: boolean }>('/api/admin/security/sessions', jsonInit('POST', { target })),
    securityEvents: () => request<SecurityEventsResponse>('/api/admin/security/events'),
    recovery: () => request<RecoveryResponse>('/api/admin/security/recovery'),
    signOut: () => request<{ signedOut: boolean }>('/api/admin/auth/signout', { method: 'POST' }),
  },
};

export type { Screenshot };
