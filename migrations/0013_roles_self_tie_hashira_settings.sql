-- NotoNawa: one role for each side of a tie, a self tie role, the hashira
-- tie type, and two account settings (role names and light/dark mode).
--
-- Roles: rigger and top are now just "top", model and bottom just "bottom";
-- the words shown for them are each account's choice (users.top_label and
-- bottom_label, empty for "top" and "bottom"). "self tie" is a new role.
-- So the roles are top, bottom, self tie, spotter and photographer, on ties
-- and as a person's default role.
--
-- Every account's data is converted: rigger -> top and model -> bottom, on
-- tie participants and people's default roles. An account that only ever
-- used "rigger" (never "top") gets "rigger" as its name for top, so what it
-- sees doesn't change; the same for "model" and bottom.
--
-- If someone was on one tie as both rigger and top (or model and bottom),
-- the two rows become one: the one already called top (or bottom) is kept,
-- else the first by id, with its ratings and notes. To see how many rows
-- that affects before applying, run:
--   SELECT COUNT(*) FROM tie_participants a JOIN tie_participants b
--     ON a.tie_id = b.tie_id AND a.person_id = b.person_id
--    AND ((a.role = 'rigger' AND b.role = 'top') OR (a.role = 'model' AND b.role = 'bottom'));
--
-- users.theme: 'light' or 'dark', the same on every device. New accounts get
-- 'dark' (src/auth/db.js); existing ones stay NULL until the page saves the
-- mode it's showing.
--
-- SQLite can't change a CHECK, so the tables with one (ties: tie_type;
-- tie_participants and people: role) are rebuilt, as in 0006: create
-- new_<table>, copy the rows, drop the old tables, rename. Every table that
-- links to one of them (tie_plans, tie_tags, media, profile_notes) is
-- rebuilt too and dropped first, so dropping a parent never cascades into
-- its rows. Their triggers and indexes go with the old tables and are made
-- again below. The trigger on locations that names ties is dropped first
-- and made again at the end (a rename fails while a trigger names a table
-- that's gone).

PRAGMA defer_foreign_keys = true;

DROP TRIGGER trg_locations_mark_ties_deleted;

-- --- account settings ----------------------------------------------------------

ALTER TABLE users ADD COLUMN top_label TEXT CHECK (length(top_label) BETWEEN 1 AND 24);
ALTER TABLE users ADD COLUMN bottom_label TEXT CHECK (length(bottom_label) BETWEEN 1 AND 24);
ALTER TABLE users ADD COLUMN theme TEXT CHECK (theme IN ('light', 'dark'));

-- Keep the word an account has been using, before the roles are converted.
UPDATE users SET top_label = 'rigger'
 WHERE EXISTS (SELECT 1 FROM tie_participants tp JOIN ties t ON t.id = tp.tie_id
                WHERE t.owner_id = users.id AND tp.role = 'rigger'
               UNION ALL
               SELECT 1 FROM people p WHERE p.owner_id = users.id AND p.default_role = 'rigger')
   AND NOT EXISTS (SELECT 1 FROM tie_participants tp JOIN ties t ON t.id = tp.tie_id
                    WHERE t.owner_id = users.id AND tp.role = 'top'
                   UNION ALL
                   SELECT 1 FROM people p WHERE p.owner_id = users.id AND p.default_role = 'top');

UPDATE users SET bottom_label = 'model'
 WHERE EXISTS (SELECT 1 FROM tie_participants tp JOIN ties t ON t.id = tp.tie_id
                WHERE t.owner_id = users.id AND tp.role = 'model'
               UNION ALL
               SELECT 1 FROM people p WHERE p.owner_id = users.id AND p.default_role = 'model')
   AND NOT EXISTS (SELECT 1 FROM tie_participants tp JOIN ties t ON t.id = tp.tie_id
                    WHERE t.owner_id = users.id AND tp.role = 'bottom'
                   UNION ALL
                   SELECT 1 FROM people p WHERE p.owner_id = users.id AND p.default_role = 'bottom');

-- --- new tables ------------------------------------------------------------------

CREATE TABLE new_people (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  pronouns        TEXT,
  notes           TEXT,
  is_self         INTEGER NOT NULL DEFAULT 0,          -- 1 = this profile is the journal owner (max one per owner)
  linked_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,  -- for later, if they join the app
  archived_at     TEXT,                                -- set when archived (hidden from pickers); NULL = active
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  default_role    TEXT CHECK (default_role IN ('top', 'bottom', 'self tie', 'spotter', 'photographer'))
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

CREATE TABLE new_ties (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT,
  tie_date          TEXT NOT NULL,                     -- YYYY-MM-DD
  tie_type          TEXT CHECK (tie_type IN ('suspension', 'partial suspension', 'floor', 'hashira')),
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
  person_id          TEXT REFERENCES new_people(id) ON DELETE SET NULL,
  role               TEXT NOT NULL
                       CHECK (role IN ('top', 'bottom', 'self tie', 'spotter', 'photographer')),
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

CREATE TABLE new_media (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tie_id       TEXT REFERENCES new_ties(id) ON DELETE CASCADE,
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

-- --- copy rows (parents first) ---------------------------------------------------

INSERT INTO new_people (id, owner_id, name, pronouns, notes, is_self, linked_user_id, archived_at,
                        created_at, updated_at, default_role)
SELECT id, owner_id, name, pronouns, notes, is_self, linked_user_id, archived_at, created_at, updated_at,
       CASE default_role WHEN 'rigger' THEN 'top' WHEN 'model' THEN 'bottom' ELSE default_role END
  FROM people;

INSERT INTO new_profile_notes (id, person_id, type, description, noted_on, is_current, created_at, updated_at)
SELECT id, person_id, type, description, noted_on, is_current, created_at, updated_at FROM profile_notes;

INSERT INTO new_ties (id, owner_id, title, tie_date, tie_type, location_id, location_deleted,
                      duration_minutes, success_rating, notes, created_at, updated_at)
SELECT id, owner_id, title, tie_date, tie_type, location_id, location_deleted,
       duration_minutes, success_rating, notes, created_at, updated_at
  FROM ties;

INSERT INTO new_tie_plans (id, tie_id, plan_id, plan_version)
SELECT id, tie_id, plan_id, plan_version FROM tie_plans;

-- One row per tie, person and converted role (see the top). A deleted
-- person (person_id NULL) never merges: each row stands for itself.
INSERT INTO new_tie_participants (id, tie_id, person_id, role, difficulty_rating, experience_rating, notes)
SELECT id, tie_id, person_id, new_role, difficulty_rating, experience_rating, notes
  FROM (SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY tie_id, COALESCE(person_id, id), new_role
                    ORDER BY role = new_role DESC, id) AS n
          FROM (SELECT *, CASE role WHEN 'rigger' THEN 'top' WHEN 'model' THEN 'bottom' ELSE role END AS new_role
                  FROM tie_participants))
 WHERE n = 1;

INSERT INTO new_tie_tags (tie_id, tag_id)
SELECT tie_id, tag_id FROM tie_tags;

INSERT INTO new_media (id, owner_id, tie_id, plan_id, kind, mime, caption, position, thumb_bytes, bytes, created_at)
SELECT id, owner_id, tie_id, plan_id, kind, mime, caption, position, thumb_bytes, bytes, created_at FROM media;

-- --- drop old tables (children first, so no cascades fire) -----------------------

DROP TABLE media;
DROP TABLE tie_tags;
DROP TABLE tie_participants;
DROP TABLE tie_plans;
DROP TABLE profile_notes;
DROP TABLE ties;
DROP TABLE people;

-- --- rename ------------------------------------------------------------------------

ALTER TABLE new_people           RENAME TO people;
ALTER TABLE new_profile_notes    RENAME TO profile_notes;
ALTER TABLE new_ties             RENAME TO ties;
ALTER TABLE new_tie_plans        RENAME TO tie_plans;
ALTER TABLE new_tie_participants RENAME TO tie_participants;
ALTER TABLE new_tie_tags         RENAME TO tie_tags;
ALTER TABLE new_media            RENAME TO media;

-- --- indexes -----------------------------------------------------------------------

CREATE INDEX idx_people_owner        ON people(owner_id);
CREATE UNIQUE INDEX idx_people_one_self ON people(owner_id) WHERE is_self = 1;
CREATE INDEX idx_notes_person        ON profile_notes(person_id);
CREATE INDEX idx_ties_owner_date     ON ties(owner_id, tie_date);
CREATE INDEX idx_tie_plans_tie       ON tie_plans(tie_id);
CREATE INDEX idx_tie_plans_plan      ON tie_plans(plan_id);
CREATE INDEX idx_participants_tie    ON tie_participants(tie_id);
CREATE INDEX idx_participants_person ON tie_participants(person_id);
CREATE INDEX idx_tie_tags_tag        ON tie_tags(tag_id);
CREATE INDEX idx_media_owner         ON media(owner_id);
CREATE INDEX idx_media_tie           ON media(tie_id, position) WHERE tie_id IS NOT NULL;
CREATE INDEX idx_media_plan          ON media(plan_id, position) WHERE plan_id IS NOT NULL;

-- --- triggers (as before) ------------------------------------------------------------

CREATE TRIGGER trg_people_owner_fixed BEFORE UPDATE OF owner_id ON people
WHEN NEW.owner_id IS NOT OLD.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: owner_id cannot change'); END;

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

-- media: owned by the tie's or plan's owner, and never moved
CREATE TRIGGER trg_media_tie_owner BEFORE INSERT ON media
WHEN NEW.tie_id IS NOT NULL
  AND (SELECT owner_id FROM ties WHERE id = NEW.tie_id) IS NOT NEW.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: media tie'); END;

CREATE TRIGGER trg_media_plan_owner BEFORE INSERT ON media
WHEN NEW.plan_id IS NOT NULL
  AND (SELECT owner_id FROM plans WHERE id = NEW.plan_id) IS NOT NEW.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: media plan'); END;

CREATE TRIGGER trg_media_fixed BEFORE UPDATE OF id, owner_id, tie_id, plan_id ON media
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: media cannot move'); END;

-- Deleting a location keeps its ties, marked "(location deleted)".
CREATE TRIGGER trg_locations_mark_ties_deleted BEFORE DELETE ON locations
BEGIN
  UPDATE ties SET location_id = NULL, location_deleted = 1 WHERE location_id = OLD.id;
END;
