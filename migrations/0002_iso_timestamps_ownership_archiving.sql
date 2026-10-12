-- Rope Journal: ISO timestamps, ownership enforcement, archiving for plans,
-- people and locations, and keeping ties' history when a linked person,
-- location or plan is deleted. Replaces locations.is_one_off with archiving.
--
-- SQLite can't change column defaults or CHECK rules in place, so every table
-- is rebuilt: create new_<table>, copy the rows across, drop the old tables,
-- then rename new_<table> to <table>.
--
-- Old tables are dropped children-first so that dropping a parent never
-- cascades into anything (nothing references it by then). Renaming
-- new_<table> also rewrites the foreign keys in other tables to the final name.
--
-- Timestamps are now written as ISO text: '2026-10-11T21:51:00Z'.

PRAGMA defer_foreign_keys = true;

-- --- new tables --------------------------------------------------------------

CREATE TABLE new_users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE new_people (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES new_users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  pronouns        TEXT,
  notes           TEXT,
  is_self         INTEGER NOT NULL DEFAULT 0,          -- 1 = this profile is the journal owner (max one per owner)
  linked_user_id  TEXT REFERENCES new_users(id) ON DELETE SET NULL,  -- for later, if they join the app
  archived_at     TEXT,                                -- set when archived (hidden from pickers); NULL = active
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE new_profile_notes (
  id           TEXT PRIMARY KEY,
  person_id    TEXT NOT NULL REFERENCES new_people(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('injury','modification','like','dislike','limit')),
  description  TEXT NOT NULL,
  noted_on     TEXT,                                   -- date the note applies from
  is_current   INTEGER NOT NULL DEFAULT 1,             -- 0 = resolved / no longer applies
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE new_locations (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES new_users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  notes        TEXT,
  hard_points  TEXT,                                   -- suspension points, ratings, quirks
  maps_url     TEXT,                                   -- Google Maps pin link
  latitude     REAL,
  longitude    REAL,
  archived_at  TEXT,                                   -- set when archived (hidden from pickers); NULL = active.
                                                       -- A one-off spot is a location archived when it's added.
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE new_tags (
  id        TEXT PRIMARY KEY,
  owner_id  TEXT NOT NULL REFERENCES new_users(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  UNIQUE (owner_id, name)
);

-- Archived (archived_at IS NOT NULL) = hidden from pickers and most views until
-- restored. Separate from stage, so restoring just clears archived_at.
CREATE TABLE new_plans (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES new_users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  stage           TEXT NOT NULL DEFAULT 'idea'
                    CHECK (stage IN ('idea','developing','ready','retired')),
  description     TEXT,
  notes           TEXT,
  est_difficulty  INTEGER CHECK (est_difficulty BETWEEN 1 AND 5),
  variation_of    TEXT REFERENCES new_plans(id) ON DELETE SET NULL,
  version         INTEGER NOT NULL DEFAULT 1,          -- bumps on substantive edits (for future plan history)
  archived_at     TEXT,                                -- set when archived (hidden from pickers); NULL = active
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE new_plan_tags (
  plan_id  TEXT NOT NULL REFERENCES new_plans(id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES new_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_id, tag_id)
);

CREATE TABLE new_ties (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL REFERENCES new_users(id) ON DELETE CASCADE,
  title             TEXT,
  tie_date          TEXT,
  location_id       TEXT REFERENCES new_locations(id) ON DELETE SET NULL,
  location_deleted  INTEGER NOT NULL DEFAULT 0,        -- 1 = had a location that was since deleted ("(location deleted)")
  duration_minutes  INTEGER,
  success_rating    INTEGER CHECK (success_rating BETWEEN 1 AND 5),  -- how it went overall / vs plan
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (location_id IS NULL OR location_deleted = 0)  -- setting a new location must clear the flag
);

-- plan_id becomes NULL when the plan is deleted with "keep on ties"; the UI
-- shows "(plan deleted)". Deleting with "remove from ties" deletes these rows
-- first (in the Worker). Own id for the same reason as tie_participants below.
CREATE TABLE new_tie_plans (
  id            TEXT PRIMARY KEY,
  tie_id        TEXT NOT NULL REFERENCES new_ties(id) ON DELETE CASCADE,
  plan_id       TEXT REFERENCES new_plans(id) ON DELETE SET NULL,
  plan_version  INTEGER NOT NULL,
  UNIQUE (tie_id, plan_id)                             -- NULLs don't clash, so deleted plans never collide
);

-- person_id becomes NULL when the person is deleted; the UI shows "(person deleted)".
-- The row keeps its own id because (tie, person, role) is no longer unique once
-- people are deleted (e.g. two deleted models in the same tie).
CREATE TABLE new_tie_participants (
  id                 TEXT PRIMARY KEY,
  tie_id             TEXT NOT NULL REFERENCES new_ties(id) ON DELETE CASCADE,
  person_id          TEXT REFERENCES new_people(id) ON DELETE SET NULL,
  role               TEXT NOT NULL
                       CHECK (role IN ('rigger','top','model','bottom','spotter','photographer')),
  difficulty_rating  INTEGER CHECK (difficulty_rating BETWEEN 1 AND 5),
  experience_rating  INTEGER CHECK (experience_rating BETWEEN 1 AND 5),
  notes              TEXT,
  UNIQUE (tie_id, person_id, role)                     -- NULLs don't clash, so deleted people never collide
);

CREATE TABLE new_tie_tags (
  tie_id  TEXT NOT NULL REFERENCES new_ties(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES new_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (tie_id, tag_id)
);

-- --- copy rows (parents first), converting timestamps to ISO ------------------

INSERT INTO new_users (id, email, display_name, created_at)
SELECT id, email, display_name,
       COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), created_at)
  FROM users;

INSERT INTO new_people (id, owner_id, name, pronouns, notes, is_self, linked_user_id, created_at, updated_at)
SELECT id, owner_id, name, pronouns, notes, is_self, linked_user_id,
       COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), created_at),
       COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', updated_at), updated_at)
  FROM people;

INSERT INTO new_profile_notes (id, person_id, type, description, noted_on, is_current, created_at, updated_at)
SELECT id, person_id, type, description, noted_on, is_current,
       COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), created_at),
       COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', updated_at), updated_at)
  FROM profile_notes;

