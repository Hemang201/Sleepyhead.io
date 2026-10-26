import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, ApiError, type SecurityEventsResponse } from '../../lib/api';
import { useAdmin, useAdminAction } from '../../lib/admin';
import {
  PASSWORD_PROBLEM_MESSAGES,
  PASSWORD_RULE_HINT,
  SECURITY_EVENT_LABELS,
  checkPassword,
  type SecurityState,
} from '../../shared/owner-security';
import { IconAlert, IconCheck, IconLock, IconMail, IconShield } from '../../components/Icons';

/**
 * Account security.
 *
 * The whole point of this page is the separation it makes visible:
 *
 *   - the **private authentication address** is masked, receives every
 *     verification code, and is never rendered in full anywhere a visitor could
 *     reach. It is stored in its own table.
 *   - the **public contact address** is shown as-is, because it is on the
 *     contact page by design, and it lives in the content document.
 *
 * Neither one writes to the other: the public address is edited under Site
 * content, and the server refuses to publish the private one there.
 *
 * Changing the password requires a *fresh* code — an existing session is not
 * enough. The flow below enforces that because the server does: the password
 * endpoint rejects any request that does not carry a freshly verified
 * challenge.
 */
export default function AdminSecurityPage() {
  const { session } = useAdmin();
  const [state, setState] = useState<SecurityState | null>(session?.security ?? null);
  const [events, setEvents] = useState<SecurityEventsResponse | null>(null);
  const [recovery, setRecovery] = useState<{ steps: string[]; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [security, activity] = await Promise.all([api.admin.securityState(), api.admin.securityEvents()]);
      setState(security.security);
      setEvents(activity);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Account security could not load.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadRecovery = async () => {
    setBusy(true);
    try {
      const data = await api.admin.recovery();
      setRecovery(data.recovery);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Recovery guidance could not load.');
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <div className="admin-page">
        {error ? (
          <div className="callout callout--warn">
            <span className="callout__title">Account security could not load</span>
            <span>{error}</span>
          </div>
        ) : (
          <div className="skeleton" style={{ height: 320 }} />
        )}
      </div>
    );
  }

  return (
    <div className="stack stack--lg admin-page">
      <header className="admin-page__head">
        <div>
          <p className="section__eyebrow">Account security</p>
          <h1 className="section__title">Your sign-in details</h1>
          <p className="section__lead">
            Three addresses with three different jobs. You sign in with the login identity, verification codes go to the
            private authentication address, and the public contact address is the one visitors see. Changing one never
            changes another.
          </p>
        </div>
      </header>

      <div className="split split--about">
        <section className="panel stack stack--md" aria-labelledby="private-email-heading">
          <h2 className="section__title" id="private-email-heading" style={{ fontSize: 'var(--step-2)' }}>
            <IconLock size={16} /> Private authentication address
          </h2>

          <p className="stat__value" style={{ fontSize: 'var(--step-1)' }}>
            {state.authEmail.masked ?? 'not set'}
          </p>
          <p className="field__hint">
            {state.authEmail.verifiedAt
              ? `Verified on ${new Date(state.authEmail.verifiedAt).toLocaleString()}. Every sign-in code, password confirmation and security notice goes here.`
              : 'No verified address yet — set one up to unlock the dashboard.'}
          </p>

          <div className="callout callout--info">
            <span className="callout__title">Never shown publicly</span>
            <span>
              This address is not returned by any public API, is not in the page source, and cannot be saved as the contact
              address: the server refuses it there. It is stored on its own, separate from every piece of site content, and
              only ever receives codes and security notices.
            </span>
          </div>

          {state.authEmail.managed ? (
            <div className="callout callout--warn">
              <span className="callout__title">Pinned by the deployment</span>
              <span>
                <code>OWNER_OTP_EMAIL</code> is set in the Worker environment, so this destination cannot be changed from
                the dashboard. Rotate the environment variable and redeploy instead — that is deliberate, so a stolen
                session cannot redirect your verification codes.
              </span>
            </div>
          ) : (
            <EmailChangeForm onDone={load} />
          )}

        </section>

        <section className="stack stack--lg">
          <div className="panel stack stack--sm" aria-labelledby="login-email-heading">
            <h2 className="section__title" id="login-email-heading" style={{ fontSize: 'var(--step-2)' }}>
              <IconLock size={16} /> Administrator login identity
            </h2>
            <p className="stat__value" style={{ fontSize: 'var(--step-1)' }}>
              {state.loginEmail.masked ?? 'not set'}
            </p>
            <p className="field__hint">
              The address typed into the sign-in form. It is compared on the server and is never used to deliver codes, so
              a leaked login identity alone is not enough to reach the dashboard. Rotating it is a deployment change
              (<code>OWNER_LOGIN_EMAIL</code>).
            </p>
          </div>

          <div className="panel stack stack--sm" aria-labelledby="public-email-heading">
            <h2 className="section__title" id="public-email-heading" style={{ fontSize: 'var(--step-2)' }}>
              <IconMail size={16} /> Public contact address
            </h2>
            <p className="stat__value" style={{ fontSize: 'var(--step-1)' }}>
              {state.publicContactEmail || 'not set'}
            </p>
            <p className="field__hint">
              Shown to visitors, used by every <code>mailto:</code> link. It is never used to sign in, never receives
              verification codes and cannot reset the password.
            </p>
            <Link className="btn btn--secondary btn--sm" to="/admin/content">
              Edit under Site content
            </Link>
          </div>

          <PasswordForm state={state} onDone={load} />

          <div className="panel stack stack--sm" aria-labelledby="sessions-heading">
            <h2 className="section__title" id="sessions-heading" style={{ fontSize: 'var(--step-2)' }}>
              Sessions
            </h2>
            <p style={{ color: 'var(--text-muted)' }}>
              {state.session.activeSessions} verified session{state.session.activeSessions === 1 ? '' : 's'} right now. This
              one expires {state.session.expiresAt ? new Date(state.session.expiresAt).toLocaleString() : 'soon'}.
            </p>
            <Sessions
              data={events}
              onDone={async () => {
                await load();
              }}
            />
          </div>
        </section>
      </div>

      <section className="panel stack stack--md" aria-labelledby="activity-heading">
        <h2 className="section__title" id="activity-heading" style={{ fontSize: 'var(--step-2)' }}>
          Security activity
        </h2>
        {events && events.events.length > 0 ? (
          <ul className="activity-list">
            {events.events.map((event) => (
              <li className="activity" key={event.id}>
                <span className="activity__kind">{SECURITY_EVENT_LABELS[event.kind] ?? event.kind}</span>
                <span className="activity__time">{new Date(event.createdAt).toLocaleString()}</span>
                {event.detail ? <span className="activity__detail">{event.detail}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>Nothing has happened yet. Every sign-in and change will be listed here.</p>
        )}
      </section>

      <section className="panel stack stack--md" aria-labelledby="recovery-heading">
        <h2 className="section__title" id="recovery-heading" style={{ fontSize: 'var(--step-2)' }}>
          <IconShield size={16} /> If you lose access
        </h2>
        <p style={{ color: 'var(--text-muted)' }}>
          There is no public password reset, and no form on this site can hand out administrator access. Recovery is a
          deliberate, server-side operation.
        </p>
        {recovery ? (
          <>
            <ol className="instruction-list">
              {recovery.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="field__hint">{recovery.note}</p>
          </>
        ) : (
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void loadRecovery()} disabled={busy}>
            Show me the recovery steps
          </button>
        )}
      </section>

      {state.provider.localCatch ? (
        <div className="callout callout--warn">
          <span className="callout__title">Local development email catcher is active</span>
          <span>
            Verification codes are being handed back to the browser instead of emailed, because this Worker is running on a
            loopback origin with the local email provider. A deployed site uses the real provider and never returns a code.
          </span>
        </div>
      ) : state.provider.status === 'unconfigured' ? (
        <div className="callout callout--warn">
          <span className="callout__title">Email delivery is not configured</span>
          <span>
            Set <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code> in the Worker environment and deploy. Until then no
            verification code can be delivered, and the dashboard stays locked rather than pretending otherwise.
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------ password change */

function PasswordForm({ state, onDone }: { state: SecurityState; onDone: () => void }) {
  const [step, setStep] = useState<'intro' | 'code' | 'password'>('intro');
  const [current, setCurrent] = useState('');
  const [code, setCode] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [localCode, setLocalCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const policyProblem = next ? checkPassword(next) : null;

  const requestCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const challenge = await api.admin.challenge({ purpose: 'password-change', password: current });
      setChallengeId(challenge.challengeId);
      setSentTo(challenge.sentTo);
      setLocalCode(challenge.localCode ?? null);
      setStep('code');
    } catch (caught) {
      setMessage(caught instanceof ApiError ? caught.message : 'The code could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!challengeId) return;
    setBusy(true);
    setFieldError(null);
    try {
      await api.admin.verify({ challengeId, code: code.trim() });
      setStep('password');
      setMessage(null);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFieldError(caught.fields?.code ?? caught.message);
        if (caught.code === 'challenge_expired' || caught.code === 'challenge_spent' || caught.code === 'attempts_exhausted') {
          setStep('intro');
          setChallengeId(null);
        }
      } else {
        setMessage('That code could not be checked.');
      }
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFieldError(null);
    setMessage(null);
    try {
      const result = await api.admin.changePassword({ currentPassword: current, newPassword: next, confirm });
      setMessage(
        result.revokedSessions > 0
          ? `Password changed. ${result.revokedSessions} other session(s) were signed out.`
          : 'Password changed.',
      );
      setCurrent('');
      setNext('');
      setConfirm('');
      setCode('');
      setChallengeId(null);
      setStep('intro');
      onDone();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const field = caught.fields?.password ?? caught.fields?.newPassword ?? caught.fields?.confirm;
        setFieldError(field ?? caught.message);
        if (caught.code === 'fresh_verification_required' || caught.code === 'session_required') setStep('intro');
      } else {
        setMessage('The password could not be changed.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel stack stack--md" aria-labelledby="password-heading">
      <h2 className="section__title" id="password-heading" style={{ fontSize: 'var(--step-2)' }}>
        Owner password
      </h2>
      <p className="field__hint">
        {state.passphrase.set && state.passphrase.updatedAt
          ? `Last changed ${new Date(state.passphrase.updatedAt).toLocaleString()}.`
          : 'No password set yet.'}{' '}
        Changing it always needs a fresh code sent to {state.authEmail.masked ?? 'your authentication address'} — being
        signed in is not enough.
      </p>

      {step === 'intro' ? (
        <form className="stack stack--sm" onSubmit={requestCode} noValidate>
          <label className="field">
            <span className="field__label">Current password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </label>
          <p className="field__hint">{PASSWORD_RULE_HINT}</p>
          <button className="btn btn--secondary btn--sm" type="submit" disabled={busy || current.length === 0}>
            {busy ? 'Sending…' : 'Send a confirmation code'}
          </button>
        </form>
      ) : null}

      {step === 'code' ? (
        <form className="stack stack--sm" onSubmit={verifyCode} noValidate>
          <p style={{ color: 'var(--text-muted)' }}>A code was sent to {sentTo}. Enter it to continue.</p>
          {localCode ? (
            <div className="callout callout--info">
              <span className="callout__title">Local development catcher</span>
              <span>
                Code: <strong className="kbd">{localCode}</strong>
              </span>
            </div>
          ) : null}
          <label className="field">
            <span className="field__label">Verification code</span>
            <input
              className="input input--code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            />
            {fieldError ? <span className="field__error">{fieldError}</span> : null}
          </label>
          <button className="btn btn--secondary btn--sm" type="submit" disabled={busy || code.length < 6}>
            {busy ? 'Checking…' : 'Confirm it is me'}
          </button>
        </form>
      ) : null}

      {step === 'password' ? (
        <form className="stack stack--sm" onSubmit={changePassword} noValidate>
          <div className="callout callout--success">
            <span className="callout__title">
              <IconCheck size={14} /> Verified
            </span>
            <span>You can set a new password now. This authorisation is single use and expires in ten minutes.</span>
          </div>
          <label className="field">
            <span className="field__label">New password</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              required
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
            {policyProblem ? (
              <span className="field__error">{PASSWORD_PROBLEM_MESSAGES[policyProblem]}</span>
            ) : (
              <span className="field__hint">{PASSWORD_RULE_HINT}</span>
            )}
          </label>
          <label className="field">
            <span className="field__label">Repeat the new password</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
            {confirm && next !== confirm ? <span className="field__error">Passwords do not match.</span> : null}
          </label>
          {fieldError ? <span className="field__error">{fieldError}</span> : null}
          <button
            className="btn btn--primary btn--sm"
            type="submit"
            disabled={busy || Boolean(policyProblem) || next !== confirm || next.length === 0}
          >
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </form>
      ) : null}

      {message ? (
        <div className={message.toLowerCase().includes('changed') ? 'callout callout--success' : 'callout callout--warn'} role="status">
          <span>{message}</span>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------- authentication address */

function EmailChangeForm({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [localCode, setLocalCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setFieldError(null);
    try {
      const challenge = await api.admin.changeEmail({ newEmail: newEmail.trim(), password });
      setChallengeId(challenge.challengeId);
      setSentTo(challenge.sentTo);
      setLocalCode(challenge.localCode ?? null);
      setStep('code');
    } catch (caught) {
      if (caught instanceof ApiError) setFieldError(caught.fields?.newEmail ?? caught.message);
      else setMessage('The confirmation could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!challengeId) return;
    setBusy(true);
    setFieldError(null);
    try {
      await api.admin.verify({ challengeId, code: code.trim() });
      setMessage(`${sentTo} is now your authentication address. Your public contact address was not touched.`);
      setStep('form');
      setOpen(false);
      setNewEmail('');
      setPassword('');
      setCode('');
      setChallengeId(null);
      onDone();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFieldError(caught.fields?.code ?? caught.message);
        if (caught.code === 'challenge_expired' || caught.code === 'challenge_spent' || caught.code === 'attempts_exhausted') {
          setStep('form');
          setChallengeId(null);
        }
      } else {
        setMessage('That code could not be checked.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="stack stack--sm">
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => setOpen(true)}>
          Change authentication address
        </button>
        {message ? (
          <div className="callout callout--success" role="status">
            <span>{message}</span>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <form className="stack stack--sm" onSubmit={step === 'form' ? start : verify} noValidate>
      {step === 'form' ? (
        <>
          <p className="field__hint">
            The new address is confirmed with a code before it takes over, and everything else stays as it is.
          </p>
          <label className="field">
            <span className="field__label">New authentication address</span>
            <input
              className="input"
              type="email"
              autoComplete="off"
              required
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Confirm with your password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <p style={{ color: 'var(--text-muted)' }}>A code was sent to {sentTo}. Enter it to finish the change.</p>
          {localCode ? (
            <div className="callout callout--info">
              <span className="callout__title">Local development catcher</span>
              <span>
                Code: <strong className="kbd">{localCode}</strong>
              </span>
            </div>
          ) : null}
          <label className="field">
            <span className="field__label">Verification code</span>
            <input
              className="input input--code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            />
          </label>
        </>
      )}

      {fieldError ? <span className="field__error">{fieldError}</span> : null}

      <div className="cluster">
        <button
          className="btn btn--secondary btn--sm"
          type="submit"
          disabled={busy || (step === 'form' ? !newEmail || !password : code.length < 6)}
        >
          {busy ? 'Working…' : step === 'form' ? 'Send confirmation code' : 'Confirm new address'}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            setOpen(false);
            setStep('form');
            setChallengeId(null);
            setCode('');
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/* --------------------------------------------------------------- sessions */

function Sessions({ data, onDone }: { data: SecurityEventsResponse | null; onDone: () => Promise<void> }) {
  const { run } = useAdminAction();
  const [confirmAll, setConfirmAll] = useState(false);

  const revoke = (target: 'all' | 'others') =>
    run(
      async () => {
        const result = await api.admin.revokeSessions(target);
        await onDone();
        return result;
      },
      { ok: target === 'all' ? 'Signed out everywhere' : 'Other sessions signed out' },
    );

  return (
    <div className="stack stack--sm">
      {data && data.sessions.length > 0 ? (
        <ul className="session-list">
          {data.sessions.map((entry) => (
            <li className="session" key={entry.id}>
              <span className="session__agent">{entry.userAgent ? entry.userAgent.slice(0, 70) : 'Unknown device'}</span>
              <span className="session__time">
                verified {new Date(entry.verifiedAt).toLocaleString()}
                {entry.id === data.currentSessionId ? ' · this device' : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="cluster">
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => void revoke('others')}>
          Sign out other devices
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmAll(true)}>
          Sign out everywhere
        </button>
      </div>

      {confirmAll ? (
        <div className="callout callout--warn">
          <span className="callout__title">
            <IconAlert size={14} /> Sign out everywhere?
          </span>
          <span>This device included — you will need a new verification code to get back in.</span>
          <div className="cluster" style={{ marginTop: 'var(--space-3)' }}>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => {
                void revoke('all');
                setConfirmAll(false);
              }}
            >
              Yes, sign out everywhere
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmAll(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
