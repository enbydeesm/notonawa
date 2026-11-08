-- NotoNawa: workshop updates.
--
-- More ratings on a workshop: its difficulty (as a plan's est_difficulty)
-- and, under the form's "More ratings", content, teaching and value. All
-- 1-5 and optional, like rating.
--
-- cost: what was paid (or, on one I taught, earned), encrypted on the
-- device like the notes: the amount and its currency sealed together
-- (public/js/currency.js), so the server never sees either. Whether it's
-- spend or earnings isn't stored: it's whether my "this is me" profile is
-- one of the educators, worked out on the device.
--
-- Ties and plans can each be linked to one workshop (workshop_id).
-- Deleting the workshop just unlinks them (ON DELETE SET NULL). Triggers
-- keep the link within one account, as for every other link.

ALTER TABLE workshops ADD COLUMN difficulty INTEGER CHECK (difficulty BETWEEN 1 AND 5);
ALTER TABLE workshops ADD COLUMN rating_content INTEGER CHECK (rating_content BETWEEN 1 AND 5);
ALTER TABLE workshops ADD COLUMN rating_teaching INTEGER CHECK (rating_teaching BETWEEN 1 AND 5);
ALTER TABLE workshops ADD COLUMN rating_value INTEGER CHECK (rating_value BETWEEN 1 AND 5);
ALTER TABLE workshops ADD COLUMN cost TEXT;

ALTER TABLE ties ADD COLUMN workshop_id TEXT REFERENCES workshops(id) ON DELETE SET NULL;
ALTER TABLE plans ADD COLUMN workshop_id TEXT REFERENCES workshops(id) ON DELETE SET NULL;
CREATE INDEX idx_ties_workshop ON ties(workshop_id) WHERE workshop_id IS NOT NULL;
CREATE INDEX idx_plans_workshop ON plans(workshop_id) WHERE workshop_id IS NOT NULL;

CREATE TRIGGER trg_ties_workshop_owner_ins BEFORE INSERT ON ties
WHEN NEW.workshop_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM workshops WHERE id = NEW.workshop_id AND owner_id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: workshop'); END;

CREATE TRIGGER trg_ties_workshop_owner_upd BEFORE UPDATE OF workshop_id ON ties
WHEN NEW.workshop_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM workshops WHERE id = NEW.workshop_id AND owner_id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: workshop'); END;

CREATE TRIGGER trg_plans_workshop_owner_ins BEFORE INSERT ON plans
WHEN NEW.workshop_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM workshops WHERE id = NEW.workshop_id AND owner_id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: workshop'); END;

CREATE TRIGGER trg_plans_workshop_owner_upd BEFORE UPDATE OF workshop_id ON plans
WHEN NEW.workshop_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM workshops WHERE id = NEW.workshop_id AND owner_id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: workshop'); END;
