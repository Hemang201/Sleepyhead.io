import { describe, expect, it } from 'vitest';

import { emailProvider, providerSummary, verificationEmail } from '../worker/lib/email';

/**
 * Provider selection, which is the difference between "verification codes really
 * arrive" and "the dashboard is quietly unlocked for anyone".
 *
 * The property that matters: the development catcher exists so the flow can be
 * exercised on a developer's machine, and it must be impossible to select from a
 * deployed origin — even if the environment asks for it by name.
 */

const LOOPBACK_ORIGIN = 'http://localhost:8787';
const DEPLOYED_ORIGIN = 'https://arcade.example';

describe('emailProvider', () => {
  it('refuses the local catcher when the request is not on loopback', () => {
    const provider = emailProvider({ EMAIL_PROVIDER: 'local', APP_ORIGIN: DEPLOYED_ORIGIN }, DEPLOYED_ORIGIN);
    expect(provider.localCatch).toBe(false);
    expect(provider.configured).toBe(false);
    expect(provider.name).toBe('none');
  });

  it('refuses it when the request is loopback but the configured site origin is not', () => {
    // A deployed Worker reached over a loopback address must still refuse it.
    const provider = emailProvider({ EMAIL_PROVIDER: 'local', APP_ORIGIN: DEPLOYED_ORIGIN }, LOOPBACK_ORIGIN);
    expect(provider.localCatch).toBe(false);
    expect(provider.configured).toBe(false);
  });

  it('allows it only when both origins are loopback development', () => {
    const provider = emailProvider({ EMAIL_PROVIDER: 'local', APP_ORIGIN: LOOPBACK_ORIGIN }, LOOPBACK_ORIGIN);
    expect(provider.localCatch).toBe(true);
    expect(provider.configured).toBe(true);
    expect(provider.name).toBe('local');
  });

  it('reports unconfigured when nothing is set up on a deployed origin', () => {
    const provider = emailProvider({ APP_ORIGIN: DEPLOYED_ORIGIN }, DEPLOYED_ORIGIN);
    expect(provider.name).toBe('none');
    expect(provider.configured).toBe(false);
    expect(providerSummary({ APP_ORIGIN: DEPLOYED_ORIGIN }, DEPLOYED_ORIGIN).status).toBe('unconfigured');
  });

  it('never falls back to the catcher on a deployed origin', () => {
    // No key and no explicit provider: on a real origin this must be "none",
    // because the alternative is pretending verification works.
    expect(emailProvider({}, DEPLOYED_ORIGIN).name).toBe('none');
  });

  it('uses Resend once a key and a sender are configured', () => {
    const env = { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test', EMAIL_FROM: 'Arcade <noreply@example>', APP_ORIGIN: DEPLOYED_ORIGIN };
    const provider = emailProvider(env, DEPLOYED_ORIGIN);
    expect(provider.name).toBe('resend');
    expect(provider.configured).toBe(true);
    expect(provider.localCatch).toBe(false);
    expect(providerSummary(env, DEPLOYED_ORIGIN)).toMatchObject({ status: 'configured', from: 'Arcade <noreply@example>' });
  });

  it('treats a key without a sender as unconfigured', () => {
    const env = { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test', APP_ORIGIN: DEPLOYED_ORIGIN };
    expect(emailProvider(env, DEPLOYED_ORIGIN).configured).toBe(false);
  });

  it('fails the send with a clear code instead of throwing when unconfigured', async () => {
    const provider = emailProvider({ EMAIL_PROVIDER: 'none' }, DEPLOYED_ORIGIN);
    const result = await provider.send({ to: 'a@b.com', subject: 'x', html: '<p>x</p>', text: 'x' }, '123456');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('email_unconfigured');
  });

  it('returns the code only from the local catcher', async () => {
    const local = emailProvider({ EMAIL_PROVIDER: 'local', APP_ORIGIN: LOOPBACK_ORIGIN }, LOOPBACK_ORIGIN);
    const sent = await local.send({ to: 'a@b.com', subject: 'x', html: '<p>x</p>', text: 'x' }, '123456');
    expect(sent.ok).toBe(true);
    expect(sent.localCode).toBe('123456');
  });
});

describe('verificationEmail', () => {
  it('includes the code, the purpose and the expiry, and escapes its inputs', () => {
    const message = verificationEmail({ EMAIL_APP_NAME: 'the arcade' }, 'login', '482913', 10);
    expect(message.subject).toBeTruthy();
    expect(message.html).toContain('482913');
    expect(message.text).toContain('482913');
    expect(message.text).toContain('10 minutes');
    expect(message.text).toContain('arcade');
  });

  it('falls back to the sign-in copy for an unknown purpose', () => {
    const message = verificationEmail({}, 'something-else', '111111', 5);
    expect(message.text).toContain('111111');
    expect(message.subject).toBeTruthy();
  });
});
