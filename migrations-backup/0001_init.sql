-- Catalogue schema for the self-managed game publishing platform.
--
-- The site itself ships no games: every row here is created through the admin
-- dashboard, and the public pages read only what this schema says is visible.

CREATE TABLE IF NOT EXISTS admins (
  sub        TEXT PRIMARY KEY,
  email      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS games (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  short_description TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  genres        TEXT NOT NULL DEFAULT '[]',   -- JSON array of genre ids
  tags          TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  instructions  TEXT NOT NULL DEFAULT '',
  controls      TEXT NOT NULL DEFAULT '{}',   -- JSON { keyboard: [], mouse: [], touch: [] }
  playtime      TEXT,
  version       TEXT,
  update_notes  TEXT,
  release_date  TEXT,
  cover_alt     TEXT NOT NULL DEFAULT '',
  accent        TEXT NOT NULL DEFAULT 'cyan',
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','in-development','coming-soon','published','unavailable','archived')),
  listed        INTEGER NOT NULL DEFAULT 0,   -- owner opt-in: show a non-published game publicly
  featured      INTEGER NOT NULL DEFAULT 0,
  thumbnail_key TEXT,
  banner_key    TEXT,
  screenshots   TEXT NOT NULL DEFAULT '[]',   -- JSON array of R2 keys
  active_build_id TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  published_at  TEXT,
  archived_at   TEXT
);

CREATE TABLE IF NOT EXISTS builds (
  id          TEXT PRIMARY KEY,
  game_id     TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  version     TEXT,
  status      TEXT NOT NULL DEFAULT 'uploading'
              CHECK (status IN ('uploading','ready','active','superseded','failed','rejected')),
  entry_path  TEXT,
  file_count  INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  notes       TEXT,
  created_at  TEXT NOT NULL,
  ready_at    TEXT
);

CREATE TABLE IF NOT EXISTS build_files (
  build_id     TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  path         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  PRIMARY KEY (build_id, path)
);

-- Audit trail and rate limiting for sensitive operations.
CREATE TABLE IF NOT EXISTS upload_events (
  id         TEXT PRIMARY KEY,
  actor      TEXT NOT NULL,
  game_id    TEXT,
  build_id   TEXT,
  kind       TEXT NOT NULL,   -- build.init | build.file | build.zip | artwork | delete
  detail     TEXT,
  size       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_status ON games(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_slug ON games(slug);
CREATE INDEX IF NOT EXISTS idx_games_featured ON games(featured, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_builds_game ON builds(game_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_build_files_build ON build_files(build_id);
CREATE INDEX IF NOT EXISTS idx_events_actor ON upload_events(actor, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_kind ON upload_events(kind, created_at DESC);
