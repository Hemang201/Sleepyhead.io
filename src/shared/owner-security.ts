/**
 * The owner-security contract, shared by the Worker (which enforces it) and the
 * dashboard (which only describes it to the owner).
 *
 * Two addresses, never the same value, never written together:
 *
 *   private  the authentication address stored in `owner_auth`. It receives
 *            verification codes and security notices, and is never rendered in
 *            full anywhere a visitor could reach.
 *   public   the contact address in the `contact` content document. It is on the
 *            Contact page, in mailto: links and in the footer.
 *
 * Nothing in this file is a secret. The password hash, the signing key and the
 * provider API key live server-side only (D1 and Worker env vars).
 */

export const CHALLENGE_PURPOSES = ['login', 'password-change', 'email-change'] as const;
export type ChallengePurpose = (typeof CHALLENGE_PURPOSES)[number];

/** How long a verification code stays usable. */
export const CHALLENGE_TTL_MINUTES = 10;
/** Wrong guesses allowed per challenge before it is burned. */
export const CHALLENGE_MAX_ATTEMPTS = 5;
/** Seconds before the owner may request another code. */
export const CHALLENGE_RESEND_COOLDOWN_SECONDS = 60;
/** Challenges per hour, per purpose. */
export const CHALLENGE_MAX_PER_HOUR = 8;
/** Password attempts allowed in the login window. */
export const PASSWORD_MAX_ATTEMPTS = 5;
export const PASSWORD_ATTEMPT_WINDOW_MINUTES = 15;
/** How long a verified dashboard session lasts. */
export const SESSION_TTL_HOURS = 12;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

export type PasswordProblem =
  | 'too_short'
  | 'too_long'
  | 'needs_letter'
  | 'needs_number'
  | 'needs_symbol'
  | 'repeated'
  | 'common';

const COMMON_PASSWORDS = [
  'password',
  'passw0rd',
  'letmein',
  'qwerty',
  'admin',
  'welcome',
  'iloveyou',
  'monkey',
  'dragon',
  'changeme',
];

/**
 * Password policy, applied on the server before hashing and shown live in the
 * dashboard. Deliberately length-first: no composition theatre beyond the
 * minimums, but nothing guessable either.
 */
export function checkPassword(password: string, context: string[] = []): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (password.length > PASSWORD_MAX_LENGTH) return 'too_long';
  if (!/[a-z]/i.test(password)) return 'needs_letter';
  if (!/[0-9]/.test(password)) return 'needs_number';
  if (!/[^a-z0-9]/i.test(password)) return 'needs_symbol';

  const lowered = password.toLowerCase();
  if (COMMON_PASSWORDS.some((entry) => lowered.includes(entry))) return 'common';
  // Four identical characters in a row, or a keyboard/sequence run, is padding
  // rather than a secret.
  if (/(.)\1{3,}/.test(password)) return 'repeated';
  if (/^(0123|1234|abcd|qwer)/i.test(password)) return 'repeated';

  for (const value of context) {
    const token = value.trim().toLowerCase();
    if (token.length >= 4 && lowered.includes(token)) return 'repeated';
  }
  return null;
}

export const PASSWORD_PROBLEM_MESSAGES: Record<PasswordProblem, string> = {
  too_short: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  too_long: `Keep it under ${PASSWORD_MAX_LENGTH} characters.`,
  needs_letter: 'Include at least one letter.',
  needs_number: 'Include at least one number.',
  needs_symbol: 'Include at least one symbol.',
  repeated: 'That is too repetitive — mix it up a bit.',
  common: 'That contains a very common password. Choose something less predictable.',
};

/** One-line summary for the editor's live hint. */
export const PASSWORD_RULE_HINT = `At least ${PASSWORD_MIN_LENGTH} characters, with a letter, a number and a symbol.`;

/* ------------------------------------------------------------------ results */

export type EmailDeliveryStatus = 'unconfigured' | 'configured';

export interface EmailProviderState {
  /** `resend` in production, `local` only on a loopback development origin. */
  name: string;
  status: EmailDeliveryStatus;
  /** True when the code is handed back to the caller instead of being emailed. */
  localCatch: boolean;
  /** Where verification mail is sent from, e.g. `Arcade <noreply@example.com>`. */
  from: string | null;
}

export interface SecurityState {
  /**
   * The administrator's login identity, masked. This is the address typed into
   * the sign-in form; it is never the public contact address.
   */
  loginEmail: { configured: boolean; masked: string | null };
  /**
   * The private OTP destination, masked. Never the full value. `managed` is true
   * when the deployment pins it with OWNER_OTP_EMAIL, in which case the stored
   * address cannot be changed from the dashboard.
   */
  authEmail: { configured: boolean; masked: string | null; verifiedAt: string | null; managed: boolean };
  /** Where a pending new authentication address would go, masked. */
  pendingAuthEmail: { masked: string | null } | null;
  passphrase: { set: boolean; updatedAt: string | null };
  /** Public contact address, so the two are visibly independent. */
  publicContactEmail: string;
  provider: EmailProviderState;
  /** 'required' is the only production value. */
  enforcement: 'required';
  session: { verified: boolean; verifiedAt: string | null; expiresAt: string | null; activeSessions: number };
  limits: {
    challengeTtlMinutes: number;
    maxAttempts: number;
    resendCooldownSeconds: number;
    maxPerHour: number;
    sessionTtlHours: number;
  };
}

export interface SecurityEvent {
  id: string;
  kind: string;
  detail: string | null;
  createdAt: string;
}

export const SECURITY_EVENT_LABELS: Record<string, string> = {
  'session.created': 'Dashboard session verified',
  'session.revoked': 'Dashboard session signed out',
  'session.expired': 'Dashboard session expired',
  'challenge.sent': 'Verification code emailed',
  'challenge.failed': 'Wrong verification code',
  'challenge.expired': 'Verification code expired',
  'password.changed': 'Password changed',
  'password.attempt': 'Password change requested',
  'auth-email.changed': 'Authentication address changed',
  'auth-email.pending': 'New authentication address requested',
  'recovery.guidance': 'Recovery instructions viewed',
};

export interface ChallengeResponse {
  challengeId: string;
  purpose: ChallengePurpose;
  /** Masked destination, so the dashboard can say where the code went. */
  sentTo: string;
  expiresAt: string;
  attemptsLeft: number;
  resendAfterSeconds: number;
  /**
   * Present only for the loopback-only local catcher, which exists so the flow
   * can be exercised on a development machine. It is unreachable on a deployed
   * origin (the server refuses the local provider there) and the production
   * provider never returns a code.
   */
  localCode?: string;
}
