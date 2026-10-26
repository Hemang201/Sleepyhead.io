/// <reference types="@cloudflare/workers-types" />

import { describe, expect, it } from 'vitest';

import {
  CHALLENGE_MAX_ATTEMPTS,
  CHALLENGE_TTL_MINUTES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SECURITY_EVENT_LABELS,
  checkPassword,
} from '../src/shared/owner-security';
import {
  PBKDF2_ITERATIONS,
  PBKDF2_MAX_ITERATIONS,
  bytesToBase64Url,
  generateCode,
  hashCode,
  hashPassword,
  randomToken,
  signValue,
  timingSafeEqual,
  verifyPassword,
  verifySignedValue,
} from '../worker/lib/crypto';
import { isOtpCode } from '../worker/lib/owner-security';

/**
 * The rules that keep the owner's second factor meaningful.
 *
 * These are the parts that must not drift: the password policy the server
 * enforces, and the primitives the sessions and codes are built from. The
 * challenge lifecycle itself (cooldowns, attempt limits, single use) is verified
 * end to end against the running Worker in scripts/verify.mjs, because it depends
 * on the database.
 */

describe('password policy', () => {
  it('requires a reasonable length', () => {
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(12);
    expect(checkPassword('Short1!')).toBe('too_short');
    expect(checkPassword('a'.repeat(PASSWORD_MIN_LENGTH + 1))).toBe('needs_number');
  });

  it('asks for a letter, a number and a symbol', () => {
    expect(checkPassword('1234567890!!')).toBe('needs_letter');
    expect(checkPassword('abcdefghijkl!')).toBe('needs_number');
    expect(checkPassword('abcdefghijkl1')).toBe('needs_symbol');
  });

  it('accepts a strong passphrase', () => {
    expect(checkPassword('Violet-Lantern-42')).toBeNull();
    expect(checkPassword('quayside!pelican7')).toBeNull();
  });

  it('refuses common passwords, repeats and obvious runs', () => {
    expect(checkPassword('password-Password1!')).toBe('common');
    expect(checkPassword('aaaaaaaaaaaa1!x')).toBe('repeated');
    expect(checkPassword('1234abcdEFGH!')).toBe('repeated');
  });

  it('refuses anything built from the owner context it is given', () => {
    expect(checkPassword('Owner-Address-9!x', ['owner-address'])).toBe('repeated');
    expect(checkPassword('Owner-Address-9!x', ['something-else'])).toBeNull();
  });

  it('caps the length', () => {
    expect(checkPassword(`A1!${'x'.repeat(PASSWORD_MAX_LENGTH)}`)).toBe('too_long');
  });
});

describe('challenge policy values', () => {
  it('is short-lived and limits guesses', () => {
    expect(CHALLENGE_TTL_MINUTES).toBeLessThanOrEqual(15);
    expect(CHALLENGE_MAX_ATTEMPTS).toBeLessThanOrEqual(5);
  });

  it('labels every security event the server records', () => {
    for (const kind of [
      'session.created',
      'session.revoked',
      'challenge.sent',
      'challenge.failed',
      'challenge.expired',
      'password.changed',
      'auth-email.changed',
    ]) {
      expect(SECURITY_EVENT_LABELS[kind], kind).toBeTruthy();
    }
  });
});

