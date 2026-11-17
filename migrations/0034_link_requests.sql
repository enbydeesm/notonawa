-- NotoNawa: signing in on a new device by scanning a code with one that's
-- signed in (see considerations.md, "Linking a device as built").
--
-- link_requests: one per "Sign in with another device", made by the new
-- device while signed out. It lasts 5 minutes and is used once: deleted
-- when the new device picks up the approval, when it's declined, or by the
-- daily job once expired.
--   poll_hash: SHA-256 of the token the new device asks with; only it can
--     pick up the approval.
--   public_key: the new device's throwaway X-Wing public key (base64url),
--     which the approving device seals the data key to. The QR code carries
--     its SHA-256, so the server can't swap in a key of its own.
--   user_id, sealed_key, approved_at: set together when a signed-in device
--     approves; sealed_key can only be opened by the new device's Worker.
-- Deleted with the account that approved it (user_id cascades).
--
-- Only a new table and a trigger: nothing is rebuilt. The trigger's BEGIN
-- … END stays on one line: the test setup splits statements at a ";" that
-- ends a line.

CREATE TABLE link_requests (
  id           TEXT PRIMARY KEY,
  poll_hash    TEXT NOT NULL,
  public_key   TEXT NOT NULL,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  sealed_key   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  expires_at   TEXT NOT NULL,
  approved_at  TEXT,
  CHECK ((user_id IS NULL) = (sealed_key IS NULL)),
  CHECK ((user_id IS NULL) = (approved_at IS NULL))
);

CREATE INDEX idx_link_requests_user ON link_requests(user_id);

-- Approved once, by one account: never moved to another.
CREATE TRIGGER trg_link_requests_owner_fixed BEFORE UPDATE OF user_id ON link_requests WHEN OLD.user_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'ownership mismatch: a link request can''t change hands'); END;
