/**
 * Cryptography for owner authentication.
 *
 * Everything here uses WebCrypto, so the same code runs in the Worker, in
 * Miniflare during local development and in the test runner. Nothing in this
 * file logs a secret, and nothing returns a value that is safe to send to a
 * browser except the signed cookie and its public metadata.
 */

const encoder = new TextEncoder();

/* ------------------------------------------------------------------ base64 */

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function randomToken(bytes = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/* -------------------------------------------------------------- comparison */

/** Length-independent comparison, so a wrong code cannot be timed byte by byte. */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

/* ------------------------------------------------------------------- hmac */

export async function hmac(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

/* ------------------------------------------------------------- passphrases */

/**
 * The most PBKDF2 work the Workers runtime will do.
 *
 * `crypto.subtle.deriveBits` there refuses any count above this with
 * `NotSupportedError: iteration counts above 100000 are not supported`, which is
 * not something the surrounding auth code was written to expect — it escaped as
 * an unhandled 500 from `/api/admin/auth/setup`. Every derivation therefore has
 * to pass a count this runtime accepts.
 */
export const PBKDF2_MAX_ITERATIONS = 100_000;

/** PBKDF2-SHA256 work factor: the runtime ceiling, which is the most it allows. */
export const PBKDF2_ITERATIONS = PBKDF2_MAX_ITERATIONS;
const PBKDF2_KEY_BYTES = 32;

/**
 * Clamps a requested work factor to what this runtime supports, so every hash
 * this code writes can be verified wherever it is later deployed.
 */
function supportedIterations(iterations: number): number {
  if (!Number.isFinite(iterations) || iterations < 1) return PBKDF2_ITERATIONS;
  return Math.min(Math.floor(iterations), PBKDF2_MAX_ITERATIONS);
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    key,
    PBKDF2_KEY_BYTES * 8,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

export interface PasswordHash {
  hash: string;
  salt: string;
  iterations: number;
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<PasswordHash> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  // The stored count is the count actually used, so the record stays
  // self-describing for a runtime with a different ceiling.
  const factor = supportedIterations(iterations);
  return {
    hash: await derive(password, salt, factor),
    salt: bytesToBase64Url(salt),
    iterations: factor,
  };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  if (!stored.hash || !stored.salt) return false;
  const factor = stored.iterations || PBKDF2_ITERATIONS;
  const salt = base64UrlToBytes(stored.salt);
  let candidate: string;
  try {
    /* The stored count is honoured, not assumed: a record written by a runtime
       that allowed a higher factor still verifies wherever that work can be
       done. Where it cannot — Cloudflare refuses anything above the ceiling —
       the refusal is a failed check, never an unhandled 500. */
    candidate = await derive(password, salt, factor);
  } catch {
    return false;
  }
  return timingSafeEqual(candidate, stored.hash);
}

/* -------------------------------------------------------------- otp codes */

/**
 * A six-digit code from a cryptographically secure source, with the modulo bias
 * removed by rejection sampling.
 */
export function generateCode(digits = 6): string {
  const max = 10 ** digits;
  const limit = Math.floor(0xffffffff / max) * max;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const value = buffer[0] ?? 0;
    if (value < limit) return String(value % max).padStart(digits, '0');
  }
}

/** Codes are stored only as a hash, bound to their challenge id. */
export async function hashCode(challengeId: string, code: string): Promise<string> {
  return sha256(`${challengeId}:${code.trim()}`);
}

/* ----------------------------------------------------------------- cookies */

export interface CookieOptions {
  maxAgeSeconds: number;
  secure: boolean;
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
  ];
  // A deployed origin is always https; local http development must still work.
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, secure: boolean): string {
  const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

export interface SignedValue {
  id: string;
  issuedAt: number;
}

/** `v1.<id>.<issuedAtMs>.<hmac>` — opaque, tamper-evident, revocable via D1. */
export async function signValue(secret: string, value: SignedValue): Promise<string> {
  const payload = `${value.id}.${value.issuedAt}`;
  return `v1.${payload}.${await hmac(secret, payload)}`;
}

export async function verifySignedValue(secret: string, cookie: string | null): Promise<SignedValue | null> {
  if (!cookie) return null;
  const [version, id, issuedAt, signature] = cookie.split('.');
  if (version !== 'v1' || !id || !issuedAt || !signature) return null;
  if (!(await timingSafeEqual(await hmac(secret, `${id}.${issuedAt}`), signature))) return null;
  const issued = Number(issuedAt);
  if (!Number.isFinite(issued)) return null;
  return { id, issuedAt: issued };
}
