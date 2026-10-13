-- Rope Journal: passkey sign-in, app sessions, recovery codes and invites.
-- Replaces Cloudflare Access.
--
-- users.email is no longer used. SQLite can't drop a column with a UNIQUE
-- constraint, and rebuilding users would delete every journal row (DROP TABLE
-- runs an implicit DELETE, which cascades). So each email is overwritten with
-- the user's own id: still unique, no longer identifying. New users get
-- email = id too. Drop the column at the next full rebuild (considerations.md).

UPDATE users SET email = id;

-- SHA-256 (hex) of the login secret the browser derives from the recovery
-- code. Never the code itself, which will also unlock the encryption key.
ALTER TABLE users ADD COLUMN recovery_secret_hash TEXT;
-- When the user confirmed they're 18+ and consented to storing sensitive
-- data, and which version of the privacy policy they agreed to.
ALTER TABLE users ADD COLUMN accepted_at TEXT;
ALTER TABLE users ADD COLUMN terms_version TEXT;

CREATE UNIQUE INDEX idx_users_recovery ON users(recovery_secret_hash);

CREATE TABLE passkeys (
  id            TEXT PRIMARY KEY,                       -- credential id, base64url
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key    TEXT NOT NULL,                          -- COSE-encoded public key, base64url
  counter       INTEGER NOT NULL DEFAULT 0,             -- signature counter (0 for most synced passkeys)
  transports    TEXT,                                   -- JSON list, hints for the browser
  name          TEXT NOT NULL,                          -- the user's name for it, e.g. "My phone"
  prf_capable   INTEGER CHECK (prf_capable IN (0, 1)),  -- can derive encryption keys (step 4); NULL = unknown
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_used_at  TEXT
);

CREATE INDEX idx_passkeys_user ON passkeys(user_id);

-- Only a hash of each session's token is kept, so a copy of the database
-- can't be used to sign in. Removing a passkey ends the sessions it started.
-- kind 'recovery': signed in with a recovery code; can only add a passkey,
-- set a new recovery code, or sign out, and lasts 15 minutes.
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,                       -- shown to the user's own account page
  token_hash    TEXT NOT NULL UNIQUE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  passkey_id    TEXT REFERENCES passkeys(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'full' CHECK (kind IN ('full', 'recovery')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_used_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  expires_at    TEXT NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);

-- One-time WebAuthn challenges, deleted when used or once expired.
-- Registering a new account: new_user_id is the id the account will get, and
-- invite_hash the invite it will use. Adding a passkey: user_id.
CREATE TABLE auth_challenges (
  challenge     TEXT PRIMARY KEY,                       -- base64url
  purpose       TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  new_user_id   TEXT,
  invite_hash   TEXT,
  expires_at    TEXT NOT NULL
);

-- Sign-up is by invite only (made with scripts/invite.mjs). Only a hash of
-- each code is kept.
CREATE TABLE invites (
  code_hash     TEXT PRIMARY KEY,                       -- SHA-256 (hex) of the code
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  expires_at    TEXT,                                   -- NULL = never
  used_at       TEXT,
  used_by       TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- An invite works once, before it expires. Checked here so two sign-ups
-- racing for the same invite can't both get in: the second one's batch fails.
CREATE TRIGGER trg_invites_use_once BEFORE UPDATE OF used_at ON invites
WHEN OLD.used_at IS NOT NULL
  OR (OLD.expires_at IS NOT NULL AND OLD.expires_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
BEGIN SELECT RAISE(ABORT, 'invite unavailable'); END;
