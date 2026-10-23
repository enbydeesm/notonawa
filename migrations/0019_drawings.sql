-- NotoNawa: drawings on ties, plans and workshops.
--
-- drawings: one drawing, kept as its lines (data: JSON, plain text, see
-- src/drawings/parse.js), so it can be edited again, duplicated and copied.
-- Unlike photos, drawings aren't encrypted; their caption is, sealed in the
-- browser like a tie's notes (src/encryption/config.js). On exactly one
-- tie, plan or workshop, and deleted with it. position orders an item's
-- drawings, as media.position does its photos.
--
-- Each trigger's BEGIN … END stays on one line: the test setup splits
-- statements at a ";" that ends a line.

CREATE TABLE drawings (
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

CREATE INDEX idx_drawings_owner    ON drawings(owner_id);
CREATE INDEX idx_drawings_tie      ON drawings(tie_id, position) WHERE tie_id IS NOT NULL;
CREATE INDEX idx_drawings_plan     ON drawings(plan_id, position) WHERE plan_id IS NOT NULL;
CREATE INDEX idx_drawings_workshop ON drawings(workshop_id, position) WHERE workshop_id IS NOT NULL;

-- A drawing must be on one of its owner's own ties, plans or workshops.
CREATE TRIGGER trg_drawings_tie_owner BEFORE INSERT ON drawings
WHEN NEW.tie_id IS NOT NULL
  AND (SELECT owner_id FROM ties WHERE id = NEW.tie_id) IS NOT NEW.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: drawing tie'); END;

CREATE TRIGGER trg_drawings_plan_owner BEFORE INSERT ON drawings
WHEN NEW.plan_id IS NOT NULL
  AND (SELECT owner_id FROM plans WHERE id = NEW.plan_id) IS NOT NEW.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: drawing plan'); END;

CREATE TRIGGER trg_drawings_workshop_owner BEFORE INSERT ON drawings
WHEN NEW.workshop_id IS NOT NULL
  AND (SELECT owner_id FROM workshops WHERE id = NEW.workshop_id) IS NOT NEW.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: drawing workshop'); END;

-- A drawing never moves to another owner or item: copying one makes a new
-- drawing there. Only its lines, caption and position change.
CREATE TRIGGER trg_drawings_fixed BEFORE UPDATE OF id, owner_id, tie_id, plan_id, workshop_id ON drawings
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: drawing cannot move'); END;
