-- Rope Journal: wrapped (locked) copies of each user's encryption key.
--
-- The key itself never reaches us. The browser wraps it with a key made
-- from a passkey's PRF output, or from the recovery code, and sends only
-- the wrap (public/js/crypto/keys.js). An account "has a key" once it has
-- its recovery wrap.
--
-- id is made by the browser, because it's part of what the wrap is bound to
-- (with the user, kind and version), so a wrap can't be passed off as
-- another. Removing a passkey removes its wrap.
--
-- A recovery wrap records which recovery code it was made with (the hash of
-- that code's login secret, as in users.recovery_secret_hash). When the
-- operator gives an account a new code, the wrap no longer matches it; the
-- app sees that and asks for a new recovery code at the next unlock, so the
-- old code doesn't keep working for good.

CREATE TABLE key_wraps (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL CHECK (kind IN ('passkey', 'recovery')),
  passkey_id            TEXT REFERENCES passkeys(id) ON DELETE CASCADE,
  recovery_secret_hash  TEXT,
  salt                  TEXT NOT NULL,   -- base64url, 16 bytes
  iv                    TEXT NOT NULL,   -- base64url, 12 bytes
  wrapped               TEXT NOT NULL,   -- base64url, 48 bytes (key and tag)
  version               INTEGER NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK ((kind = 'passkey') = (passkey_id IS NOT NULL)),
  CHECK ((kind = 'recovery') = (recovery_secret_hash IS NOT NULL))
);

CREATE INDEX idx_key_wraps_user ON key_wraps(user_id);
-- One wrap per passkey, and one recovery wrap per user.
CREATE UNIQUE INDEX idx_key_wraps_passkey ON key_wraps(passkey_id) WHERE passkey_id IS NOT NULL;
CREATE UNIQUE INDEX idx_key_wraps_recovery ON key_wraps(user_id) WHERE kind = 'recovery';

-- A passkey wrap must be for one of the user's own passkeys. Errors start
-- with 'ownership mismatch' so the Worker can recognise them.
CREATE TRIGGER trg_key_wraps_passkey_owner BEFORE INSERT ON key_wraps
WHEN NEW.passkey_id IS NOT NULL
  AND (SELECT user_id FROM passkeys WHERE id = NEW.passkey_id) IS NOT NEW.user_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: key wrap for another user''s passkey'); END;

-- Wraps are replaced, never changed.
CREATE TRIGGER trg_key_wraps_no_update BEFORE UPDATE ON key_wraps
BEGIN SELECT RAISE(ABORT, 'key wraps are replaced, not changed'); END;
