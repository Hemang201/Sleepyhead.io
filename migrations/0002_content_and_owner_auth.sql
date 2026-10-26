-- Editable site content, live appearance settings, and owner authentication.
--
-- Two rules shape this schema:
--   1. Content the owner edits in the dashboard lives here, never in source
--      files, and has a draft copy that visitors can never read.
--   2. The owner's *private* authentication address is stored in owner_auth and
--      is never part of the public content tables. The public contact address
--      lives in site_content('contact') and the two are never written together.

-- Draft + published copies of each editable content document ('about', 'contact').
CREATE TABLE IF NOT EXISTS site_content (
  key          TEXT PRIMARY KEY,
  draft        TEXT NOT NULL,   -- JSON, the working copy the editor writes
  published    TEXT,            -- JSON, null until the owner first publishes
  draft_at     TEXT,
  published_at TEXT
);

-- Small live settings (appearance). Applied immediately, no draft copy.
CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Secrets this application generates for itself (cookie signing keys). They are
-- created on first use, stored server-side only, and never sent to a browser.
CREATE TABLE IF NOT EXISTS app_secrets (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- The owner's private authentication record: the address that receives security
-- verification codes, and the password hash. Deliberately a separate table from
-- anything the public site reads.
CREATE TABLE IF NOT EXISTS owner_auth (
  sub                    TEXT PRIMARY KEY,
  auth_email             TEXT,   -- private login address, never exposed publicly
  auth_email_verified_at TEXT,
  passphrase_hash        TEXT,   -- PBKDF2-SHA256, base64
  passphrase_salt        TEXT,
  passphrase_iters       INTEGER,
  passphrase_at          TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

-- Email verification challenges. Only a hash of the code is stored, and a
-- challenge can be used exactly once.
CREATE TABLE IF NOT EXISTS auth_challenges (
  id           TEXT PRIMARY KEY,
  sub          TEXT NOT NULL,
  purpose      TEXT NOT NULL CHECK (purpose IN ('login','password-change','email-change')),
  target_email TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL CHECK (status IN ('sent','verified','failed','expired','superseded')),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  resolved_at  TEXT,
  provider     TEXT,
  provider_ref TEXT,
  detail       TEXT
);

-- A verified dashboard session. Signing in with the provider alone never creates
-- one of these: the row is only written after a verification code is accepted.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id             TEXT PRIMARY KEY,
  sub            TEXT NOT NULL,
  verified_at    TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  user_agent     TEXT,
  revoked_at     TEXT,
  revoked_reason TEXT
);

-- Audit trail shown on the Account Security page.
CREATE TABLE IF NOT EXISTS security_events (
  id         TEXT PRIMARY KEY,
  sub        TEXT NOT NULL,
  kind       TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_sub ON auth_challenges(sub, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_sub ON auth_sessions(sub, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_sub ON security_events(sub, created_at DESC);
