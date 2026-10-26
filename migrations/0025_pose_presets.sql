-- NotoNawa: saved poser presets, each person's own.
--
-- pose_presets: a body or arms position saved from the poser, to start
-- other poses from, on any tie, plan or workshop (see
-- src/pose-presets/parse.js).
--   kind: "body" (the trunk, head and legs, and the whole body's turn and
--     height) or "arms" (the shoulders, elbows and wrists), as the
--     built-in presets split them.
--   name: sealed in the browser, like a pose's caption
--     (src/encryption/config.js). Always given, but NULL after a new key
--     empties the encrypted fields (src/encryption/db.js); the poser then
--     shows it unnamed.
--   data: the angles, plain JSON, as poses are: { joints, body, lift } for
--     a body preset, { joints } for an arms preset.
-- Deleted with the account.
--
-- Only a new table: nothing is rebuilt. Each trigger's BEGIN … END stays on
-- one line: the test setup splits statements at a ";" that ends a line.

CREATE TABLE pose_presets (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('body', 'arms')),
  name        TEXT,
  data        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_pose_presets_owner ON pose_presets(owner_id, kind, created_at);

-- A preset never moves to another owner, or changes kind.
CREATE TRIGGER trg_pose_presets_fixed BEFORE UPDATE OF id, owner_id, kind ON pose_presets
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: pose preset cannot move'); END;
