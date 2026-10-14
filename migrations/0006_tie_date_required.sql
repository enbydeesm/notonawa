-- Rope Journal: every tie has a date, so date searches never leave one out.
-- The app has required it since this migration (src/ties/parse.js, the tie
-- form and import); here the database enforces it too. No live or local tie
-- had a missing date when this was written.
--
-- SQLite can't add NOT NULL to an existing column, so ties is rebuilt, as in
-- 0002: create new_<table>, copy the rows across, drop the old tables, then
-- rename new_<table> to <table>. The tables that link to ties (tie_plans,
-- tie_participants, tie_tags) are rebuilt with it and dropped first, so
-- dropping ties never cascades into them. Their triggers and indexes go with
-- the old tables and are made again below.
--
-- The trigger on locations that marks ties "(location deleted)" refers to
-- ties, and a rename fails while a trigger names a table that's gone, so it's
-- dropped first and made again at the end.

PRAGMA defer_foreign_keys = true;

DROP TRIGGER trg_locations_mark_ties_deleted;

-- --- new tables --------------------------------------------------------------

CREATE TABLE new_ties (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT,
  tie_date          TEXT NOT NULL,                     -- YYYY-MM-DD
  tie_type          TEXT CHECK (tie_type IN ('suspension', 'partial suspension', 'floor')),
  location_id       TEXT REFERENCES locations(id) ON DELETE SET NULL,
  location_deleted  INTEGER NOT NULL DEFAULT 0,        -- 1 = had a location that was since deleted ("(location deleted)")
  duration_minutes  INTEGER,
  success_rating    INTEGER CHECK (success_rating BETWEEN 1 AND 5),  -- how it went overall / vs plan
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (location_id IS NULL OR location_deleted = 0)  -- setting a new location must clear the flag
);

CREATE TABLE new_tie_plans (
  id            TEXT PRIMARY KEY,
  tie_id        TEXT NOT NULL REFERENCES new_ties(id) ON DELETE CASCADE,
  plan_id       TEXT REFERENCES plans(id) ON DELETE SET NULL,
  plan_version  INTEGER NOT NULL,
  UNIQUE (tie_id, plan_id)                             -- NULLs don't clash, so deleted plans never collide
);

CREATE TABLE new_tie_participants (
  id                 TEXT PRIMARY KEY,
  tie_id             TEXT NOT NULL REFERENCES new_ties(id) ON DELETE CASCADE,
  person_id          TEXT REFERENCES people(id) ON DELETE SET NULL,
  role               TEXT NOT NULL
                       CHECK (role IN ('rigger','top','model','bottom','spotter','photographer')),
  difficulty_rating  INTEGER CHECK (difficulty_rating BETWEEN 1 AND 5),
  experience_rating  INTEGER CHECK (experience_rating BETWEEN 1 AND 5),
  notes              TEXT,
  UNIQUE (tie_id, person_id, role)                     -- NULLs don't clash, so deleted people never collide
);

