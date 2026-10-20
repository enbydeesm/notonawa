-- NotoNawa: the welcome dialog's "Don't show this again", and bug reports
-- and ideas sent from the app.
--
-- users.hide_welcome: 1 once I tick "Don't show this again". Every account
-- starts at 0, those made before this migration included, so everyone sees
-- the welcome (public/js/welcome.js) until they tick it.
--
-- feedback: what the "Bug and feedback" form sends. Plain text, not
-- encrypted, as it's for us to read (scripts/feedback.mjs); the form warns
-- not to put journal details in it. Deleted with the account and included
-- in its export. app_version: the version the page was running.
--
-- Only a new column and a new table: no table is rebuilt.

ALTER TABLE users ADD COLUMN hide_welcome INTEGER NOT NULL DEFAULT 0 CHECK (hide_welcome IN (0, 1));

CREATE TABLE feedback (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('bug', 'idea')),
  message      TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  app_version  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_feedback_user ON feedback(user_id, created_at);
