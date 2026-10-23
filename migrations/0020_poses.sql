-- NotoNawa: poses on ties, plans and workshops.
--
-- poses: one posed 3D figure, kept as its joint angles, body orientation,
-- camera and ropes (data: JSON, plain text, see src/poses/parse.js), so it
-- can be opened and posed again, duplicated and copied. Like drawings,
-- poses aren't encrypted; their caption is, sealed in the browser like a
-- tie's notes (src/encryption/config.js). On exactly one tie, plan or
-- workshop, and deleted with it. position orders an item's poses, as
-- drawings.position does its drawings.
--
-- Each trigger's BEGIN … END stays on one line: the test setup splits
-- statements at a ";" that ends a line.

CREATE TABLE poses (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tie_id       TEXT REFERENCES ties(id) ON DELETE CASCADE,
  plan_id      TEXT REFERENCES plans(id) ON DELETE CASCADE,
  workshop_id  TEXT REFERENCES workshops(id) ON DELETE CASCADE,
  data         TEXT NOT NULL,
  caption      TEXT,
  position     INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK ((tie_id IS NOT NULL) + (plan_id IS NOT NULL) + (workshop_id IS NOT NULL) = 1)
);

CREATE INDEX idx_poses_owner    ON poses(owner_id);
CREATE INDEX idx_poses_tie      ON poses(tie_id, position) WHERE tie_id IS NOT NULL;
CREATE INDEX idx_poses_plan     ON poses(plan_id, position) WHERE plan_id IS NOT NULL;
CREATE INDEX idx_poses_workshop ON poses(workshop_id, position) WHERE workshop_id IS NOT NULL;

-- A pose must be on one of its owner's own ties, plans or workshops.
CREATE TRIGGER trg_poses_tie_owner BEFORE INSERT ON poses
WHEN NEW.tie_id IS NOT NULL
  AND (SELECT owner_id FROM ties WHERE id = NEW.tie_id) IS NOT NEW.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: pose tie'); END;

CREATE TRIGGER trg_poses_plan_owner BEFORE INSERT ON poses
WHEN NEW.plan_id IS NOT NULL
  AND (SELECT owner_id FROM plans WHERE id = NEW.plan_id) IS NOT NEW.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: pose plan'); END;

CREATE TRIGGER trg_poses_workshop_owner BEFORE INSERT ON poses
WHEN NEW.workshop_id IS NOT NULL
  AND (SELECT owner_id FROM workshops WHERE id = NEW.workshop_id) IS NOT NEW.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: pose workshop'); END;

-- A pose never moves to another owner or item: copying one makes a new
-- pose there. Only its data, caption and position change.
CREATE TRIGGER trg_poses_fixed BEFORE UPDATE OF id, owner_id, tie_id, plan_id, workshop_id ON poses
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: pose cannot move'); END;
