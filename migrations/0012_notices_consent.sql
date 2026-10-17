-- NotoNawa: messages from us shown in the app (notices), and which ones
-- each person has dismissed. Notices are written with scripts/notice.mjs,
-- never by the app.
--
-- user_id NULL: for everyone. Otherwise only for that account, deleted with
-- it and included in its export (e.g. telling someone about a legal request
-- for their data). link: an extra link the banner shows ('privacy': the
-- privacy policy). Shown from starts_at until ends_at (NULL: until dismissed).

CREATE TABLE notices (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  message     TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 1000),
  level       TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning')),
  link        TEXT CHECK (link IN ('privacy')),
  starts_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ends_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX idx_notices_user ON notices(user_id);

CREATE TABLE notice_dismissals (
  notice_id     TEXT NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dismissed_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (notice_id, user_id)
);

CREATE INDEX idx_notice_dismissals_user ON notice_dismissals(user_id);
