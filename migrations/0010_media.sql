-- Rope Journal: photos on ties and plans (videos later: see considerations.md).
--
-- The files themselves are in R2 (the PHOTOS bucket), one object per item,
-- keyed "<owner_id>/<id>": the thumbnail's sealed bytes, then the full
-- size's (thumb_bytes says where one ends). Both are encrypted in the
-- browser, which also strips the metadata, so we can't see them. What we
-- can see is here: which tie or plan, the order, sizes and when.
--
-- id is made by the browser, because the encryption is bound to it (with
-- the user), so the server can't pass one photo off as another. caption is
-- sealed in the browser too, bound to the same id.
--
-- Rows cascade with their tie, plan or user; the routes then delete the R2
-- objects, and the daily clean-up deletes any objects left without a row.

CREATE TABLE media (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tie_id       TEXT REFERENCES ties(id) ON DELETE CASCADE,
  plan_id      TEXT REFERENCES plans(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('photo', 'video')),
  mime         TEXT NOT NULL,
  caption      TEXT,
  position     INTEGER NOT NULL,
  thumb_bytes  INTEGER NOT NULL,
  bytes        INTEGER NOT NULL,   -- the whole object, thumbnail included
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK ((tie_id IS NULL) <> (plan_id IS NULL)),
  CHECK (thumb_bytes > 0 AND thumb_bytes < bytes)
);

CREATE INDEX idx_media_owner ON media(owner_id);
CREATE INDEX idx_media_tie ON media(tie_id, position) WHERE tie_id IS NOT NULL;
CREATE INDEX idx_media_plan ON media(plan_id, position) WHERE plan_id IS NOT NULL;

-- A photo must be on one of its owner's own ties or plans. Errors start
-- with 'ownership mismatch' so the Worker can recognise them.
CREATE TRIGGER trg_media_tie_owner BEFORE INSERT ON media
WHEN NEW.tie_id IS NOT NULL
  AND (SELECT owner_id FROM ties WHERE id = NEW.tie_id) IS NOT NEW.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: media tie'); END;

CREATE TRIGGER trg_media_plan_owner BEFORE INSERT ON media
WHEN NEW.plan_id IS NOT NULL
  AND (SELECT owner_id FROM plans WHERE id = NEW.plan_id) IS NOT NEW.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: media plan'); END;

-- A photo never moves to another owner, tie or plan (its R2 key holds the
-- owner); only its caption and position change.
CREATE TRIGGER trg_media_fixed BEFORE UPDATE OF id, owner_id, tie_id, plan_id ON media
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: media cannot move'); END;
