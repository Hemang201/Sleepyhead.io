import { useEffect, useState } from 'react';

import { api, ApiError } from '../../lib/api';
import {
  PASSWORD_PROBLEM_MESSAGES,
  PASSWORD_RULE_HINT,
  checkPassword,
  type ChallengeResponse,
} from '../../shared/owner-security';
import { IconLock, IconMail, IconShield, IconSparkle } from '../Icons';

/**
 * The owner's door: password first, then the code emailed to the private
 * authentication address.
 *
 * Two modes:
 *   setup    first run — the operator provisions the single owner with the
 *            setup token that is configured on the server, and confirms the
 *            private OTP address with a real code round-trip.
 *   signin   everything after that — administrator address and password, then
 *            the six-digit code. Both factors are required.
 *
 * The server does all of the deciding. This component only collects input, shows
 * exactly what the server said, and never holds a verification code in anything
 * other than component state — never localStorage, never a log. A code is
 * displayed only when the server explicitly hands one back, which happens on a
 * loopback origin with the local development catcher and nowhere else.
 */

type Step = 'form' | 'code';

interface GateState {
  challenge: ChallengeResponse | null;
  code: string;
  error: string | null;
  fieldErrors: Record<string, string>;
  busy: boolean;
  cooldown: number;
}

const EMPTY: GateState = {
  challenge: null,
  code: '',
  error: null,
  fieldErrors: {},
  busy: false,
  cooldown: 0,
};

