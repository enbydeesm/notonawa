-- NotoNawa: push notifications (see considerations.md, "Push notifications
-- as built").
--
-- push_subscriptions: one per device that turned notifications on, for the
-- account signed in there. A device is known by its push address
-- (endpoint), which its browser's push service (Apple's, Google's,
-- Mozilla's or Microsoft's) gave it; signing in to another account on the
-- same device moves it there (deleted and added again: the owner never
-- changes). p256dh and auth are the device's keys that each push is
-- encrypted to (RFC 8291), so the push service can't read it.
--   connections: notify when a message lands in one of my mailboxes (a
--     connection sent something; the server can't tell what or who).
--   announcements: notify of notices from us posted with --push.
-- Deleted with the account, when the device turns notifications off or
-- signs out, and when the push service says the address is gone.
--
-- notices.push: send this notice as a notification too (scripts/notice.mjs
-- --push). The Worker sends it (every 5 minutes, src/push/send.js) once
-- it's showing: push_cursor is the last subscription it was sent to, and
-- pushed_at is set once it's been sent to every one.
--
-- Only a new table, columns and a trigger: nothing is rebuilt. The
-- trigger's BEGIN … END stays on one line: the test setup splits
-- statements at a ";" that ends a line.

CREATE TABLE push_subscriptions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint       TEXT NOT NULL UNIQUE,
  p256dh         TEXT NOT NULL,
  auth           TEXT NOT NULL,
  connections    INTEGER NOT NULL DEFAULT 1 CHECK (connections IN (0, 1)),
  announcements  INTEGER NOT NULL DEFAULT 1 CHECK (announcements IN (0, 1)),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);

CREATE TRIGGER trg_push_subscriptions_owner_fixed BEFORE UPDATE OF user_id ON push_subscriptions WHEN NEW.user_id <> OLD.user_id BEGIN SELECT RAISE(ABORT, 'ownership mismatch: a push subscription''s owner can''t change'); END;

ALTER TABLE notices ADD COLUMN push INTEGER NOT NULL DEFAULT 0 CHECK (push IN (0, 1));
ALTER TABLE notices ADD COLUMN push_cursor TEXT;
ALTER TABLE notices ADD COLUMN pushed_at TEXT;