-- One-off locations become archived, as of when they were created.
INSERT INTO new_locations (id, owner_id, name, notes, hard_points, maps_url, latitude, longitude, archived_at, created_at, updated_at)
SELECT id, owner_id, name, notes, hard_points, maps_url, latitude, longitude,
       CASE WHEN is_one_off = 1 THEN COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), created_at) END,
       COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), created_at),
       COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', updated_at), updated_at)
  FROM locations;

INSERT INTO new_tags (id, owner_id, name)
SELECT id, owner_id, name FROM tags;

INSERT INTO new_plans (id, owner_id, title, stage, description, notes, est_difficulty, variation_of, version, created_at, updated_at)
SELECT id, owner_id, title, stage, description, notes, est_difficulty, variation_of, version,
       COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), created_at),
       COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', updated_at), updated_at)
  FROM plans;

INSERT INTO new_plan_tags (plan_id, tag_id)
SELECT plan_id, tag_id FROM plan_tags;

INSERT INTO new_ties (id, owner_id, title, tie_date, location_id, duration_minutes, success_rating, notes, created_at, updated_at)
SELECT id, owner_id, title, tie_date, location_id, duration_minutes, success_rating, notes,
       COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), created_at),
       COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', updated_at), updated_at)
  FROM ties;

INSERT INTO new_tie_plans (id, tie_id, plan_id, plan_version)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' ||
             hex(randomblob(2)) || '-' || hex(randomblob(6))),
       tie_id, plan_id, plan_version
  FROM tie_plans;

INSERT INTO new_tie_participants (id, tie_id, person_id, role, difficulty_rating, experience_rating, notes)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' ||
             hex(randomblob(2)) || '-' || hex(randomblob(6))),
       tie_id, person_id, role, difficulty_rating, experience_rating, notes
  FROM tie_participants;

INSERT INTO new_tie_tags (tie_id, tag_id)
SELECT tie_id, tag_id FROM tie_tags;

-- --- drop old tables (children first, so no cascades fire) -------------------

DROP TABLE tie_tags;
DROP TABLE tie_participants;
DROP TABLE tie_plans;
DROP TABLE plan_tags;
DROP TABLE ties;
DROP TABLE plans;
DROP TABLE tags;
DROP TABLE locations;
DROP TABLE profile_notes;
DROP TABLE people;
DROP TABLE users;

-- --- rename new tables into place --------------------------------------------

ALTER TABLE new_users            RENAME TO users;
ALTER TABLE new_people           RENAME TO people;
ALTER TABLE new_profile_notes    RENAME TO profile_notes;
ALTER TABLE new_locations        RENAME TO locations;
ALTER TABLE new_tags             RENAME TO tags;
ALTER TABLE new_plans            RENAME TO plans;
ALTER TABLE new_plan_tags        RENAME TO plan_tags;
ALTER TABLE new_ties             RENAME TO ties;
ALTER TABLE new_tie_plans        RENAME TO tie_plans;
ALTER TABLE new_tie_participants RENAME TO tie_participants;
ALTER TABLE new_tie_tags         RENAME TO tie_tags;