export function OwnerGate({
  mode,
  onDone,
  blocker,
  setupEnabled,
}: {
  mode: 'setup' | 'signin';
  onDone: () => void;
  blocker?: string | null;
  setupEnabled: boolean;
}) {
  const [step, setStep] = useState<Step>('form');
  const [state, setState] = useState<GateState>(EMPTY);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [reveal, setReveal] = useState(false);

  // Resend cooldown, counted down from whatever the server reported.
  useEffect(() => {
    if (state.cooldown <= 0) return undefined;
    const timer = window.setInterval(
      () => setState((current) => ({ ...current, cooldown: Math.max(0, current.cooldown - 1) })),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [state.cooldown]);

  if (blocker) {
    return (
      <div className="admin-gate">
        <span className="page-state__icon" aria-hidden="true">
          <IconShield size={24} />
        </span>
        <h1 className="section__title" style={{ fontSize: 'var(--step-2)' }}>
          Sign-in cannot be completed yet
        </h1>
        <p className="section__lead">{blocker}</p>
        <div className="callout callout--warn" style={{ textAlign: 'left' }}>
          <span className="callout__title">What an operator has to do</span>
          <span>
            Verification codes are the second factor, so the dashboard stays locked without a way to send them. Set{' '}
            <code>EMAIL_PROVIDER</code> and <code>RESEND_API_KEY</code> (with a verified <code>EMAIL_FROM</code>) in the
            Worker environment, plus <code>OWNER_LOGIN_EMAIL</code> and the private OTP address, then deploy. Nothing is
            bypassed for convenience.
          </span>
        </div>
      </div>
    );
  }

  const applyError = (caught: unknown) => {
    if (caught instanceof ApiError) {
      setState((current) => ({ ...current, busy: false, error: caught.message, fieldErrors: caught.fields ?? {} }));
      return;
    }
    setState((current) => ({ ...current, busy: false, error: 'Something went wrong. Try again.', fieldErrors: {} }));
  };

  const requestCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setState((current) => ({ ...current, busy: true, error: null, fieldErrors: {} }));

    try {
      const challenge =
        mode === 'setup'
          ? await api.admin.setup({ email: email.trim(), password, confirm, setupToken: setupToken.trim() })
          : await api.admin.login({ email: email.trim(), password });

      setState({
        challenge,
        code: '',
        error: null,
        fieldErrors: {},
        busy: false,
        cooldown: challenge.resendAfterSeconds,
      });
      setStep('code');
    } catch (caught) {
      applyError(caught);
    }
  };

  const resend = async () => {
    setState((current) => ({ ...current, busy: true, error: null, fieldErrors: {} }));
    try {
      const challenge =
        mode === 'setup'
          ? await api.admin.setup({ email: email.trim(), password, confirm, setupToken: setupToken.trim() })
          : await api.admin.login({ email: email.trim(), password });
      setState({
        challenge,
        code: '',
        error: null,
        fieldErrors: {},
        busy: false,
        cooldown: challenge.resendAfterSeconds,
      });
    } catch (caught) {
      applyError(caught);
    }
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!state.challenge) return;
    setState((current) => ({ ...current, busy: true, error: null, fieldErrors: {} }));

    try {
      await api.admin.verify({ challengeId: state.challenge.challengeId, code: state.code.trim() });
      setPassword('');
      setConfirm('');
      setSetupToken('');
      onDone();
    } catch (caught) {
      if (caught instanceof ApiError && (caught.code === 'challenge_spent' || caught.code === 'challenge_expired')) {
        // The challenge is dead: send the owner back to step one rather than
        // leaving them typing into a form that cannot succeed.
        setStep('form');
        setState((current) => ({ ...current, busy: false, challenge: null, code: '', error: caught.message }));
        return;
      }
      applyError(caught);
    }
  };

  const minutesLeft = state.challenge
    ? Math.max(1, Math.round((Date.parse(state.challenge.expiresAt) - Date.now()) / 60000))
    : null;

  return (
    <div className="admin-gate deco-host admin-gate--auth">
      <span className="page-state__icon" aria-hidden="true">
        {mode === 'setup' ? <IconSparkle size={24} /> : <IconLock size={24} />}
      </span>

      <p className="admin-gate__step">
        <span>Step {step === 'form' ? '1' : '2'} of 2</span>
        <span aria-hidden="true">·</span>
        <span>{step === 'form' ? 'Password' : 'Email verification'}</span>
      </p>

      <h1 className="section__title" style={{ fontSize: 'var(--step-2)' }}>
        {mode === 'setup' ? 'Owner setup' : 'Owner sign-in'}
      </h1>

      {step === 'form' ? (
        <>
          <p className="section__lead">
            {mode === 'setup'
              ? 'This dashboard has no owner yet. Provision it once with the setup token from the deployment, and choose the password you will sign in with. A code still has to come back from the private address before anything is unlocked.'
              : 'Sign in to manage your games and website content. A six-digit code is then sent to the private authentication address configured on the server — the password alone is never enough.'}
          </p>

          <form className="stack stack--md admin-gate__form" onSubmit={requestCode} noValidate>
            <label className="field">
              <span className="field__label">Administrator address</span>
              <input
                className="input"
                type="email"
                name="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-describedby="admin-email-hint"
              />
              {state.fieldErrors.email ? <span className="field__error">{state.fieldErrors.email}</span> : null}
            </label>
            <p className="field__hint" id="admin-email-hint">
              Your private login identity. It is checked on the server and never shown anywhere on the public site.
            </p>

            <label className="field">
              <span className="field__label">Password</span>
              <span className="admin-gate__password">
                <input
                  className="input"
                  type={reveal ? 'text' : 'password'}
                  name="password"
                  autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-describedby="password-hint"
                />
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setReveal((current) => !current)}
                  aria-pressed={reveal}
                >
                  {reveal ? 'Hide' : 'Show'}
                </button>
              </span>
              {state.fieldErrors.password ? (
                <span className="field__error">
                  {PASSWORD_PROBLEM_MESSAGES[state.fieldErrors.password as keyof typeof PASSWORD_PROBLEM_MESSAGES] ??
                    state.fieldErrors.password}
                </span>
              ) : null}
            </label>

            {mode === 'setup' ? (
              <>
                <p className="field__hint" id="password-hint">
                  {PASSWORD_RULE_HINT} Stored only as a PBKDF2 hash; never emailed, logged or displayed back.
                </p>
                <label className="field">
                  <span className="field__label">Repeat the password</span>
                  <input
                    className="input"
                    type={reveal ? 'text' : 'password'}
                    name="confirm"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                  {state.fieldErrors.confirm ? <span className="field__error">{state.fieldErrors.confirm}</span> : null}
                  {confirm && password !== confirm ? <span className="field__error">Passwords do not match.</span> : null}
                </label>

                <label className="field">
                  <span className="field__label">
                    <IconShield size={14} /> Setup token
                  </span>
                  <input
                    className="input"
                    type="password"
                    name="setupToken"
                    autoComplete="off"
                    required
                    value={setupToken}
                    onChange={(event) => setSetupToken(event.target.value)}
                    aria-describedby="setup-hint"
                  />
                  {state.fieldErrors.setupToken ? <span className="field__error">{state.fieldErrors.setupToken}</span> : null}
                </label>
                <p className="field__hint" id="setup-hint">
                  The private value an operator set as <code>OWNER_SETUP_TOKEN</code>. It authorises this one-time
                  provisioning and is refused as soon as a password exists. Nobody can register themselves here.
                </p>
              </>
            ) : null}

            {!setupEnabled && mode === 'setup' ? (
              <div className="callout callout--warn" role="alert">
                <span className="callout__title">Provisioning is switched off</span>
                <span>
                  This deployment has no <code>OWNER_SETUP_TOKEN</code>, so setup cannot run. Sign-in remains available if
                  an owner already exists.
                </span>
              </div>
            ) : null}

            {state.error ? (
              <div className="callout callout--warn" role="alert">
                <span className="callout__title">That did not work</span>
                <span>{state.error}</span>
              </div>
            ) : null}

            <button className="btn btn--primary btn--lg" type="submit" disabled={state.busy}>
              {state.busy ? (
                <>
                  <span className="spinner spinner--ring spinner--xs" aria-hidden="true" /> Checking…
                </>
              ) : mode === 'setup' ? (
                'Provision and send my first code'
              ) : (
                'Send the verification code'
              )}
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="section__lead">
            A six-digit code was sent to <strong>{state.challenge?.sentTo}</strong>. It expires in {minutesLeft} minute(s)
            and works once.
          </p>

          {state.challenge?.localCode ? (
            <div className="callout callout--info" style={{ textAlign: 'left' }}>
              <span className="callout__title">Local development catcher</span>
              <span>
                No mail leaves a development machine, so the server delivered the code here instead:{' '}
                <strong className="kbd">{state.challenge.localCode}</strong>. This only happens on a loopback origin with
                the local email provider; a deployed site uses the real provider and never returns a code.
              </span>
            </div>
          ) : null}

          <form className="stack stack--md admin-gate__form" onSubmit={verify} noValidate>
            <label className="field">
              <span className="field__label">
                <IconMail size={14} /> Verification code
              </span>
              <input
                className="input input--code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                required
                value={state.code}
                onChange={(event) => setState((current) => ({ ...current, code: event.target.value.replace(/\D/g, '') }))}
                aria-describedby="code-hint"
              />
              {state.fieldErrors.code ? <span className="field__error">{state.fieldErrors.code}</span> : null}
            </label>
            <p className="field__hint" id="code-hint">
              {state.challenge ? `${state.challenge.attemptsLeft} attempt(s) remain for this code. ` : ''}
              Codes are single use and stored only as a hash on the server.
            </p>

            {state.error ? (
              <div className="callout callout--warn" role="alert">
                <span className="callout__title">That code did not work</span>
                <span>{state.error}</span>
              </div>
            ) : null}

            <div className="cluster">
              <button className="btn btn--primary" type="submit" disabled={state.busy || state.code.length < 6}>
                {state.busy ? (
                  <>
                    <span className="spinner spinner--ring spinner--xs" aria-hidden="true" /> Verifying…
                  </>
                ) : (
                  'Verify and continue'
                )}
              </button>
              <button className="btn btn--secondary" type="button" onClick={() => void resend()} disabled={state.cooldown > 0 || state.busy}>
                {state.cooldown > 0 ? `Resend in ${state.cooldown}s` : 'Send a new code'}
              </button>
              <button
                className="btn btn--ghost"
                type="button"
                onClick={() => {
                  setStep('form');
                  setState((current) => ({ ...current, challenge: null, code: '', error: null, fieldErrors: {} }));
                }}
                disabled={state.busy}
              >
                Start over
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

/** Live password feedback for the setup form, using the shared policy. */
export function passwordProblem(password: string, context: string[] = []): string | null {
  return checkPassword(password, context);
}