describe('password hashing', () => {
  it('round-trips and rejects the wrong password', async () => {
    const stored = await hashPassword('Violet-Lantern-42', 1000);
    expect(stored.hash).not.toContain('Violet');
    expect(stored.salt).toBeTruthy();
    await expect(verifyPassword('Violet-Lantern-42', stored)).resolves.toBe(true);
    await expect(verifyPassword('Violet-Lantern-43', stored)).resolves.toBe(false);
  });

  it('uses a fresh salt every time, so equal passwords hash differently', async () => {
    const first = await hashPassword('Violet-Lantern-42', 1000);
    const second = await hashPassword('Violet-Lantern-42', 1000);
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it('fails closed when the stored record is incomplete', async () => {
    await expect(verifyPassword('anything', { hash: '', salt: '', iterations: 1000 })).resolves.toBe(false);
  });

  it('uses a work factor that is expensive to brute force', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(100_000);
  });

  /* The Workers runtime refuses PBKDF2 above 100 000 iterations, and that
     refusal used to escape as an unhandled 500 from owner setup. Nothing this
     code writes may ask for more than the runtime will do. */
  it('never asks for more PBKDF2 work than the Workers runtime supports', async () => {
    expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(PBKDF2_MAX_ITERATIONS);
    const stored = await hashPassword('Violet-Lantern-42', 210_000);
    expect(stored.iterations).toBe(PBKDF2_MAX_ITERATIONS);
    await expect(verifyPassword('Violet-Lantern-42', stored)).resolves.toBe(true);
  });

  it('honours the stored work factor and never throws when it is unusable', async () => {
    const stored = await hashPassword('Violet-Lantern-42', 1000);
    // A record whose stored factor is not the one it was derived with cannot match.
    await expect(verifyPassword('Violet-Lantern-42', { ...stored, iterations: 2000 })).resolves.toBe(false);
    // Above the runtime ceiling this must be a failed check, not a rejection.
    await expect(verifyPassword('Violet-Lantern-42', { ...stored, iterations: 210_000 })).resolves.toBe(false);
  });
});

describe('verification codes', () => {
  it('accepts only six decimal digits after the existing whitespace normalisation', () => {
    expect(isOtpCode('123456')).toBe(true);
    expect(isOtpCode(' 123456 ')).toBe(true);
    for (const value of ['', '12345', '1234567', '12345a', '12 4567', 123456, null]) {
      expect(isOtpCode(value), String(value)).toBe(false);
    }
  });

  it('is six digits and never a short string', () => {
    for (let index = 0; index < 200; index += 1) {
      const code = generateCode(6);
      expect(code).toMatch(/^[0-9]{6}$/);
    }
  });

  it('is not predictable across calls', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateCode(6)));
    expect(codes.size).toBeGreaterThan(150);
  });

  it('hashes against the challenge id, so a stolen hash is not reusable elsewhere', async () => {
    const first = await hashCode('challenge-a', '123456');
    expect(first).toBe(await hashCode('challenge-a', '123456'));
    expect(first).not.toBe(await hashCode('challenge-b', '123456'));
    expect(first).not.toContain('123456');
  });

  it('tolerates surrounding whitespace in what the owner types', async () => {
    expect(await hashCode('challenge-a', ' 123456 ')).toBe(await hashCode('challenge-a', '123456'));
  });
});

describe('signed session cookies', () => {
  it('round-trips a signed value', async () => {
    const secret = randomToken(32);
    const cookie = await signValue(secret, { id: 'session-id', issuedAt: 1_700_000_000_000 });
    const parsed = await verifySignedValue(secret, cookie);
    expect(parsed).toEqual({ id: 'session-id', issuedAt: 1_700_000_000_000 });
  });

  it('rejects a tampered id, a tampered timestamp and a foreign secret', async () => {
    const secret = randomToken(32);
    const cookie = await signValue(secret, { id: 'session-id', issuedAt: 1 });
    const [, id, issuedAt, signature] = cookie.split('.');

    await expect(verifySignedValue(secret, `v1.other-id.${issuedAt}.${signature}`)).resolves.toBeNull();
    await expect(verifySignedValue(secret, `v1.${id}.999.${signature}`)).resolves.toBeNull();
    await expect(verifySignedValue(randomToken(32), cookie)).resolves.toBeNull();
    await expect(verifySignedValue(secret, null)).resolves.toBeNull();
    await expect(verifySignedValue(secret, 'garbage')).resolves.toBeNull();
  });

  it('compares in constant time regardless of length', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcdef')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('generates URL-safe tokens of the requested size', () => {
    const token = randomToken(16);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(bytesToBase64Url(new Uint8Array([251, 255, 190]))).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(randomToken(16)).not.toBe(randomToken(16));
  });
});