CREATE TABLE new_tie_tags (
  tie_id  TEXT NOT NULL REFERENCES new_ties(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (tie_id, tag_id)
);

-- --- copy rows (parents first) -----------------------------------------------

INSERT INTO new_ties (id, owner_id, title, tie_date, tie_type, location_id, location_deleted,
                      duration_minutes, success_rating, notes, created_at, updated_at)
SELECT id, owner_id, title, tie_date, tie_type, location_id, location_deleted,
       duration_minutes, success_rating, notes, created_at, updated_at
  FROM ties;

INSERT INTO new_tie_plans (id, tie_id, plan_id, plan_version)
SELECT id, tie_id, plan_id, plan_version FROM tie_plans;

INSERT INTO new_tie_participants (id, tie_id, person_id, role, difficulty_rating, experience_rating, notes)
SELECT id, tie_id, person_id, role, difficulty_rating, experience_rating, notes FROM tie_participants;

INSERT INTO new_tie_tags (tie_id, tag_id)
SELECT tie_id, tag_id FROM tie_tags;

-- --- drop old tables (children first, so no cascades fire) -------------------

DROP TABLE tie_tags;
DROP TABLE tie_participants;
DROP TABLE tie_plans;
DROP TABLE ties;

-- --- rename ------------------------------------------------------------------

ALTER TABLE new_ties             RENAME TO ties;
ALTER TABLE new_tie_plans        RENAME TO tie_plans;
ALTER TABLE new_tie_participants RENAME TO tie_participants;
ALTER TABLE new_tie_tags         RENAME TO tie_tags;

-- --- indexes -----------------------------------------------------------------

CREATE INDEX idx_ties_owner_date     ON ties(owner_id, tie_date);
CREATE INDEX idx_tie_plans_tie       ON tie_plans(tie_id);
CREATE INDEX idx_tie_plans_plan      ON tie_plans(plan_id);
CREATE INDEX idx_participants_tie    ON tie_participants(tie_id);
CREATE INDEX idx_participants_person ON tie_participants(person_id);
CREATE INDEX idx_tie_tags_tag        ON tie_tags(tag_id);

-- --- triggers (as in 0002) ---------------------------------------------------

CREATE TRIGGER trg_ties_owner_fixed BEFORE UPDATE OF owner_id ON ties
WHEN NEW.owner_id IS NOT OLD.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: owner_id cannot change'); END;

-- ties: location must share the tie's owner
CREATE TRIGGER trg_ties_location_owner_ins BEFORE INSERT ON ties
WHEN NEW.location_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM locations WHERE id = NEW.location_id AND owner_id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: location'); END;

CREATE TRIGGER trg_ties_location_owner_upd BEFORE UPDATE OF location_id ON ties
WHEN NEW.location_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM locations WHERE id = NEW.location_id AND owner_id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: location'); END;

-- tie_plans: tie and plan share an owner
CREATE TRIGGER trg_tie_plans_owner_ins BEFORE INSERT ON tie_plans
WHEN NEW.plan_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM ties t JOIN plans p ON p.owner_id = t.owner_id
                  WHERE t.id = NEW.tie_id AND p.id = NEW.plan_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: tie plan'); END;

CREATE TRIGGER trg_tie_plans_owner_upd BEFORE UPDATE OF tie_id, plan_id ON tie_plans
WHEN NEW.plan_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM ties t JOIN plans p ON p.owner_id = t.owner_id
                  WHERE t.id = NEW.tie_id AND p.id = NEW.plan_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: tie plan'); END;

-- tie_participants: tie and person share an owner
CREATE TRIGGER trg_participants_owner_ins BEFORE INSERT ON tie_participants
WHEN NEW.person_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM ties t JOIN people pe ON pe.owner_id = t.owner_id
                  WHERE t.id = NEW.tie_id AND pe.id = NEW.person_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: participant'); END;

CREATE TRIGGER trg_participants_owner_upd BEFORE UPDATE OF tie_id, person_id ON tie_participants
WHEN NEW.person_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM ties t JOIN people pe ON pe.owner_id = t.owner_id
                  WHERE t.id = NEW.tie_id AND pe.id = NEW.person_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: participant'); END;

-- tie_tags: tie and tag share an owner
CREATE TRIGGER trg_tie_tags_owner_ins BEFORE INSERT ON tie_tags
WHEN NOT EXISTS (SELECT 1 FROM ties ti JOIN tags t ON t.owner_id = ti.owner_id
                  WHERE ti.id = NEW.tie_id AND t.id = NEW.tag_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: tie tag'); END;

CREATE TRIGGER trg_tie_tags_owner_upd BEFORE UPDATE OF tie_id, tag_id ON tie_tags
WHEN NOT EXISTS (SELECT 1 FROM ties ti JOIN tags t ON t.owner_id = ti.owner_id
                  WHERE ti.id = NEW.tie_id AND t.id = NEW.tag_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: tie tag'); END;

-- Deleting a location keeps its ties, marked "(location deleted)".
CREATE TRIGGER trg_locations_mark_ties_deleted BEFORE DELETE ON locations
BEGIN
  UPDATE ties SET location_id = NULL, location_deleted = 1 WHERE location_id = OLD.id;
END;
