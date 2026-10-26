/**
 * Server-side security audit.
 *
 * This is not a look at the sign-in screen: it drives the real Worker over HTTP
 * and checks what the *server* decides. Every protected endpoint is called
 * without a session, with a forged cookie, and with frontend-style "I am the
 * owner" hints, and each must be refused before any private data is read or any
 * row is written. Then the whole password + emailed-code lifecycle is exercised:
 * wrong password, wrong code, exhausted attempts, expired code, superseded code,
 * replay, the hourly ceiling, session expiry, sign-out, and the session
 * revocation that follows a password change.
 *
 * Two things are needed to control time and rows that no API exposes: the local
 * D1 database (through `wrangler d1 execute --local`) and the loopback-only reset
 * seam the verification harness already uses. Both are development-only; neither
 * exists on a deployment, which is exactly why the checks that need them run
 * here rather than in production.
 *
 *   npm run dev:full        # terminal 1
 *   npm run audit:security
 *
 * Read-only against the real owner: the password is rotated and restored, and
 * the audit address is never moved.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const ORIGIN = BASE;

let failures = 0;
let checks = 0;
function check(label, ok, detail = '') {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
}

function readDevVars() {
  const vars = {};
  if (!existsSync('.dev.vars')) return vars;
  for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (match) vars[match[1]] = match[2].trim();
  }
  return vars;
}

const devVars = readDevVars();
const OWNER_EMAIL =
  process.env.OWNER_LOGIN_EMAIL ?? devVars.OWNER_LOGIN_EMAIL ?? devVars.OWNER_AUTH_EMAIL ?? '';
const OTP_EMAIL = process.env.OWNER_OTP_EMAIL ?? devVars.OWNER_OTP_EMAIL ?? '';
const PASSWORD = process.env.DEV_OWNER_PASSWORD ?? devVars.DEV_OWNER_PASSWORD ?? '';
const SETUP_TOKEN = process.env.OWNER_SETUP_TOKEN ?? devVars.OWNER_SETUP_TOKEN ?? '';
const DEV_OWNER = process.env.DEV_OWNER_SUB ?? devVars.DEV_OWNER_SUB ?? 'dev-owner';
const ROTATED = 'Rotated-Owner-77!x';

if (!OWNER_EMAIL || !PASSWORD) {
  console.error('OWNER_LOGIN_EMAIL and DEV_OWNER_PASSWORD must be set in .dev.vars.');
  process.exit(1);
}
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(BASE)) {
  console.error(`Refusing to run against ${BASE}: this audit needs a local Worker.`);
  process.exit(1);
}

/* --------------------------------------------------------------- local D1 */

/** Runs SQL against the local emulated database and returns the rows. */
const WRANGLER = 'node_modules/wrangler/bin/wrangler.js';

function d1(sql) {
  // The installed CLI is run directly through node, so the SQL is one argv entry
  // instead of something a shell could split or interpret.
  const output = execFileSync(
    process.execPath,
    [WRANGLER, 'd1', 'execute', 'DB', '--local', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const start = output.indexOf('[');
  const parsed = JSON.parse(output.slice(start));
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!first?.success) throw new Error(`D1 refused: ${sql}`);
  return first.results ?? [];
}

/* ------------------------------------------------------------------ HTTP */

/** A cookie jar, so a session behaves exactly as a browser's would. */
function jar() {
  let cookie = '';
  return {
    get value() {
      return cookie;
    },
    absorb(response) {
      const raw =
        typeof response.headers.getSetCookie === 'function'
          ? response.headers.getSetCookie()
          : [response.headers.get('set-cookie')].filter(Boolean);
      for (const entry of raw) {
        const pair = entry.split(';')[0];
        if (pair.startsWith('hg_owner_session=')) {
          // A cleared cookie is empty: treat that as "no session".
          cookie = pair.endsWith('=') ? '' : pair;
        }
      }
    },
  };
}

async function call(path, { method = 'GET', body, cookie, headers = {}, redirect = 'manual' } = {}) {
  const init = {
    method,
    redirect,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  };
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, body: json, text, headers: response.headers, setCookie: response.headers.get('set-cookie') };
}

