import { getOwnerAuth, ownerAuthSubs } from './db';

/**
 * The single owner of this site.
 *
 * There is no identity provider in this flow. The administrator signs in with
 * the login address and password configured *on the server*, and the second
 * factor is a code sent to a separately configured private address. Nothing
 * about either address is ever sent to a browser in full, and neither is read
 * from a request body to decide who the owner is.
 *
 *   1. `OWNER_LOGIN_EMAIL`  the administrator's identity (what they type in)
 *   2. `OWNER_OTP_EMAIL`    where one-time codes are delivered (never typed in)
 *   3. the public contact address lives in the editable `contact` content
 *      document and can be a completely different address.
 *
 * `OWNER_AUTH_EMAIL` / `OWNER_EMAIL` are the older names and remain honoured as
 * a fallback for both, so an existing deployment keeps working through the
 * upgrade. `OWNER_OTP_EMAIL` takes precedence over the stored address when set.
 *
 * This module decides only *whether an owner is configured*. It never decides
 * that a request is authenticated: that is `readSession()` in
 * `lib/owner-security.ts`, and every admin request re-checks it.
 */

export interface OwnerEnv {
  OWNER_LOGIN_EMAIL?: string;
  OWNER_AUTH_EMAIL?: string;
  /** Historic name for OWNER_AUTH_EMAIL, still honoured. */
  OWNER_EMAIL?: string;
  /** Pins the OTP destination from configuration instead of the database. */
  OWNER_OTP_EMAIL?: string;
  /** Stable key for the single owner row. Defaults to `owner`. */
  OWNER_SUB?: string;
  /** Enables first-run provisioning. Refused once a password exists. */
  OWNER_SETUP_TOKEN?: string;
  DEV_OWNER_SUB?: string;
  APP_ORIGIN?: string;
}

export interface OwnerIdentity {
  sub: string;
  /** The login address, when one is configured. Never the OTP address. */
  email: string | null;
}

export interface OwnerContext {
  owner: OwnerIdentity | null;
  ownerConfigured: boolean;
  /** Server-side only. Exposed here so the auth routes can compare it. */
  loginEmail: string | null;
  /** Only the explicitly pinned OTP address; the stored one is the fallback. */
  pinnedOtpEmail: string | null;
  /** True when first-run provisioning is possible (token configured). */
  setupEnabled: boolean;
  /** True when the local development reset route may run for this request. */
  devSeam: boolean;
}

export function isLoopback(origin: string): boolean {
  try {
    const { hostname, protocol } = new URL(origin);
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]');
  } catch {
    return false;
  }
}

function normalise(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim().toLowerCase();
  return trimmed || null;
}

/** The administrator's login address: what they type, and what is compared. */
export function configuredLoginEmail(env: OwnerEnv): string | null {
  return normalise(env.OWNER_LOGIN_EMAIL) ?? normalise(env.OWNER_AUTH_EMAIL) ?? normalise(env.OWNER_EMAIL);
}

/** An OTP destination pinned by configuration (wins over the stored one). */
export function configuredOtpEmail(env: OwnerEnv): string | null {
  return normalise(env.OWNER_OTP_EMAIL);
}

/** The address a first-run code can be sent to, before anything is stored. */
export function seedOtpEmail(env: OwnerEnv): string | null {
  return configuredOtpEmail(env) ?? normalise(env.OWNER_AUTH_EMAIL) ?? normalise(env.OWNER_EMAIL);
}

export function setupToken(env: OwnerEnv): string | null {
  const value = (env.OWNER_SETUP_TOKEN ?? '').trim();
  return value || null;
}

function defaultSub(env: OwnerEnv): string {
  return (env.OWNER_SUB ?? '').trim() || 'owner';
}

/**
 * Which row in `owner_auth` belongs to the owner.
 *
 * The default key is `owner`. Installations that predate this flow have a row
 * keyed by a provider subject; if exactly one such row exists it is adopted, so
 * the password and verification address survive the upgrade instead of forcing
 * a reset. New setups always write the default key.
 */
export async function resolveOwnerSub(env: OwnerEnv & { DB: D1Database }): Promise<string> {
  const preferred = defaultSub(env);
  const subs = await ownerAuthSubs(env.DB);
  if (subs.includes(preferred)) return preferred;
  if (subs.length === 1) return subs[0]!;
  return preferred;
}

export async function resolveOwner(request: Request, env: OwnerEnv & { DB: D1Database }): Promise<OwnerContext> {
  const loginEmail = configuredLoginEmail(env);
  const pinnedOtpEmail = configuredOtpEmail(env);
  const enabled = Boolean(setupToken(env));
  const sub = await resolveOwnerSub(env);
  const auth = await getOwnerAuth(env.DB, sub);

  // Configured means: a stored owner record, or the deployment has both a login
  // identity and somewhere to send a code, plus a setup token for first run.
  const ownerConfigured = Boolean(auth) || Boolean(loginEmail && (pinnedOtpEmail ?? seedOtpEmail(env)) && enabled);

  const devSeam =
    Boolean((env.DEV_OWNER_SUB ?? '').trim()) &&
    isLoopback(new URL(request.url).origin) &&
    isLoopback(env.APP_ORIGIN ?? '') &&
    request.headers.get('x-dev-owner') === (env.DEV_OWNER_SUB ?? '').trim();

  return {
    owner: ownerConfigured ? { sub, email: loginEmail ?? auth?.login_email ?? auth?.auth_email ?? null } : null,
    ownerConfigured,
    loginEmail,
    pinnedOtpEmail,
    setupEnabled: enabled,
    devSeam,
  };
}

/**
 * Same-origin check for state-changing requests.
 *
 * A cookie session is used, so an `Origin` (or `Sec-Fetch-Site`) that does not
 * match the site is refused. A request with neither header is only allowed when
 * the request arrived on the configured origin, which keeps same-origin form
 * submissions working without opening a cross-site hole.
 */
export function isSameOriginRequest(request: Request, origin: string): boolean {
  const configured = (origin ?? '').trim().replace(/\/$/, '');
  const header = request.headers.get('origin');
  const requestOrigin = (header && header !== 'null' ? header : new URL(request.url).origin).trim().replace(/\/$/, '');

  if (configured && requestOrigin === configured) return true;

  /*
   * Local development. A harness and a browser on this machine may address the
   * same server as 127.0.0.1, localhost or [::1], so the two spellings are
   * accepted as each other — but only when *both* sides are loopback. A
   * deployed https origin can never satisfy this, which is the point: the
   * comparison is otherwise exact.
   */
  if (isLoopback(requestOrigin) && isLoopback(configured)) return true;

  return request.headers.get('sec-fetch-site') === 'same-origin';
}
