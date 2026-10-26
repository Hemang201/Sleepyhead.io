/**
 * The owner's password factor, second factor, and the only place a dashboard
 * session is created.
 *
 * The rule this module exists to enforce: **knowing the password is not
 * access**. A verified session row is written only when a code that was emailed
 * to the separately configured private authentication address is accepted, and
 * every admin API call then re-checks that row on the server.
 *
 * There is no external identity provider in this flow. The login address and
 * the OTP destination are server-side configuration; neither is trusted from a
 * request, and neither is ever returned in full.
 *
 * The verification code is generated here, hashed with the challenge id, and
 * only the hash is stored. The plaintext code exists for the single moment it is
 * handed to the email provider and is never logged, never stored, and never
 * returned to a browser except by the loopback-only local catcher.
 */

import {
  CHALLENGE_MAX_ATTEMPTS,
  CHALLENGE_MAX_PER_HOUR,
  CHALLENGE_RESEND_COOLDOWN_SECONDS,
  CHALLENGE_TTL_MINUTES,
  PASSWORD_ATTEMPT_WINDOW_MINUTES,
  PASSWORD_MAX_ATTEMPTS,
  PASSWORD_MAX_LENGTH,
  SESSION_TTL_HOURS,
  checkPassword,
  type ChallengePurpose,
  type ChallengeResponse,
  type SecurityEvent,
  type SecurityState,
} from '../../src/shared/owner-security';
import { DEFAULT_CONTACT, isEmail, maskEmail } from '../../src/shared/site-content';
import { configuredLoginEmail, configuredOtpEmail, seedOtpEmail, setupToken, type OwnerEnv } from './owner';
import {
  clearCookie,
  generateCode,
  hashCode,
  hashPassword,
  randomToken,
  readCookie,
  serializeCookie,
  signValue,
  timingSafeEqual,
  verifyPassword,
  verifySignedValue,
} from './crypto';
import {
  getChallenge,
  getOrCreateSecret,
  getOwnerAuth,
  getSession,
  insertChallenge,
  insertSession,
  latestChallenge,
  countChallengesSince,
  countSecurityEventsSince,
  countActiveSessions,
  ensureOwnerAuth,
  listActiveSessions,
  listSecurityEvents,
  recordSecurityEvent,
  revokeSession,
  revokeSessions,
  setOwnerAuthEmail,
  setOwnerLoginEmail,
  setOwnerPassphrase,
  clearOwnerProvisioning,
  supersedeChallenges,
  transitionChallenge,
  incrementChallengeAttempt,
  nowIso,
  type ChallengeRow,
  type OwnerAuthRow,
  type SessionRow,
} from './db';
import { noticeEmail, emailProvider, providerSummary, verificationEmail, type EmailEnv } from './email';

export const SESSION_COOKIE = 'hg_owner_session';
export const CHANGE_COOKIE = 'hg_owner_change';
/** The change ticket only has to outlive the form the owner is filling in. */
const CHANGE_TICKET_MINUTES = 10;
const MAX_LOGIN_EMAIL_LENGTH = 160;
export const OTP_LENGTH = 6;

/**
 * Verification codes are normalised for the existing form behaviour (which
 * tolerates accidental surrounding whitespace), but the value itself must be
 * exactly six decimal digits before it reaches the hashing path.
 */
export function isOtpCode(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return normalized.length === OTP_LENGTH && /^\d+$/.test(normalized);
}

/*
 * Unknown login identities must take the same password-work path without
 * touching the real owner's failure counter. This is a fixed, non-secret
 * verifier record; its only purpose is to keep the identity-mismatch branch
 * from becoming a cheap timing oracle. The value was derived once with the
 * same PBKDF2-SHA256 work factor used for newly stored passwords.
 */
const DUMMY_PASSWORD_HASH = {
  hash: 'tc9Yu6APMtO3WO9vKNDGj0bkX0BBq_CPy29r2dW5PWc',
  salt: 'b3duZXItZHVtbXktdjEhAA',
  iterations: 210_000,
};

export interface SecurityEnv extends EmailEnv, OwnerEnv {
  DB: D1Database;
}

export interface SecurityOwner {
  sub: string;
  email: string | null;
}

export interface Failure {
  ok: false;
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
  retryAfterSeconds?: number;
  detail?: string;
}

export interface Success<T> {
  ok: true;
  value: T;
}

export type Outcome<T> = Success<T> | Failure;

interface FailureExtra {
  /** Field-level messages, keyed by form field. */
  fields?: Record<string, string>;
  retryAfterSeconds?: number;
  /** Non-secret diagnostic from the email provider, for the operator. */
  detail?: string;
}

function fail(status: number, code: string, message: string, extra: FailureExtra = {}): Failure {
  return { ok: false, status, code, message, ...extra };
}

/* ----------------------------------------------------------------- cookies */