-- --- indexes -----------------------------------------------------------------

CREATE INDEX idx_people_owner        ON people(owner_id);
CREATE INDEX idx_notes_person        ON profile_notes(person_id);
CREATE INDEX idx_locations_owner     ON locations(owner_id);
CREATE INDEX idx_plans_owner         ON plans(owner_id);
CREATE INDEX idx_ties_owner_date     ON ties(owner_id, tie_date);
CREATE INDEX idx_tie_plans_tie       ON tie_plans(tie_id);
CREATE INDEX idx_tie_plans_plan      ON tie_plans(plan_id);
CREATE INDEX idx_participants_tie    ON tie_participants(tie_id);
CREATE INDEX idx_participants_person ON tie_participants(person_id);
CREATE INDEX idx_plan_tags_tag       ON plan_tags(tag_id);
CREATE INDEX idx_tie_tags_tag        ON tie_tags(tag_id);

-- At most one "self" profile per journal owner
CREATE UNIQUE INDEX idx_people_one_self ON people(owner_id) WHERE is_self = 1;

-- --- ownership enforcement ---------------------------------------------------
-- Anything linked together must belong to the same journal owner.
-- Errors start with 'ownership mismatch' so the Worker can recognise them.

-- owner_id never changes once a row exists, so the link checks below only
-- need to run when the linking columns change.
CREATE TRIGGER trg_people_owner_fixed BEFORE UPDATE OF owner_id ON people
WHEN NEW.owner_id IS NOT OLD.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: owner_id cannot change'); END;

CREATE TRIGGER trg_locations_owner_fixed BEFORE UPDATE OF owner_id ON locations
WHEN NEW.owner_id IS NOT OLD.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: owner_id cannot change'); END;

CREATE TRIGGER trg_tags_owner_fixed BEFORE UPDATE OF owner_id ON tags
WHEN NEW.owner_id IS NOT OLD.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: owner_id cannot change'); END;

CREATE TRIGGER trg_plans_owner_fixed BEFORE UPDATE OF owner_id ON plans
WHEN NEW.owner_id IS NOT OLD.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: owner_id cannot change'); END;

CREATE TRIGGER trg_ties_owner_fixed BEFORE UPDATE OF owner_id ON ties
WHEN NEW.owner_id IS NOT OLD.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: owner_id cannot change'); END;

-- ties.location_id -> locations
CREATE TRIGGER trg_ties_location_owner_ins BEFORE INSERT ON ties
WHEN NEW.location_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM locations WHERE id = NEW.location_id AND owner_id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: location'); END;

CREATE TRIGGER trg_ties_location_owner_upd BEFORE UPDATE OF location_id ON ties
WHEN NEW.location_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM locations WHERE id = NEW.location_id AND owner_id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: location'); END;

-- plans.variation_of -> plans
CREATE TRIGGER trg_plans_variation_owner_ins BEFORE INSERT ON plans
WHEN NEW.variation_of IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM plans WHERE id = NEW.variation_of AND owner_id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: variation_of'); END;

CREATE TRIGGER trg_plans_variation_owner_upd BEFORE UPDATE OF variation_of ON plans
WHEN NEW.variation_of IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM plans WHERE id = NEW.variation_of AND owner_id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: variation_of'); END;

-- plan_tags: plan and tag share an owner
CREATE TRIGGER trg_plan_tags_owner_ins BEFORE INSERT ON plan_tags
WHEN NOT EXISTS (SELECT 1 FROM plans p JOIN tags t ON t.owner_id = p.owner_id
                  WHERE p.id = NEW.plan_id AND t.id = NEW.tag_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: plan tag'); END;

CREATE TRIGGER trg_plan_tags_owner_upd BEFORE UPDATE OF plan_id, tag_id ON plan_tags
WHEN NOT EXISTS (SELECT 1 FROM plans p JOIN tags t ON t.owner_id = p.owner_id
                  WHERE p.id = NEW.plan_id AND t.id = NEW.tag_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: plan tag'); END;

-- tie_plans: tie and plan share an owner (deleted plans are NULL)
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

-- tie_participants: tie and person share an owner (deleted people are NULL)
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

-- --- deleted locations -------------------------------------------------------
-- Before a location is deleted, mark its ties so they can show
-- "(location deleted)" instead of looking like they never had one.
-- (Clearing location_id here too keeps the CHECK on ties satisfied.)
CREATE TRIGGER trg_locations_mark_ties_deleted BEFORE DELETE ON locations
BEGIN
  UPDATE ties SET location_id = NULL, location_deleted = 1 WHERE location_id = OLD.id;
END;