const RESET_BODY = JSON.stringify({ sessions: false, events: false });

/** Clears the sticky rate-limit state this audit trips on purpose. */
async function clearRateLimits() {
  const response = await call('/api/admin/dev/security-reset', {
    method: 'POST',
    body: RESET_BODY,
    headers: { 'x-dev-owner': DEV_OWNER },
  });
  if (response.status !== 200) throw new Error(`the local reset seam refused (status ${response.status})`);
}

/**
 * Also clears the failed-attempt window. The lockout is deliberately sticky
 * (fifteen minutes), so the checks that come *after* it — and any sign-in the
 * audit needs to perform — would otherwise be locked out by design.
 */
async function clearAttemptWindow() {
  const response = await call('/api/admin/dev/security-reset', {
    method: 'POST',
    body: JSON.stringify({ sessions: false, events: true }),
    headers: { 'x-dev-owner': DEV_OWNER },
  });
  if (response.status !== 200) throw new Error(`the local reset seam refused (status ${response.status})`);
}

/** Signs in the way a browser does: password, then the emailed code. */
async function signIn() {
  await clearRateLimits();
  const started = await call('/api/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: PASSWORD } });
  if (started.status !== 200) throw new Error(`login failed (${started.status}): ${started.text.slice(0, 200)}`);
  const code = started.body.localCode;
  if (!code) throw new Error('no code came back: set EMAIL_PROVIDER=local in .dev.vars for a local run.');

  const cookies = jar();
  const verified = await call('/api/admin/auth/verify', {
    method: 'POST',
    body: { challengeId: started.body.challengeId, code },
  });
  cookies.absorb(verified);
  if (!cookies.value) throw new Error('verification did not establish a session');
  return { cookies, started, verified };
}

/* ------------------------------------------------- the protected surface */

const PROTECTED = [
  { method: 'GET', path: '/api/admin/overview', label: 'overview' },
  { method: 'GET', path: '/api/admin/games', label: 'game list' },
  { method: 'POST', path: '/api/admin/games', body: { title: 'Unauthorised Game' }, label: 'create a game' },
  { method: 'GET', path: '/api/admin/games/00000000-0000-0000-0000-000000000000', label: 'read one game' },
  {
    method: 'PATCH',
    path: '/api/admin/games/00000000-0000-0000-0000-000000000000',
    body: { title: 'Hijacked' },
    label: 'edit a game',
  },
  {
    method: 'DELETE',
    path: '/api/admin/games/00000000-0000-0000-0000-000000000000?mode=purge',
    label: 'delete a game',
  },
  { method: 'GET', path: '/api/admin/content', label: 'read the content drafts' },
  { method: 'PUT', path: '/api/admin/content/about', body: { heading: 'hijacked' }, label: 'edit About' },
  { method: 'POST', path: '/api/admin/content/about/publish', label: 'publish About' },
  { method: 'PUT', path: '/api/admin/content/social', body: { links: [] }, label: 'edit social links' },
  { method: 'PUT', path: '/api/admin/settings/appearance', body: {}, label: 'change site settings' },
  { method: 'POST', path: '/api/admin/games/x/builds', body: {}, label: 'start a build upload' },
  { method: 'PUT', path: '/api/admin/builds/x/files?path=index.html', body: 'x', label: 'upload a build file' },
  { method: 'POST', path: '/api/admin/builds/x/activate', label: 'activate a build' },
  { method: 'POST', path: '/api/admin/games/x/artwork?kind=thumbnail', body: 'x', label: 'upload artwork' },
  { method: 'PUT', path: '/api/admin/content/about/avatar', body: 'x', label: 'upload a portrait' },
  { method: 'GET', path: '/api/admin/security/state', label: 'read security state' },
  { method: 'GET', path: '/api/admin/security/events', label: 'read the audit trail' },
  {
    method: 'POST',
    path: '/api/admin/security/password',
    body: { currentPassword: PASSWORD, newPassword: ROTATED, confirm: ROTATED },
    label: 'change the password',
  },
  { method: 'POST', path: '/api/admin/security/email', body: { newEmail: 'attacker@example.test', password: PASSWORD }, label: 'move the OTP address' },
  { method: 'POST', path: '/api/admin/security/sessions', body: { target: 'all' }, label: 'revoke every session' },
];

async function main() {
  console.log(`Security audit against ${BASE}\n`);

  // Start from a normal state: the previous run (or a manual poke at the admin
  // screen) may have left the failed-attempt window hot.
  await clearAttemptWindow();
  await clearRateLimits();

  /* ------------------------------------------------ 1. the access matrix */

  const gamesBefore = Number((await d1('SELECT COUNT(*) AS total FROM games'))[0].total);
  const buildsBefore = Number((await d1('SELECT COUNT(*) AS total FROM builds'))[0].total);
  const uploadsBefore = Number((await d1('SELECT COUNT(*) AS total FROM upload_events'))[0].total);

  for (const endpoint of PROTECTED) {
    const anonymous = await call(endpoint.path, { method: endpoint.method, body: endpoint.body });
    check(
      `anonymous: ${endpoint.label} is refused (${endpoint.status})`,
      anonymous.status === 401,
      `${endpoint.method} ${endpoint.path} → ${anonymous.status}`,
    );
  }

  const forged = [
    { label: 'a forged session cookie', cookie: 'hg_owner_session=forged.eyJpZCI6ImZha2UifQ.signature' },
    { label: 'a session cookie of the wrong shape', cookie: 'hg_owner_session=1' },
  ];
  for (const attempt of forged) {
    const response = await call('/api/admin/games', { cookie: attempt.cookie });
    check(`forged: ${attempt.label} is refused`, response.status === 401, `status ${response.status}`);
  }

  const hinted = await call('/api/admin/games', {
    headers: { 'x-admin': 'true', 'x-owner': 'true', 'x-dev-owner': DEV_OWNER, 'x-forwarded-user': OWNER_EMAIL },
  });
  check('frontend hints: headers claiming to be the owner change nothing', hinted.status === 401, `status ${hinted.status}`);

  const rolePlaying = await call('/api/admin/auth/login', {
    method: 'POST',
    body: { email: OWNER_EMAIL, password: 'wrong-password-entirely-1!', isAdmin: true, role: 'admin', owner: true },
  });
  check(
    'frontend hints: a role in the request body cannot substitute for the password',
    rolePlaying.status === 401 && rolePlaying.body?.error === 'bad_credentials',
    `status ${rolePlaying.status} ${rolePlaying.body?.error ?? ''}`,
  );

  const gamesAfter = Number((await d1('SELECT COUNT(*) AS total FROM games'))[0].total);
  check('unauthorised writes: nothing was written', gamesBefore === gamesAfter, `${gamesBefore} games before and after`);
  const buildsAfter = Number((await d1('SELECT COUNT(*) AS total FROM builds'))[0].total);
  const uploadsAfter = Number((await d1('SELECT COUNT(*) AS total FROM upload_events'))[0].total);
  check(
    'unauthorised uploads: no build row and no upload event was written',
    buildsAfter === buildsBefore && uploadsAfter === uploadsBefore,
    `${buildsBefore}→${buildsAfter} builds, ${uploadsBefore}→${uploadsAfter} upload events`,
  );

  /* -------------------------------------------------- 2. the password factor */

  const wrongPassword = await call('/api/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: 'not-the-password-1!' } });
  check(
    'password: a wrong password is refused and no code is sent',
    wrongPassword.status === 401 && wrongPassword.body?.error === 'bad_credentials' && !wrongPassword.body?.challengeId,
    `status ${wrongPassword.status}`,
  );
  const wrongEmail = await call('/api/admin/auth/login', { method: 'POST', body: { email: 'nobody@example.test', password: PASSWORD } });
  check(
    'password: a wrong identity answers exactly like a wrong password',
    wrongEmail.status === wrongPassword.status &&
      wrongEmail.body?.error === wrongPassword.body?.error &&
      wrongEmail.body?.message === wrongPassword.body?.message,
    `${wrongEmail.body?.message ?? ''}`,
  );
  check('password: neither failure issues a session cookie', !wrongPassword.setCookie && !wrongEmail.setCookie);

  const afterFailures = await call('/api/admin/games');
  check('password: a failed attempt leaves the dashboard closed', afterFailures.status === 401, `status ${afterFailures.status}`);

  // The lockout is real: five failures inside the window stop further attempts.
  await clearRateLimits();
  for (let index = 0; index < 5; index += 1) {
    await call('/api/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: `wrong-${index}-password-1!` } });
  }
  const lockedOut = await call('/api/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: PASSWORD } });
  check(
    'password: repeated failures lock the password factor',
    lockedOut.status === 429 && lockedOut.body?.error === 'too_many_attempts',
    `status ${lockedOut.status} ${lockedOut.body?.error ?? ''}`,
  );
  check('password: the lockout does not leak whether the address exists', !/(email|address)\b/i.test(lockedOut.body?.message ?? ''));

  /* ------------------------------------------------ 3. the code lifecycle */

  await clearRateLimits();
  // The lockout above is sticky on purpose; clear the attempt window so the
  // lifecycle checks below start from a normal state.
  await clearAttemptWindow();
  const good = await signIn();
  const authenticated = await call('/api/admin/games', { cookie: good.cookies.value });
  check('code: the right password plus the right code opens the dashboard', authenticated.status === 200, `status ${authenticated.status}`);
  check(
    'code: the session cookie is HttpOnly and SameSite',
    /httponly/i.test(good.verified.setCookie ?? '') && /samesite/i.test(good.verified.setCookie ?? ''),
    (good.verified.setCookie ?? '').replace(/hg_owner_session=[^;]+/, 'hg_owner_session=…'),
  );
  check('code: the login step itself never returns a session cookie', !good.started.setCookie);

  // The session must not be reachable from JavaScript: the token lives in the
  // cookie above and nowhere else.
  const sessionPayload = await call('/api/admin/session', { cookie: good.cookies.value });
  const sessionText = JSON.stringify(sessionPayload.body ?? {});
  check(
    'code: the session API returns no token, hash or signing key',
    !/hg_owner_session|passphrase_hash|passphrase_salt|code_hash|owner-cookie-key|signature/.test(sessionText),
  );
  check(
    'code: the authenticated session report still masks both addresses',
    !sessionText.includes(OWNER_EMAIL) && !(OTP_EMAIL && sessionText.includes(OTP_EMAIL)),
  );

  const replay = await call('/api/admin/auth/verify', {
    method: 'POST',
    body: { challengeId: good.started.body.challengeId, code: good.started.body.localCode },
  });
  check(
    'code: a consumed code cannot be reused',
    replay.status === 410 && replay.body?.error === 'challenge_spent',
    `status ${replay.status} ${replay.body?.error ?? ''}`,
  );

  // Wrong codes burn the attempt budget, then the challenge itself.
  await clearRateLimits();
  const challenge = await call('/api/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: PASSWORD } });
  check('code: a fresh code can be requested', challenge.status === 200, `status ${challenge.status}`);
  if (!challenge.body?.localCode) {
    console.log('FAIL  code: the local catcher returned no code — set EMAIL_PROVIDER=local in .dev.vars');
    failures += 1;
  }

  let wrongCode = null;
  for (let index = 0; index < 5; index += 1) {
    wrongCode = await call('/api/admin/auth/verify', {
      method: 'POST',
      body: { challengeId: challenge.body.challengeId, code: '000000' },
    });
  }
  check(
    'code: wrong guesses are rejected and exhaust the challenge',
    wrongCode.status === 429 && wrongCode.body?.error === 'attempts_exhausted',
    `status ${wrongCode.status} ${wrongCode.body?.error ?? ''}`,
  );
  const afterExhaustion = await call('/api/admin/auth/verify', {
    method: 'POST',
    body: { challengeId: challenge.body.challengeId, code: challenge.body.localCode },
  });
  check(
    'code: an exhausted challenge rejects even the right code',
    afterExhaustion.status === 410 && afterExhaustion.body?.error === 'challenge_spent',
    `status ${afterExhaustion.status} ${afterExhaustion.body?.error ?? ''}`,
  );

  // Expiry, without waiting ten minutes: move the row's deadline into the past.
  await clearRateLimits();
  const toExpire = await call('/api/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: PASSWORD } });
  d1(`UPDATE auth_challenges SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = '${toExpire.body.challengeId}'`);
  const expired = await call('/api/admin/auth/verify', {
    method: 'POST',
    body: { challengeId: toExpire.body.challengeId, code: toExpire.body.localCode },
  });
  check(
    'code: an expired code is refused',
    expired.status === 410 && expired.body?.error === 'challenge_expired',
    `status ${expired.status} ${expired.body?.error ?? ''}`,
  );
  const expiredRow = (await d1(`SELECT status FROM auth_challenges WHERE id = '${toExpire.body.challengeId}'`))[0];
  check('code: the expired challenge is recorded as expired', expiredRow?.status === 'expired', `status ${expiredRow?.status}`);

  // Superseded: asking for a new code must retire the previous one.
  await clearRateLimits();
  const first = await call('/api/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: PASSWORD } });
  d1(`UPDATE auth_challenges SET created_at = '2000-01-01T00:00:00.000Z' WHERE id = '${first.body.challengeId}'`);
  const second = await call('/api/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: PASSWORD } });
  check('code: a second code can be issued after the cooldown', second.status === 200, `status ${second.status}`);
  const superseded = await call('/api/admin/auth/verify', {
    method: 'POST',
    body: { challengeId: first.body.challengeId, code: first.body.localCode },
  });
  check(
    'code: the superseded code is refused',
    superseded.status === 410 && superseded.body?.error === 'challenge_spent',
    `status ${superseded.status} ${superseded.body?.error ?? ''}`,
  );
  d1(`UPDATE auth_challenges SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = '${second.body.challengeId}' OR status IN ('sent')`);

  // The ceiling: eight challenges an hour per purpose.
  await clearRateLimits();
  // The owner's sub is server-side state, not something an anonymous request
  // reports — ask the local database for the row the owner was provisioned in.
  const sub = d1('SELECT sub FROM owner_auth ORDER BY created_at ASC LIMIT 1')[0]?.sub;
  if (!sub) {
    console.error('No owner_auth row: provision the local owner before running the audit.');
    process.exit(1);
  }
  const rows = Array.from({ length: 8 }, (_, index) => `('rate-${Date.now()}-${index}', '${sub}', 'login', 'x@example.test', 'x', 0, 'sent', strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes'))`).join(',');
  d1(`INSERT INTO auth_challenges (id, sub, purpose, target_email, code_hash, attempts, status, created_at, expires_at) VALUES ${rows}`);
  const capped = await call('/api/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: PASSWORD } });
  check(
    'code: the hourly ceiling is enforced',
    capped.status === 429 && capped.body?.error === 'rate_limited',
    `status ${capped.status} ${capped.body?.error ?? ''}`,
  );
  await clearRateLimits();

  /* ------------------------------------------------- 4. sessions and revocation */

  await clearRateLimits();
  const deviceA = await signIn();
  await clearRateLimits();
  const deviceB = await signIn();
  check('sessions: two devices can hold a session each', Boolean(deviceA.cookies.value) && Boolean(deviceB.cookies.value));
  check('sessions: the two devices hold different sessions', deviceA.cookies.value !== deviceB.cookies.value);

  const signedOut = await call('/api/admin/auth/signout', { method: 'POST', cookie: deviceB.cookies.value });
  check('sessions: signing out clears the cookie', /hg_owner_session=;/.test(signedOut.setCookie ?? ''), (signedOut.setCookie ?? '').split(';')[0]);
  const afterSignOut = await call('/api/admin/games', { cookie: deviceB.cookies.value });
  check('sessions: a signed-out session can no longer read admin data', afterSignOut.status === 401, `status ${afterSignOut.status}`);
  const stillAlive = await call('/api/admin/games', { cookie: deviceA.cookies.value });
  check('sessions: signing one device out leaves the other alone', stillAlive.status === 200, `status ${stillAlive.status}`);

  // Expiry: push the row's deadline into the past.
  const sessionId = (await d1(`SELECT id FROM auth_sessions WHERE sub = '${sub}' AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`))[0]?.id;
  d1(`UPDATE auth_sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = '${sessionId}'`);
  const afterExpiry = await call('/api/admin/games', { cookie: deviceA.cookies.value });
  check('sessions: an expired session is refused', afterExpiry.status === 401, `status ${afterExpiry.status}`);
  const expiredSessionRow = (await d1(`SELECT revoked_reason FROM auth_sessions WHERE id = '${sessionId}'`))[0];
  check('sessions: the expired row is closed with a reason', expiredSessionRow?.revoked_reason === 'expired', `${expiredSessionRow?.revoked_reason}`);

  // A password change has to end every other session.
  await clearRateLimits();
  const changer = await signIn();
  await clearRateLimits();
  const bystander = await signIn();

  const startChange = await call('/api/admin/auth/challenge', {
    method: 'POST',
    body: { purpose: 'password-change', password: PASSWORD },
    cookie: changer.cookies.value,
  });
  check('password change: a fresh code is required first', startChange.status === 200, `status ${startChange.status}`);
  const verifiedChange = await call('/api/admin/auth/verify', {
    method: 'POST',
    body: { challengeId: startChange.body.challengeId, code: startChange.body.localCode },
    cookie: changer.cookies.value,
  });
  const changerCookies = jar();
  changerCookies.absorb(verifiedChange);
  const changeCookies = `${changer.cookies.value}; ${verifiedChange.setCookie?.split(';')[0] ?? ''}`;
  const rotatedResponse = await call('/api/admin/security/password', {
    method: 'POST',
    body: { currentPassword: PASSWORD, newPassword: ROTATED, confirm: ROTATED },
    cookie: changeCookies,
  });
  check('password change: the change is applied', rotatedResponse.status === 200, `status ${rotatedResponse.status}`);
  const bystanderAfter = await call('/api/admin/games', { cookie: bystander.cookies.value });
  check('password change: other sessions are revoked', bystanderAfter.status === 401, `status ${bystanderAfter.status}`);

  // Put it back, so the machine is left exactly as it was found.
  await clearRateLimits();
  const backChallenge = await call('/api/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: ROTATED } });
  check('password change: the new password works', backChallenge.status === 200, `status ${backChallenge.status}`);
  const backVerified = await call('/api/admin/auth/verify', {
    method: 'POST',
    body: { challengeId: backChallenge.body.challengeId, code: backChallenge.body.localCode },
  });
  const restoreCookies = jar();
  restoreCookies.absorb(backVerified);
  await clearRateLimits();
  const restoreChallenge = await call('/api/admin/auth/challenge', {
    method: 'POST',
    body: { purpose: 'password-change', password: ROTATED },
    cookie: restoreCookies.value,
  });
  const restoreVerified = await call('/api/admin/auth/verify', {
    method: 'POST',
    body: { challengeId: restoreChallenge.body.challengeId, code: restoreChallenge.body.localCode },
    cookie: restoreCookies.value,
  });
  const restored = await call('/api/admin/security/password', {
    method: 'POST',
    body: { currentPassword: ROTATED, newPassword: PASSWORD, confirm: PASSWORD },
    cookie: `${restoreCookies.value}; ${restoreVerified.setCookie?.split(';')[0] ?? ''}`,
  });
  check('password change: the original password is restored', restored.status === 200, `status ${restored.status}`);

  /* ------------------------------------------------------ 5. provisioning */

  const bogusSetup = await call('/api/admin/auth/setup', {
    method: 'POST',
    body: { email: 'attacker@example.test', password: PASSWORD, confirm: PASSWORD, setupToken: 'guessing-the-token' },
  });
  check(
    'provisioning: a first-run attempt with a wrong token is refused',
    bogusSetup.status === 403 && bogusSetup.body?.error === 'bad_setup_token',
    `status ${bogusSetup.status} ${bogusSetup.body?.error ?? ''}`,
  );
  check('provisioning: a refused setup issues no session', !bogusSetup.setCookie);

  if (SETUP_TOKEN) {
    const afterOwner = await call('/api/admin/auth/setup', {
      method: 'POST',
      body: { email: OWNER_EMAIL, password: 'Another-Password-9!z', confirm: 'Another-Password-9!z', setupToken: SETUP_TOKEN },
    });
    check(
      'provisioning: a valid token cannot create a second owner once one exists',
      afterOwner.status === 409 && afterOwner.body?.error === 'already_setup',
      `status ${afterOwner.status} ${afterOwner.body?.error ?? ''}`,
    );
  }

  const weak = await call('/api/admin/auth/login', { method: 'POST', body: { email: OWNER_EMAIL, password: 'a' } });
  check('provisioning: the login form never reveals which field was wrong', weak.status === 401 && weak.body?.error === 'bad_credentials');

  /* ------------------------------------- 6. private configuration stays private */

  const publicPaths = ['/api/catalogue', '/api/content/about', '/api/content/contact', '/api/content/social', '/api/settings', '/sitemap.xml'];
  const leaks = [];
  for (const path of publicPaths) {
    const response = await call(path);
    if (response.text.includes(OWNER_EMAIL)) leaks.push(`${path}: login address`);
    if (OTP_EMAIL && response.text.includes(OTP_EMAIL)) leaks.push(`${path}: OTP address`);
    if (/passphrase_hash|passphrase_salt|code_hash|owner-cookie-key/.test(response.text)) leaks.push(`${path}: a secret name`);
  }
  const html = await call('/');
  if (html.text.includes(OWNER_EMAIL)) leaks.push('/: login address');
  if (OTP_EMAIL && html.text.includes(OTP_EMAIL)) leaks.push('/: OTP address');
  check('private configuration: no public response contains an owner address or a secret', leaks.length === 0, leaks.join(', ') || 'clean');

  const anonymousSession = await call('/api/admin/session');
  const anonymousText = JSON.stringify(anonymousSession.body ?? {});
  check(
    'private configuration: an anonymous session report contains no address at all',
    !anonymousText.includes(OWNER_EMAIL) && !(OTP_EMAIL && anonymousText.includes(OTP_EMAIL)) && !/masked|•/.test(anonymousText),
    anonymousText.slice(0, 140),
  );
  check(
    'private configuration: an anonymous visitor is told nothing about the factors',
    anonymousSession.body?.owner === null && anonymousSession.body?.security === null && anonymousSession.body?.gate?.mode !== undefined,
    JSON.stringify(anonymousSession.body ?? {}).slice(0, 140),
  );

  /* --------------------------------------------------------------- summary */

  await clearRateLimits();
  console.log(`\n${checks - failures}/${checks} security checks passed.`);
  if (failures > 0) process.exitCode = 1;
}

await main();
