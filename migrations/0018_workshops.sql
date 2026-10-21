-- NotoNawa: workshops, for the education tracker (the Education view).
--
-- workshops: one workshop I went to or taught. start_date is required,
-- end_date is for one lasting more than a day (never before the start).
-- attendee_count: how many came, typed in (not counted from its people).
-- description, notes and album_url are sealed in the browser, like a
-- tie's notes (src/encryption/config.js). A deleted location leaves
-- location_deleted = 1, as on ties.
--
-- workshop_people: its educators and participants (kind), each with a
-- role, as on ties. A person is on a workshop once, so never both an
-- educator and a participant. person_id is NULL once the person is deleted
-- ("(person deleted)"). Whether I taught it is whether my "this is me"
-- profile is one of its educators: nothing stores it.
--
-- workshop_tags: the same tags as ties and plans.
--
-- media gets workshop_id: photos and videos on workshops too. SQLite can't
-- change a CHECK, so media is rebuilt (as in 0013): nothing links to it, so
-- it's copied, dropped and renamed, and its indexes and triggers made again.
--
-- Each trigger's BEGIN … END stays on one line: the test setup splits
-- statements at a ";" that ends a line.

PRAGMA defer_foreign_keys = true;

CREATE TABLE workshops (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  start_date        TEXT NOT NULL,                     -- YYYY-MM-DD
  end_date          TEXT,                              -- YYYY-MM-DD; NULL: one day
  location_id       TEXT REFERENCES locations(id) ON DELETE SET NULL,
  location_deleted  INTEGER NOT NULL DEFAULT 0 CHECK (location_deleted IN (0, 1)),
  attendee_count    INTEGER CHECK (attendee_count BETWEEN 0 AND 100000),
  rating            INTEGER CHECK (rating BETWEEN 1 AND 5),
  description       TEXT,
  notes             TEXT,
  album_url         TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (location_id IS NULL OR location_deleted = 0)  -- setting a new location must clear the flag
);

CREATE TABLE workshop_people (
  id           TEXT PRIMARY KEY,
  workshop_id  TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  person_id    TEXT REFERENCES people(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('educator', 'participant')),
  role         TEXT NOT NULL CHECK (role IN ('top', 'bottom', 'self tie', 'spotter', 'photographer')),
  UNIQUE (workshop_id, person_id)                      -- NULLs don't clash, so deleted people never collide
);

CREATE TABLE workshop_tags (
  workshop_id  TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  tag_id       TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (workshop_id, tag_id)
);

CREATE INDEX idx_workshops_owner_date  ON workshops(owner_id, start_date);
CREATE INDEX idx_workshop_people_ws    ON workshop_people(workshop_id);
CREATE INDEX idx_workshop_people_person ON workshop_people(person_id);
CREATE INDEX idx_workshop_tags_tag     ON workshop_tags(tag_id);

-- --- ownership -------------------------------------------------------------------

CREATE TRIGGER trg_workshops_owner_fixed BEFORE UPDATE OF owner_id ON workshops
WHEN NEW.owner_id IS NOT OLD.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: owner_id cannot change'); END;

CREATE TRIGGER trg_workshops_location_owner_ins BEFORE INSERT ON workshops
WHEN NEW.location_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM locations WHERE id = NEW.location_id AND owner_id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: location'); END;

CREATE TRIGGER trg_workshops_location_owner_upd BEFORE UPDATE OF location_id ON workshops
WHEN NEW.location_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM locations WHERE id = NEW.location_id AND owner_id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: location'); END;

CREATE TRIGGER trg_workshop_people_owner_ins BEFORE INSERT ON workshop_people
WHEN NEW.person_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM workshops w JOIN people pe ON pe.owner_id = w.owner_id
                  WHERE w.id = NEW.workshop_id AND pe.id = NEW.person_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: workshop person'); END;

CREATE TRIGGER trg_workshop_people_owner_upd BEFORE UPDATE OF workshop_id, person_id ON workshop_people
WHEN NEW.person_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM workshops w JOIN people pe ON pe.owner_id = w.owner_id
                  WHERE w.id = NEW.workshop_id AND pe.id = NEW.person_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: workshop person'); END;

