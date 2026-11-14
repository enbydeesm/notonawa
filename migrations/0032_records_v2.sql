-- NotoNawa: format 2, every journal field sealed (see considerations.md,
-- "Encrypt everything"). Only adds: the format 1 tables stay until every
-- account has converted (a later migration drops them).
--
-- users.format: 1 (the tables of migrations 0001–0031) or 2 (records).
--   sync_seq: the last sequence number given to one of the account's
--   records or deletion markers; each write takes the next ones, so a
--   device asks for everything since the last it saw.
--   converting_since: set while the account's device converts it.
--   converted_at: when it became format 2.
--
-- records: one per tie, plan, person, location, workshop, tag, drawing,
-- pose, preset, settings or contact, its fields and links sealed in body
-- ("e2.…") under its item key, which is sealed under the data key in key
-- ("k2.…"). The server reads neither. id is made by the browser. version
-- starts at 1 and rises by one with each write (a trigger); seq is the
-- account's sequence number of its last write.
--
-- record_deletions: a deleted record's id and the seq of its deletion, so
-- other devices drop it. Kept for good (small, and a device away for months
-- still syncs). An id deleted can't be used again (a trigger).
--
-- files: format v3 photos and videos (their key is in their item's record;
-- nothing here says which item). Sizes for the quota and range reads.
--
-- identity_keys: each account's X-Wing public key (plain: others seal to
-- it) and its seed, sealed under the data key ("i1.…").
--
-- mailboxes and mailbox_messages: where connected accounts' devices leave
-- each other sealed messages. A mailbox is written to with a token (only
-- its hash is kept) and no session; its owner reads it. intro: the one-time
-- mailbox an invite carries, expiring with it. slot "profile": a newer
-- profile message replaces one not yet fetched.
--
-- version_checks and quota_checks: always empty. A records write starts
-- with an INSERT into version_checks that puts a NULL in (and so fails,
-- rolling back the whole batch) when a record isn't at the version the
-- device based its write on, and ends with one into quota_checks that does
-- the same when the account is over its 1 GB. Two tables, so the error
-- says which.
--
-- Every new table is deleted with its user. Each trigger's BEGIN … END stays
-- on one line: the test setup splits statements at a ";" that ends a line.

ALTER TABLE users ADD COLUMN format INTEGER NOT NULL DEFAULT 1 CHECK (format IN (1, 2));
ALTER TABLE users ADD COLUMN sync_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN converting_since TEXT;
ALTER TABLE users ADD COLUMN converted_at TEXT;

CREATE TABLE records (
  id        TEXT PRIMARY KEY,
  owner_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL CHECK (kind IN ('tie', 'plan', 'person', 'location', 'workshop', 'tag', 'drawing', 'pose',
                                          'pose_preset', 'settings', 'contact')),
  version   INTEGER NOT NULL CHECK (version >= 1),
  seq       INTEGER NOT NULL,
  key       TEXT NOT NULL,
  body      TEXT NOT NULL,
  bytes     INTEGER NOT NULL CHECK (bytes >= 0)
);
CREATE UNIQUE INDEX idx_records_owner_seq ON records(owner_id, seq);

CREATE TABLE record_deletions (
  id        TEXT PRIMARY KEY,
  owner_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL,
  seq       INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_record_deletions_owner_seq ON record_deletions(owner_id, seq);

CREATE TABLE files (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('photo', 'video')),
  thumb_bytes  INTEGER NOT NULL CHECK (thumb_bytes >= 0),
  bytes        INTEGER NOT NULL CHECK (bytes >= thumb_bytes),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_files_owner ON files(owner_id);

CREATE TABLE identity_keys (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  public_key   TEXT NOT NULL,
  sealed_seed  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE mailboxes (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('intro', 'contact')),
  expires_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK ((kind = 'intro') = (expires_at IS NOT NULL))
);
CREATE INDEX idx_mailboxes_owner ON mailboxes(owner_id);

CREATE TABLE mailbox_messages (
  id          TEXT PRIMARY KEY,
  mailbox_id  TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  slot        TEXT CHECK (slot IS NULL OR slot = 'profile'),
  body        TEXT NOT NULL,
  bytes       INTEGER NOT NULL CHECK (bytes >= 0),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX idx_mailbox_messages_mailbox ON mailbox_messages(mailbox_id, created_at);
CREATE UNIQUE INDEX idx_mailbox_messages_slot ON mailbox_messages(mailbox_id, slot) WHERE slot IS NOT NULL;

CREATE TABLE version_checks (ok INTEGER NOT NULL);
CREATE TABLE quota_checks (ok INTEGER NOT NULL);

CREATE TRIGGER trg_records_owner_fixed BEFORE UPDATE OF owner_id ON records WHEN NEW.owner_id <> OLD.owner_id BEGIN SELECT RAISE(ABORT, 'ownership mismatch: a record''s owner can''t change'); END;
CREATE TRIGGER trg_records_kind_fixed BEFORE UPDATE OF kind ON records WHEN NEW.kind <> OLD.kind BEGIN SELECT RAISE(ABORT, 'stale: a record''s kind can''t change'); END;
CREATE TRIGGER trg_records_version_next BEFORE UPDATE ON records WHEN NEW.version <> OLD.version + 1 BEGIN SELECT RAISE(ABORT, 'stale: a record''s version rises by one'); END;
CREATE TRIGGER trg_records_version_first BEFORE INSERT ON records WHEN NEW.version <> 1 BEGIN SELECT RAISE(ABORT, 'stale: a new record starts at version 1'); END;
CREATE TRIGGER trg_records_not_deleted BEFORE INSERT ON records WHEN EXISTS (SELECT 1 FROM record_deletions WHERE id = NEW.id) BEGIN SELECT RAISE(ABORT, 'stale: that record was deleted'); END;
CREATE TRIGGER trg_record_deletions_not_live BEFORE INSERT ON record_deletions WHEN EXISTS (SELECT 1 FROM records WHERE id = NEW.id) BEGIN SELECT RAISE(ABORT, 'stale: delete the record before marking it deleted'); END;
CREATE TRIGGER trg_files_owner_fixed BEFORE UPDATE OF owner_id ON files WHEN NEW.owner_id <> OLD.owner_id BEGIN SELECT RAISE(ABORT, 'ownership mismatch: a file''s owner can''t change'); END;
CREATE TRIGGER trg_mailboxes_owner_fixed BEFORE UPDATE OF owner_id ON mailboxes WHEN NEW.owner_id <> OLD.owner_id BEGIN SELECT RAISE(ABORT, 'ownership mismatch: a mailbox''s owner can''t change'); END;
