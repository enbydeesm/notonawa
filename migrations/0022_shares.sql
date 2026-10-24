-- NotoNawa: shares, sealed copies of a profile, tie, plan or workshop that
-- someone else can open with a link (see considerations.md, "Sharing
-- between accounts").
--
-- shares: one row per share. The sealed snapshot itself is in R2 (the
-- PHOTOS bucket, at "<owner id>/shares/<share id>/snapshot"), sealed in the
-- browser with a key that's only in the link, so we can't open it.
--   id: made by the browser, as the snapshot is bound to it before upload.
--   kind: what it's a copy of.
--   label: the sender's own name for it, sealed with their data key.
--   bytes: what it takes up in R2, counted toward the account's 1 GB.
--   expires_at: NULL until revoked.
--   max_uses, use_count: how many times it can be opened (NULL: any number)
--     and has been. The last allowed open deletes it.
-- Revoking deletes the row (and its files): nothing remembers a revoked
-- share. Deleted with the account.
--
-- Only a new table: nothing is rebuilt.

CREATE TABLE shares (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('profile', 'tie', 'plan', 'workshop')),
  label       TEXT,
  bytes       INTEGER NOT NULL CHECK (bytes > 0),
  expires_at  TEXT,
  max_uses    INTEGER CHECK (max_uses IS NULL OR max_uses >= 1),
  use_count   INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_shares_owner ON shares(owner_id, created_at);
CREATE INDEX idx_shares_expires ON shares(expires_at) WHERE expires_at IS NOT NULL;

-- owner_id can't change, as on every other table.
CREATE TRIGGER trg_shares_owner_fixed
BEFORE UPDATE OF owner_id ON shares
WHEN NEW.owner_id <> OLD.owner_id
BEGIN
  SELECT RAISE(ABORT, 'ownership mismatch: owner_id cannot change');
END;
