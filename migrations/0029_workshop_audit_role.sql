-- NotoNawa: "audit" as a role on workshops.
--
-- Someone can audit a workshop (sit in and watch) as an educator or a
-- participant. It's a workshop's role only: ties and people's default
-- roles keep the five they have (src/ties/parse.js, WORKSHOP_ROLES).
--
-- SQLite can't change a CHECK, so workshop_people is rebuilt (as media was
-- in 0018): nothing links to it, so it's copied, dropped and renamed, and
-- its indexes and triggers made again, the same as 0018's.
--
-- Each trigger's BEGIN … END stays on one line: the test setup splits
-- statements at a ";" that ends a line.

PRAGMA defer_foreign_keys = true;

CREATE TABLE new_workshop_people (
  id           TEXT PRIMARY KEY,
  workshop_id  TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  person_id    TEXT REFERENCES people(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('educator', 'participant')),
  role         TEXT NOT NULL CHECK (role IN ('top', 'bottom', 'self tie', 'spotter', 'photographer', 'audit')),
  UNIQUE (workshop_id, person_id)                      -- NULLs don't clash, so deleted people never collide
);

INSERT INTO new_workshop_people (id, workshop_id, person_id, kind, role)
SELECT id, workshop_id, person_id, kind, role FROM workshop_people;

DROP TABLE workshop_people;
ALTER TABLE new_workshop_people RENAME TO workshop_people;

CREATE INDEX idx_workshop_people_ws     ON workshop_people(workshop_id);
CREATE INDEX idx_workshop_people_person ON workshop_people(person_id);

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
