-- NotoNawa: educators, where people are based, and their social and scene
-- names.
--
-- people.is_educator: 1 when they teach (the People form's "Educator"). For
-- the workshops' educators list, once workshops are built.
--
-- people.based_in: where they're based ("Seattle, WA"). Encrypted in the
-- browser, like notes.
--
-- people.aliases: their scene names and social handles, as one encrypted
-- field: a JSON list of { platform, alias } (public/js/aliases.js), sealed
-- whole, so the server can't read the names or even which platforms they're
-- on. It never needs to: people are searched on the device.
--
-- Only new columns: no table is rebuilt.

ALTER TABLE people ADD COLUMN is_educator INTEGER NOT NULL DEFAULT 0 CHECK (is_educator IN (0, 1));
ALTER TABLE people ADD COLUMN based_in TEXT;
ALTER TABLE people ADD COLUMN aliases TEXT;