function secureRequest(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

/** The cookie signing key. Generated server-side on first use, never exposed. */
function cookieSecret(env: SecurityEnv): Promise<string> {
  return getOrCreateSecret(env.DB, 'owner-cookie-key', () => randomToken(32));
}

/* ------------------------------------------------------------------ helper */

function isoPlusMinutes(minutes: number, from = Date.now()): string {
  return new Date(from + minutes * 60_000).toISOString();
}

function isoPlusHours(hours: number, from = Date.now()): string {
  return new Date(from + hours * 3_600_000).toISOString();
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/* ---------------------------------------------------- reading the session */

/**
 * The current verified session, or null.
 *
 * A stale or revoked row is refreshed into its terminal state here so the audit
 * trail reflects what actually happened.
 */
export async function readSession(request: Request, env: SecurityEnv, sub: string): Promise<SessionRow | null> {
  const secret = await cookieSecret(env);
  const signed = await verifySignedValue(secret, readCookie(request, SESSION_COOKIE));
  if (!signed) return null;

  const row = await getSession(env.DB, signed.id);
  if (!row || row.sub !== sub) return null;
  if (row.revoked_at) return null;
  if (row.expires_at <= nowIso()) {
    if (!row.revoked_at) {
      await revokeSession(env.DB, row.id, 'expired');
      await recordSecurityEvent(env.DB, { sub, kind: 'session.expired', detail: null });
    }
    return null;
  }
  return row;
}

/** Signed cookie carrying the *id* of a verified session row. */
export async function buildSessionCookie(
  request: Request,
  env: SecurityEnv,
  id: string,
): Promise<string> {
  const secret = await cookieSecret(env);
  const value = await signValue(secret, { id, issuedAt: Date.now() });
  return serializeCookie(SESSION_COOKIE, value, {
    maxAgeSeconds: SESSION_TTL_HOURS * 3600,
    secure: secureRequest(request),
  });
}

export function clearSessionCookie(request: Request): string {
  return clearCookie(SESSION_COOKIE, secureRequest(request));
}

export function clearChangeCookie(request: Request): string {
  return clearCookie(CHANGE_COOKIE, secureRequest(request));
}

/* ------------------------------------------------------------ state report */

export async function securityState(
  env: SecurityEnv,
  request: Request,
  owner: SecurityOwner,
  session: SessionRow | null,
): Promise<SecurityState> {
  const [auth, pending, sessions] = await Promise.all([
    getOwnerAuth(env.DB, owner.sub),
    latestChallenge(env.DB, owner.sub, 'email-change'),
    countActiveSessions(env.DB, owner.sub, nowIso()),
  ]);
  const provider = providerSummary(env, new URL(request.url).origin);
  const pendingEmail =
    pending && pending.status === 'sent' && pending.expires_at > nowIso() ? pending.target_email : null;
  const pinned = configuredOtpEmail(env);
  const otpAddress = pinned ?? auth?.auth_email ?? null;
  const login = auth?.login_email ?? env.OWNER_LOGIN_EMAIL ?? env.OWNER_AUTH_EMAIL ?? env.OWNER_EMAIL ?? null;

  return {
    loginEmail: {
      configured: Boolean(login),
      masked: login ? maskEmail(login) : null,
    },
    authEmail: {
      configured: Boolean(otpAddress && (pinned || auth?.auth_email_verified_at)),
      masked: otpAddress ? maskEmail(otpAddress) : null,
      verifiedAt: auth?.auth_email_verified_at ?? null,
      managed: Boolean(pinned),
    },
    pendingAuthEmail: pendingEmail ? { masked: maskEmail(pendingEmail) } : null,
    passphrase: { set: Boolean(auth?.passphrase_hash), updatedAt: auth?.passphrase_at ?? null },
    publicContactEmail: await publicContactEmail(env),
    provider,
    enforcement: 'required',
    session: {
      verified: Boolean(session),
      verifiedAt: session?.verified_at ?? null,
      expiresAt: session?.expires_at ?? null,
      activeSessions: sessions,
    },
    limits: {
      challengeTtlMinutes: CHALLENGE_TTL_MINUTES,
      maxAttempts: CHALLENGE_MAX_ATTEMPTS,
      resendCooldownSeconds: CHALLENGE_RESEND_COOLDOWN_SECONDS,
      maxPerHour: CHALLENGE_MAX_PER_HOUR,
      sessionTtlHours: SESSION_TTL_HOURS,
    },
  };
}

/**
 * What an *unauthenticated* visitor is allowed to know.
 *
 * The sign-in screen has to choose between first-run setup and sign-in, and say
 * whether a code could even be delivered — that is all. No address, masked or
 * otherwise, is part of this: the destination is revealed only in the response
 * to a correct password, as a mask, once a code has actually been sent.
 */
export async function gateState(
  env: SecurityEnv,
  request: Request,
  owner: SecurityOwner,
): Promise<{ mode: 'setup' | 'signin'; mailConfigured: boolean }> {
  const auth = await getOwnerAuth(env.DB, owner.sub);
  const provider = providerSummary(env, new URL(request.url).origin);
  return {
    mode: auth?.passphrase_hash ? 'signin' : 'setup',
    mailConfigured: provider.localCatch || provider.status === 'configured',
  };
}

/**
 * The public contact address, read from the *contact content document* so the
 * dashboard can show the two addresses side by side. This never reads or writes
 * the private authentication address.
 */
async function publicContactEmail(env: SecurityEnv): Promise<string> {
  const row = await env.DB.prepare('SELECT draft, published FROM site_content WHERE key = ?')
    .bind('contact')
    .first<{ draft: string; published: string | null }>();
  /* Drafts are owner-private. A fresh database may have a draft-only row after
     an API write, so never fall back to it for a security response either. */
  const raw = row?.published ?? null;
  if (!raw) return DEFAULT_CONTACT.email;
  try {
    const parsed = JSON.parse(raw) as { email?: unknown };
    return typeof parsed.email === 'string' ? parsed.email : '';
  } catch {
    return '';
  }
}

export async function recentEvents(env: SecurityEnv, sub: string): Promise<SecurityEvent[]> {
  const rows = await listSecurityEvents(env.DB, sub, 20);
  return rows.map((row) => ({ id: row.id, kind: row.kind, detail: row.detail, createdAt: row.created_at }));
}

/* ------------------------------------------------------ challenges: start */

export interface ChallengeRequest {
  purpose: ChallengePurpose;
  /** Required for every purpose: it is the "something you know" factor. */
  password?: string;
  /** Only for `login`: the administrator identity, checked server-side. */
  email?: string;
  /** Only for `email-change`. */
  newEmail?: string;
  /** Marks a first-run setup challenge, whose verification also grants a session. */
  setup?: boolean;
}

async function passwordFailures(env: SecurityEnv, sub: string): Promise<number> {
  return countSecurityEventsSince(env.DB, sub, 'password.attempt', minutesAgo(PASSWORD_ATTEMPT_WINDOW_MINUTES));
}

async function checkPasswordFactor(
  env: SecurityEnv,
  owner: SecurityOwner,
  auth: OwnerAuthRow | null,
  password: string,
): Promise<Failure | null> {
  if (password.length > PASSWORD_MAX_LENGTH) {
    return fail(422, 'invalid', 'That password is too long.', { fields: { password: 'Keep the password under 200 characters.' } });
  }
  if (!auth?.passphrase_hash || !auth.passphrase_salt) {
    return fail(409, 'password_unset', 'Set an owner password before requesting a verification code.');
  }
  if ((await passwordFailures(env, owner.sub)) >= PASSWORD_MAX_ATTEMPTS) {
    return fail(
      429,
      'too_many_attempts',
      `Too many failed password attempts. Try again in ${PASSWORD_ATTEMPT_WINDOW_MINUTES} minutes.`,
      { retryAfterSeconds: PASSWORD_ATTEMPT_WINDOW_MINUTES * 60 },
    );
  }

  const valid = await verifyPassword(password ?? '', {
    hash: auth.passphrase_hash,
    salt: auth.passphrase_salt,
    iterations: auth.passphrase_iters ?? 210_000,
  });
  if (!valid) {
    await recordSecurityEvent(env.DB, { sub: owner.sub, kind: 'password.attempt', detail: 'failed' });
    return fail(401, 'bad_password', 'That password is not correct.');
  }
  return null;
}

async function verifyDummyPassword(password: unknown): Promise<void> {
  const candidate = typeof password === 'string' ? password.slice(0, PASSWORD_MAX_LENGTH) : '';
  await verifyPassword(candidate, DUMMY_PASSWORD_HASH);
}

/**
 * Sends a verification code. Nothing is emailed until the password factor and
 * the rate limits pass, so a wrong password never triggers a message.
 */
export async function startChallenge(
  env: SecurityEnv,
  request: Request,
  owner: SecurityOwner,
  input: ChallengeRequest,
  session: SessionRow | null,
): Promise<Outcome<ChallengeResponse>> {
  const auth = await getOwnerAuth(env.DB, owner.sub);
  const origin = new URL(request.url).origin;

  let target = '';
  let detail: string | null = input.setup ? 'setup' : null;

  if (input.purpose === 'email-change') {
    // A deployment-pinned destination cannot be moved from a browser form.
    if (configuredOtpEmail(env)) {
      return fail(
        409,
        'managed_email',
        'The verification address is set by this deployment (OWNER_OTP_EMAIL) and cannot be changed from the dashboard.',
      );
    }
    const next = (input.newEmail ?? '').trim().toLowerCase();
    if (!isEmail(next)) {
      return fail(422, 'bad_email', 'Enter a valid email address.', {
        fields: { newEmail: 'That does not look like an email address.' },
      });
    }
    if (auth?.auth_email && auth.auth_email.toLowerCase() === next) {
      return fail(422, 'same_email', 'That is already your authentication address.', {
        fields: { newEmail: 'Use a different address.' },
      });
    }

    if (input.setup) {
      // First run: nothing is verified yet, so there is no session to require and
      // no stored address to compare against. The password was validated and
      // hashed by `startSetup` a moment ago, in the same request.
      target = next;
      detail = 'setup';
    } else {
      if (!session) return fail(401, 'session_required', 'Verify your identity again before changing the address.');
      const problem = await checkPasswordFactor(env, owner, auth, input.password ?? '');
      if (problem) return problem;
      target = next;
      detail = 'change';
    }
  } else {
    const pinned = configuredOtpEmail(env);
    if (input.setup) {
      /* First-run setup has no verified stored destination yet. The configured
         seed address is the only place a code may go, and it becomes stored only
         after that code is accepted. */
      target = seedOtpEmail(env) ?? '';
      detail = 'setup';
    } else if (!pinned && (!auth?.auth_email || !auth.auth_email_verified_at)) {
      return fail(
        409,
        'auth_email_unset',
        'Set up your private authentication address first — that is where verification codes are sent.',
      );
    }

    // The login form submits an identity. An unknown identity must not write a
    // password-attempt event for the real owner, but it still takes a dummy
    // PBKDF2 path so the identity check does not become a cheap timing oracle.
    if (input.purpose === 'login') {
      const expected = (configuredLoginEmail(env) ?? auth?.login_email ?? '').trim().toLowerCase();
      const rawGiven = typeof input.email === 'string' ? input.email : '';
      const given = rawGiven.length <= MAX_LOGIN_EMAIL_LENGTH ? rawGiven.trim().toLowerCase() : '';
      if (!expected || !given || !timingSafeEqual(given, expected)) {
        await verifyDummyPassword(input.password);
        return fail(401, 'bad_credentials', 'That email and password do not match an owner account.');
      }
    }

    if (input.purpose === 'password-change' && !session) {
      return fail(401, 'session_required', 'Verify your identity again before changing the password.');
    }
    const problem = await checkPasswordFactor(env, owner, auth, input.password ?? '');
    if (problem) {
      /*
       * A wrong *password* is reported in the same words as a wrong identity, so
       * a login can never be used to discover which addresses exist. Anything
       * else — the lockout, an unset password — is passed through untouched:
       * masking a 429 as a 401 would tell the client to keep trying.
       */
      if (input.purpose === 'login' && problem.code === 'bad_password') {
        return fail(401, 'bad_credentials', 'That email and password do not match an owner account.');
      }
      return problem;
    }
    if (!target) target = pinned ?? (auth?.auth_email as string);
  }

  if (!target) return fail(409, 'auth_email_unset', 'Set up your private authentication address before requesting a code.');

  // Rate limits: a cooldown between sends, and a ceiling per hour.
  const previous = await latestChallenge(env.DB, owner.sub, input.purpose);
  if (previous?.created_at) {
    const elapsed = (Date.now() - Date.parse(previous.created_at)) / 1000;
    if (elapsed < CHALLENGE_RESEND_COOLDOWN_SECONDS) {
      return fail(
        429,
        'resend_too_soon',
        `A code was just sent. Wait ${Math.ceil(CHALLENGE_RESEND_COOLDOWN_SECONDS - elapsed)}s before requesting another.`,
        { retryAfterSeconds: Math.ceil(CHALLENGE_RESEND_COOLDOWN_SECONDS - elapsed) },
      );
    }
  }
  if ((await countChallengesSince(env.DB, owner.sub, input.purpose, hoursAgo(1))) >= CHALLENGE_MAX_PER_HOUR) {
    return fail(429, 'rate_limited', 'Too many verification codes requested in the last hour. Try again later.', {
      retryAfterSeconds: 900,
    });
  }

  const provider = emailProvider(env, origin);
  if (!provider.configured) {
    return fail(
      503,
      'email_unconfigured',
      'Email delivery is not configured on the server, so verification codes cannot be sent. See docs/SECURITY.md.',
    );
  }

  const challengeId = crypto.randomUUID();
  const code = generateCode(6);
  const createdAt = nowIso();
  const expiresAt = isoPlusMinutes(CHALLENGE_TTL_MINUTES);

  const template = verificationEmail(env, input.purpose, code, CHALLENGE_TTL_MINUTES);
  const sent = await provider.send({ to: target, ...template }, code);

  await supersedeChallenges(env.DB, owner.sub, input.purpose);
  await insertChallenge(env.DB, {
    id: challengeId,
    sub: owner.sub,
    purpose: input.purpose,
    target_email: target,
    code_hash: await hashCode(challengeId, code),
    attempts: 0,
    status: sent.ok ? 'sent' : 'failed',
    created_at: createdAt,
    expires_at: expiresAt,
    resolved_at: sent.ok ? null : createdAt,
    provider: sent.provider,
    provider_ref: sent.ref,
    detail: sent.ok ? detail : (sent.error ?? 'delivery failed'),
  });

  await recordSecurityEvent(env.DB, {
    sub: owner.sub,
    kind: 'challenge.sent',
    detail: `${input.purpose}${sent.ok ? ` via ${sent.provider}` : ' failed'}`,
  });

  if (!sent.ok) {
    return fail(
      502,
      'email_delivery_failed',
      'The email could not be sent. The provider refused it — check the server configuration.',
      { detail: sent.error },
    );
  }

  const response: ChallengeResponse = {
    challengeId,
    purpose: input.purpose,
    sentTo: maskEmail(target),
    expiresAt,
    attemptsLeft: CHALLENGE_MAX_ATTEMPTS,
    resendAfterSeconds: CHALLENGE_RESEND_COOLDOWN_SECONDS,
  };
  if (sent.localCode) response.localCode = sent.localCode;
  return { ok: true, value: response };
}

/* ------------------------------------------------------ challenges: verify */

export interface VerifiedChallenge {
  challenge: ChallengeRow;
  /** Set for `login` (and first-run setup): the new session id. */
  sessionId: string | null;
  /** Set for `password-change`: a short-lived ticket that authorises the change. */
  changeTicket: string | null;
  /** Set for `email-change`: the address that was just made the auth address. */
  appliedEmail: string | null;
  sessionCookie: string | null;
  changeCookie: string | null;
}

export async function verifyChallenge(
  env: SecurityEnv,
  request: Request,
  owner: SecurityOwner,
  challengeId: string,
  code: string,
): Promise<Outcome<VerifiedChallenge>> {
  const normalizedCode = typeof code === 'string' ? code.trim() : '';
  if (!isOtpCode(normalizedCode)) {
    return fail(422, 'bad_code', 'Enter the six-digit code.', { fields: { code: 'Enter the six-digit code.' } });
  }

  const challenge = await getChallenge(env.DB, challengeId);
  if (!challenge || challenge.sub !== owner.sub) {
    return fail(404, 'unknown_challenge', 'That verification request is no longer valid. Request a new code.');
  }
  if (challenge.status !== 'sent') {
    return fail(410, 'challenge_spent', 'That code was already used or replaced. Request a new one.');
  }
  if (challenge.expires_at <= nowIso()) {
    await transitionChallenge(env.DB, challenge.id, 'sent', 'expired', nowIso(), challenge.attempts, 'expired');
    await recordSecurityEvent(env.DB, { sub: owner.sub, kind: 'challenge.expired', detail: challenge.purpose });
    return fail(410, 'challenge_expired', 'That code has expired. Request a new one.');
  }
  if (challenge.attempts >= CHALLENGE_MAX_ATTEMPTS) {
    await transitionChallenge(env.DB, challenge.id, 'sent', 'failed', nowIso(), challenge.attempts, 'attempts exhausted');
    return fail(429, 'attempts_exhausted', 'Too many wrong codes. Request a new one.');
  }

  const expected = await hashCode(challenge.id, normalizedCode);
  if (!timingSafeEqual(expected, challenge.code_hash)) {
    const attempts = challenge.attempts + 1;
    const exhausted = attempts >= CHALLENGE_MAX_ATTEMPTS;
    const changed = await incrementChallengeAttempt(env.DB, challenge.id, challenge.attempts, exhausted, nowIso());
    if (!changed) return fail(410, 'challenge_spent', 'That code was already used or replaced. Request a new one.');
    await recordSecurityEvent(env.DB, { sub: owner.sub, kind: 'challenge.failed', detail: challenge.purpose });
    return fail(
      exhausted ? 429 : 401,
      exhausted ? 'attempts_exhausted' : 'bad_code',
      exhausted ? 'Too many wrong codes. Request a new one.' : 'That code is not correct.',
      { fields: { code: exhausted ? 'Request a new code.' : `Wrong code — ${CHALLENGE_MAX_ATTEMPTS - attempts} attempt(s) left.` } },
    );
  }

  // Accepted: the conditional state transition makes single-use enforcement
  // hold even when two verification requests arrive at the same time.
  const consumed = await transitionChallenge(env.DB, challenge.id, 'sent', 'verified', nowIso(), challenge.attempts, null);
  if (!consumed) return fail(410, 'challenge_spent', 'That code was already used or replaced. Request a new one.');

  const result: VerifiedChallenge = {
    challenge,
    sessionId: null,
    changeTicket: null,
    appliedEmail: null,
    sessionCookie: null,
    changeCookie: null,
  };

  if (challenge.purpose === 'login' && challenge.detail === 'setup') {
    // First run completes only after a real code round-trip: the configured
    // destination becomes the stored verification address now.
    await setOwnerAuthEmail(env.DB, owner.sub, challenge.target_email);
    await recordSecurityEvent(env.DB, {
      sub: owner.sub,
      kind: 'auth-email.changed',
      detail: `${maskEmail(challenge.target_email)} (first-run setup)`,
    });
  }

  if (challenge.purpose === 'email-change') {
    await setOwnerAuthEmail(env.DB, owner.sub, challenge.target_email);
    result.appliedEmail = challenge.target_email;
    await recordSecurityEvent(env.DB, {
      sub: owner.sub,
      kind: 'auth-email.changed',
      detail: challenge.detail === 'setup' ? 'first-run setup' : maskEmail(challenge.target_email),
    });
    await notify(env, request, challenge.target_email, 'Your dashboard authentication address changed', 'Verification codes for the owner dashboard will now be sent to this address.');
  }

  const needsSession = challenge.purpose === 'login' || challenge.detail === 'setup';
  if (needsSession) {
    const sessionId = crypto.randomUUID();
    result.sessionId = sessionId;
    await insertSession(env.DB, {
      id: sessionId,
      sub: owner.sub,
      verified_at: nowIso(),
      expires_at: isoPlusHours(SESSION_TTL_HOURS),
      created_at: nowIso(),
      user_agent: (request.headers.get('user-agent') ?? '').slice(0, 200) || null,
      revoked_at: null,
      revoked_reason: null,
    });
    result.sessionCookie = await buildSessionCookie(request, env, sessionId);
    await recordSecurityEvent(env.DB, { sub: owner.sub, kind: 'session.created', detail: 'verification code accepted' });
  }

  if (challenge.purpose === 'password-change') {
    const secret = await cookieSecret(env);
    result.changeTicket = await signValue(secret, { id: challenge.id, issuedAt: Date.now() });
    result.changeCookie = serializeCookie(CHANGE_COOKIE, result.changeTicket, {
      maxAgeSeconds: CHANGE_TICKET_MINUTES * 60,
      secure: secureRequest(request),
    });
  }

  return { ok: true, value: result };
}

/* ----------------------------------------------------------- first-run setup */

export interface SetupInput {
  /** The administrator identity they will sign in with. */
  email: string;
  password: string;
  confirm: string;
  /** Proves the operator authorised this first run. */
  setupToken: string;
}

/**
 * First run: provision the single owner.
 *
 * Provisioning is authorised by `OWNER_SETUP_TOKEN`, a secret the operator sets
 * in the Worker environment. It is required, compared in constant time, and the
 * route refuses forever once a password exists — so a visitor can never claim an
 * unconfigured site, and there is no default or backdoor password.
 *
 * The login address is stored immediately; the OTP destination comes from
 * configuration (`OWNER_OTP_EMAIL`, or the legacy `OWNER_AUTH_EMAIL`) and only
 * becomes the stored verification address once a code sent to it is accepted.
 * That way a typo in deployment configuration cannot silently lock the owner
 * out: setup completes only after a real code round-trip.
 */
export async function startSetup(
  env: SecurityEnv,
  request: Request,
  owner: SecurityOwner,
  input: SetupInput,
): Promise<Outcome<ChallengeResponse>> {
  const auth = await getOwnerAuth(env.DB, owner.sub);
  const token = setupToken(env);

  if (!token) {
    return fail(
      409,
      'setup_disabled',
      'Owner provisioning is disabled on this deployment. Set OWNER_SETUP_TOKEN and OWNER_LOGIN_EMAIL in the Worker environment first.',
    );
  }
  if (!timingSafeEqual((input.setupToken ?? '').trim(), token)) {
    return fail(403, 'bad_setup_token', 'That setup token is not correct.');
  }
  if (auth?.passphrase_hash) {
    return fail(409, 'already_setup', 'This dashboard already has an owner password. Sign in instead.');
  }

  const email = (input.email ?? '').trim().toLowerCase();
  if (!isEmail(email)) {
    return fail(422, 'bad_email', 'Enter a valid email address.', {
      fields: { email: 'That does not look like an email address.' },
    });
  }

  // When the deployment names an identity, that identity is the only one that
  // may be provisioned — configuration stays authoritative.
  const configured = (env.OWNER_LOGIN_EMAIL ?? env.OWNER_AUTH_EMAIL ?? env.OWNER_EMAIL ?? '').trim().toLowerCase();
  if (configured && email !== configured) {
    return fail(422, 'email_mismatch', 'This deployment is configured with a different login address.', {
      fields: { email: 'That does not match OWNER_LOGIN_EMAIL.' },
    });
  }

  const otp = seedOtpEmail(env);
  if (!otp) {
    return fail(
      503,
      'otp_unconfigured',
      'No private authentication address is configured, so a verification code cannot be sent. Set OWNER_OTP_EMAIL (or OWNER_AUTH_EMAIL) in the Worker environment.',
    );
  }

  const problem = checkPassword(input.password ?? '', [email.split('@')[0] ?? '']);
  if (problem) {
    return fail(422, 'weak_password', 'That password is not strong enough.', { fields: { password: problem } });
  }
  if ((input.password ?? '') !== (input.confirm ?? '')) {
    return fail(422, 'password_mismatch', 'The two passwords do not match.', {
      fields: { confirm: 'Passwords do not match.' },
    });
  }

  await ensureOwnerAuth(env.DB, owner.sub);
  await setOwnerLoginEmail(env.DB, owner.sub, email);
  await setOwnerPassphrase(env.DB, owner.sub, await hashPassword(input.password));

  // The code goes to the configured private address, never to a value typed into
  // this (still unauthenticated) form.
  const started = await startChallenge(
    env,
    request,
    { ...owner, email },
    { purpose: 'login', email, password: input.password, setup: true },
    null,
  );
  if (!started.ok) {
    /* Delivery/provider failures must not turn a recoverable first run into a
       permanently provisioned but unusable owner record. */
    await clearOwnerProvisioning(env.DB, owner.sub);
    return started;
  }

  await recordSecurityEvent(env.DB, { sub: owner.sub, kind: 'auth-email.pending', detail: `${maskEmail(otp)} (setup)` });
  return started;
}

/* --------------------------------------------------------------- passwords */

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
  confirm: string;
}

/** The ticket cookie proves a fresh `password-change` code was just accepted. */
async function changeTicketChallenge(
  env: SecurityEnv,
  request: Request,
  owner: SecurityOwner,
): Promise<ChallengeRow | null> {
  const secret = await cookieSecret(env);
  const signed = await verifySignedValue(secret, readCookie(request, CHANGE_COOKIE));
  if (!signed) return null;
  const challenge = await getChallenge(env.DB, signed.id);
  if (!challenge || challenge.sub !== owner.sub) return null;
  if (challenge.purpose !== 'password-change' || challenge.status !== 'verified') return null;
  if (!challenge.resolved_at) return null;
  if (Date.parse(challenge.resolved_at) + CHANGE_TICKET_MINUTES * 60_000 < Date.now()) return null;
  return challenge;
}

export async function changePassword(
  env: SecurityEnv,
  request: Request,
  owner: SecurityOwner,
  session: SessionRow | null,
  input: PasswordChangeInput,
): Promise<Outcome<{ revoked: number }>> {
  if (!session) return fail(401, 'session_required', 'Verify your identity again before changing the password.');

  const ticket = await changeTicketChallenge(env, request, owner);
  if (!ticket) {
    return fail(
      403,
      'fresh_verification_required',
      'Changing the password needs a fresh verification code sent to your authentication address.',
    );
  }

  const auth = await getOwnerAuth(env.DB, owner.sub);
  const factProblem = await checkPasswordFactor(env, owner, auth, input.currentPassword ?? '');
  if (factProblem) return factProblem;

  const problem = checkPassword(input.newPassword ?? '', [owner.email ?? '', auth?.auth_email ?? '']);
  if (problem) return fail(422, 'weak_password', 'That password is not strong enough.', { fields: { password: problem } });
  if ((input.newPassword ?? '') !== (input.confirm ?? '')) {
    return fail(422, 'password_mismatch', 'The two passwords do not match.', {
      fields: { confirm: 'Passwords do not match.' },
    });
  }
  const same = await verifyPassword(input.newPassword ?? '', {
    hash: auth?.passphrase_hash ?? '',
    salt: auth?.passphrase_salt ?? '',
    iterations: auth?.passphrase_iters ?? 210_000,
  });
  if (same) {
    return fail(422, 'password_unchanged', 'Choose a different password from the current one.', {
      fields: { newPassword: 'That is the current password.' },
    });
  }

  // Consume the fresh verification ticket before changing the password. A
  // conditional update means only one concurrent request can spend it.
  const ticketConsumed = await transitionChallenge(env.DB, ticket.id, 'verified', 'superseded', nowIso(), ticket.attempts, 'ticket used');
  if (!ticketConsumed) return fail(403, 'fresh_verification_required', 'Changing the password needs a fresh verification code.');

  await setOwnerPassphrase(env.DB, owner.sub, await hashPassword(input.newPassword));

  // The ticket is single use, and every other session dies with the old password.
  const revoked = await revokeSessions(env.DB, owner.sub, 'password changed', session.id);
  await recordSecurityEvent(env.DB, { sub: owner.sub, kind: 'password.changed', detail: `${revoked} other session(s) revoked` });
  await notify(
    env,
    request,
    configuredOtpEmail(env) ?? auth?.auth_email ?? null,
    'Your owner dashboard password was changed',
    'A new password was set for the owner dashboard. Sessions on other devices were signed out.',
  );

  return { ok: true, value: { revoked } };
}

/* ------------------------------------------------------------ email change */

export async function applyEmailChange(
  env: SecurityEnv,
  request: Request,
  owner: SecurityOwner,
  newEmail: string,
  password: string,
  session: SessionRow | null,
): Promise<Outcome<ChallengeResponse>> {
  if (!session) return fail(401, 'session_required', 'Verify your identity again before changing the address.');
  const auth = await getOwnerAuth(env.DB, owner.sub);
  const previous = auth?.auth_email ?? null;

  const started = await startChallenge(env, request, owner, { purpose: 'email-change', newEmail, password }, session);
  if (!started.ok) return started;

  await recordSecurityEvent(env.DB, {
    sub: owner.sub,
    kind: 'auth-email.pending',
    detail: `${previous ? maskEmail(previous) : 'none'} → ${maskEmail(newEmail)}`,
  });
  if (previous) {
    await notify(
      env,
      request,
      previous,
      'A new authentication address was requested',
      'Somebody with your password asked to move dashboard verification to a new address. If this was not you, change your password immediately.',
    );
  }
  return started;
}

/* --------------------------------------------------------------- sessions */

export async function revokeSessionsForOwner(
  env: SecurityEnv,
  owner: SecurityOwner,
  session: SessionRow | null,
  target: 'all' | 'others',
): Promise<Outcome<{ revoked: number; clearedCurrent: boolean }>> {
  const keep = target === 'others' ? (session?.id ?? undefined) : undefined;
  const revoked = await revokeSessions(env.DB, owner.sub, target === 'all' ? 'signed out everywhere' : 'signed out', keep);
  await recordSecurityEvent(env.DB, {
    sub: owner.sub,
    kind: 'session.revoked',
    detail: target === 'all' ? `all sessions (${revoked})` : `other sessions (${revoked})`,
  });
  const clearedCurrent = target === 'all' || !session;
  return { ok: true, value: { revoked, clearedCurrent } };
}

export async function signOut(env: SecurityEnv, owner: SecurityOwner, session: SessionRow | null): Promise<void> {
  if (!session) return;
  await revokeSession(env.DB, session.id, 'signed out');
  await recordSecurityEvent(env.DB, { sub: owner.sub, kind: 'session.revoked', detail: 'this device' });
}

export async function activeSessions(env: SecurityEnv, sub: string) {
  const rows = await listActiveSessions(env.DB, sub, nowIso(), 10);
  return rows.map((row) => ({
    id: row.id,
    verifiedAt: row.verified_at,
    expiresAt: row.expires_at,
    userAgent: row.user_agent,
  }));
}

/* --------------------------------------------------------------- recovery */

export interface RecoveryGuidance {
  possible: boolean;
  steps: string[];
  note: string;
}

/**
 * There is no public password reset, by design: the only way back in is
 * server-side configuration plus a verification code to the new address. This
 * returns the exact operator steps rather than pretending a web form can do it.
 */
export async function recoveryGuidance(env: SecurityEnv, owner: SecurityOwner): Promise<RecoveryGuidance> {
  await recordSecurityEvent(env.DB, { sub: owner.sub, kind: 'recovery.guidance', detail: null });
  return {
    possible: true,
    steps: [
      'If you still have the password, sign in at /admin and move verification to a new address from Account security (when the deployment allows it).',
      'If you lost the password, an operator must rotate OWNER_SETUP_TOKEN and OWNER_LOGIN_EMAIL in the Worker environment and deploy.',
      'Then clear the stored owner record so first-run setup returns: npx wrangler d1 execute DB --remote --command "DELETE FROM owner_auth"',
      'Also revoke every session and pending code for that owner in the same maintenance window: npx wrangler d1 execute DB --remote --command "DELETE FROM auth_sessions; DELETE FROM auth_challenges;"',
      'Visit /admin, complete Owner setup with a new password, and enter the code sent to the configured private address.',
      'Remove OWNER_SETUP_TOKEN after provisioning; setup refuses to run again while a password exists either way.',
    ],
    note: 'No public form can reset the owner password, and there is no default or recovery password. Anyone claiming otherwise is describing a vulnerability, not a feature.',
  };
}

/* ------------------------------------------------- local development reset */

/**
 * Clears this owner's security state: pending challenges, sessions and the audit
 * trail. The owner's password is never touched, and the authentication address is
 * only moved when the caller explicitly asks for it (see `authEmail` below).
 *
 * This exists for one reason: the rate limits this application enforces are
 * deliberately sticky (a password lockout lasts fifteen minutes, a resend costs
 * a minute), which is right in production and painful when the verification
 * harness needs to run twice. The route that calls it is only reachable by a
 * request that authenticated through the local development seam, which needs
 * `DEV_OWNER_SUB`, a loopback `APP_ORIGIN` and a loopback request — none of
 * which a deployed site can satisfy.
 *
 * The scope matters: every rate limit is derived from rows that are deleted
 * here (the resend cooldown from the newest challenge, the password lockout
 * from recent `password.attempt` events), so a harness that has to trip a limit
 * on purpose needs to clear those rows *between* steps. Clearing sessions at the
 * same time would evict the session under test, so `sessions` can be left alone.
 */
export interface ResetScope {
  /** Pending verification challenges — frees the resend cooldown. Default: true. */
  challenges?: boolean;
  /** The audit trail — frees the failed-password window. Default: true. */
  events?: boolean;
  /** Owner sessions. Default: true; pass false to stay signed in. */
  sessions?: boolean;
  /**
   * The upload budget (`upload_events`), which throttles build uploads to 40 an
   * hour. Default: false, because that log is the dashboard's upload history as
   * well as a rate limit; a local verification run that uploads several builds
   * asks for it explicitly so it can be repeated inside the hour.
   */
  uploads?: boolean;
  /**
   * Point verification back at the configured `OWNER_AUTH_EMAIL`. Default:
   * false, because a harness step that is testing an address change must not have
   * its work undone. A run that ended early can leave verification on a temporary
   * address, so the first reset of a run can ask for this to start from a known
   * state. Only ever moves the address *to* the operator's configured value.
   */
  authEmail?: boolean;
}

export interface ResetResult {
  challenges: number;
  sessions: number;
  events: number;
  uploads: number;
  /** What happened to the authentication address. Never the address itself. */
  authEmail: 'restored' | 'already-configured' | 'unconfigured' | 'untouched';
}

export async function resetSecurityState(
  env: SecurityEnv,
  sub: string,
  scope: ResetScope = {},
): Promise<ResetResult> {
  const wanted = {
    challenges: scope.challenges !== false,
    sessions: scope.sessions !== false,
    events: scope.events !== false,
  };
  const tables: ('auth_challenges' | 'auth_sessions' | 'security_events')[] = [];
  if (wanted.challenges) tables.push('auth_challenges');
  if (wanted.sessions) tables.push('auth_sessions');
  if (wanted.events) tables.push('security_events');

  const counts = await Promise.all(tables.map((table) => countRows(env, table, sub)));
  await env.DB.batch(tables.map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE sub = ?`).bind(sub)));

  /* Upload events are keyed by the actor, not by `sub`, and they are the upload
     budget as well as an audit trail — so they are only cleared on request. */
  let uploads = 0;
  if (scope.uploads) {
    const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM upload_events WHERE actor = ?')
      .bind(sub)
      .first<{ total: number }>();
    uploads = row?.total ?? 0;
    await env.DB.prepare('DELETE FROM upload_events WHERE actor = ?').bind(sub).run();
  }

  let authEmail: ResetResult['authEmail'] = 'untouched';
  if (scope.authEmail) {
    const configured = seedOtpEmail(env) ?? '';
    const stored = await getOwnerAuth(env.DB, sub);
    if (!isEmail(configured)) authEmail = 'unconfigured';
    else if (stored?.auth_email?.toLowerCase() === configured) authEmail = 'already-configured';
    else {
      await setOwnerAuthEmail(env.DB, sub, configured);
      authEmail = 'restored';
    }
  }

  const named = (table: (typeof tables)[number]) => counts[tables.indexOf(table)] ?? 0;
  return {
    challenges: named('auth_challenges'),
    sessions: named('auth_sessions'),
    events: named('security_events'),
    uploads,
    authEmail,
  };
}

async function countRows(env: SecurityEnv, table: 'auth_challenges' | 'auth_sessions' | 'security_events', sub: string): Promise<number> {
  // The table name is a literal union, never user input.
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE sub = ?`)
    .bind(sub)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/* -------------------------------------------------------------- notifying */

async function notify(
  env: SecurityEnv,
  request: Request,
  to: string | null,
  title: string,
  detail: string,
): Promise<void> {
  if (!to) return;
  const provider = emailProvider(env, new URL(request.url).origin);
  if (!provider.configured) return;
  const template = noticeEmail(env, title, detail);
  await provider.send({ to, ...template }, '');
}
