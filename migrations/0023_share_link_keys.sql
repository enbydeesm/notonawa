-- NotoNawa: a share's link key, kept so its owner can show the code again.
--
-- shares.link_key: the key from the share's link (crypto/share.js), sealed
-- in the browser with the owner's data key, like a share's label. Only the
-- owner's devices can open it, and only the owner's list (GET /api/shares)
-- returns it; we can't read it, so we still can't open the share. Not in
-- the export: it opens the share, so it stays with the account (as key
-- wraps do). NULL for shares made before this.
--
-- Only a new column: nothing is rebuilt.

ALTER TABLE shares ADD COLUMN link_key TEXT;
