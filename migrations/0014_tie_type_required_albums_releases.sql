-- NotoNawa: every tie has a type, plans get a tie type, ties and plans get an
-- album link, and each account remembers the last release notes it was shown.
--
-- Tie type required: ties without one become 'hashira'. Making the column
-- NOT NULL would mean rebuilding ties and every table that links to it (as
-- 0013 did), so two triggers refuse a tie without a type instead. The API
-- and imports refuse one first, with a friendlier message.
--
-- plans.tie_type: optional, one of the ties' types.
--
-- album_url (ties and plans): a link to a photo album, sealed in the browser
-- like notes (src/encryption/config.js), so the server never reads it.
--
-- users.seen_release: the app version whose release notes this account last
-- saw (public/js/releases.js). NULL until the page first saves one; new
-- accounts start on the current version (src/auth/db.js).
--
-- Only new columns and triggers: no table is rebuilt. (Each trigger's
-- BEGIN … END stays on one line, as in the earlier migrations: the test
-- setup splits statements at a ";" that ends a line.)

UPDATE ties SET tie_type = 'hashira' WHERE tie_type IS NULL;

CREATE TRIGGER trg_ties_type_required_ins BEFORE INSERT ON ties
WHEN NEW.tie_type IS NULL
BEGIN SELECT RAISE(ABORT, 'tie type required'); END;

CREATE TRIGGER trg_ties_type_required_upd BEFORE UPDATE OF tie_type ON ties
WHEN NEW.tie_type IS NULL
BEGIN SELECT RAISE(ABORT, 'tie type required'); END;

ALTER TABLE plans ADD COLUMN tie_type TEXT CHECK (tie_type IN ('suspension', 'partial suspension', 'floor', 'hashira'));

ALTER TABLE ties ADD COLUMN album_url TEXT;
ALTER TABLE plans ADD COLUMN album_url TEXT;

ALTER TABLE users ADD COLUMN seen_release TEXT;