CREATE TRIGGER trg_workshop_tags_owner_ins BEFORE INSERT ON workshop_tags
WHEN NOT EXISTS (SELECT 1 FROM workshops w JOIN tags t ON t.owner_id = w.owner_id
                  WHERE w.id = NEW.workshop_id AND t.id = NEW.tag_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: workshop tag'); END;

CREATE TRIGGER trg_workshop_tags_owner_upd BEFORE UPDATE OF workshop_id, tag_id ON workshop_tags
WHEN NOT EXISTS (SELECT 1 FROM workshops w JOIN tags t ON t.owner_id = w.owner_id
                  WHERE w.id = NEW.workshop_id AND t.id = NEW.tag_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: workshop tag'); END;

-- Before a location is deleted, mark its workshops "(location deleted)", as
-- trg_locations_mark_ties_deleted does for ties.
CREATE TRIGGER trg_locations_mark_workshops_deleted BEFORE DELETE ON locations
BEGIN UPDATE workshops SET location_id = NULL, location_deleted = 1 WHERE location_id = OLD.id; END;

-- --- media, rebuilt with workshop_id ------------------------------------------------

CREATE TABLE new_media (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tie_id       TEXT REFERENCES ties(id) ON DELETE CASCADE,
  plan_id      TEXT REFERENCES plans(id) ON DELETE CASCADE,
  workshop_id  TEXT REFERENCES workshops(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('photo', 'video')),
  mime         TEXT NOT NULL,
  caption      TEXT,
  position     INTEGER NOT NULL,
  thumb_bytes  INTEGER NOT NULL,
  bytes        INTEGER NOT NULL,   -- the whole object, thumbnail included
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- On exactly one tie, plan or workshop.
  CHECK ((tie_id IS NOT NULL) + (plan_id IS NOT NULL) + (workshop_id IS NOT NULL) = 1),
  CHECK (thumb_bytes > 0 AND thumb_bytes < bytes)
);

INSERT INTO new_media (id, owner_id, tie_id, plan_id, kind, mime, caption, position, thumb_bytes, bytes, created_at)
SELECT id, owner_id, tie_id, plan_id, kind, mime, caption, position, thumb_bytes, bytes, created_at FROM media;

DROP TABLE media;
ALTER TABLE new_media RENAME TO media;

CREATE INDEX idx_media_owner    ON media(owner_id);
CREATE INDEX idx_media_tie      ON media(tie_id, position) WHERE tie_id IS NOT NULL;
CREATE INDEX idx_media_plan     ON media(plan_id, position) WHERE plan_id IS NOT NULL;
CREATE INDEX idx_media_workshop ON media(workshop_id, position) WHERE workshop_id IS NOT NULL;

-- A photo must be on one of its owner's own ties, plans or workshops.
CREATE TRIGGER trg_media_tie_owner BEFORE INSERT ON media
WHEN NEW.tie_id IS NOT NULL
  AND (SELECT owner_id FROM ties WHERE id = NEW.tie_id) IS NOT NEW.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: media tie'); END;

CREATE TRIGGER trg_media_plan_owner BEFORE INSERT ON media
WHEN NEW.plan_id IS NOT NULL
  AND (SELECT owner_id FROM plans WHERE id = NEW.plan_id) IS NOT NEW.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: media plan'); END;

CREATE TRIGGER trg_media_workshop_owner BEFORE INSERT ON media
WHEN NEW.workshop_id IS NOT NULL
  AND (SELECT owner_id FROM workshops WHERE id = NEW.workshop_id) IS NOT NEW.owner_id
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: media workshop'); END;

-- A photo never moves to another owner or item (its R2 key holds the
-- owner); only its caption and position change.
CREATE TRIGGER trg_media_fixed BEFORE UPDATE OF id, owner_id, tie_id, plan_id, workshop_id ON media
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: media cannot move'); END;
