-- NotoNawa: photos and videos in shares (see considerations.md, "Photos
-- and videos in shares as built").
--
-- A share with photos is saved in steps: its row and snapshot, then each
-- photo or video (sealed with the link's key, in R2 beside the snapshot,
-- "<owner id>/shares/<share id>/<file id>"), then marked ready. Until then
-- nobody can open it, so no one gets half of it.
--
-- shares.files: how many photo and video files it has (0: none, as every
--   share made before this). A share with files is kept an hour after it
--   ends (used up or expired), only so whoever opened it can still fetch
--   them; nobody can open it again in that hour.
-- shares.ready: 0 while its files are being uploaded. One that never
--   becomes ready is deleted by the daily clean-up after a day.
--
-- Only new columns: nothing is rebuilt.

ALTER TABLE shares ADD COLUMN files INTEGER NOT NULL DEFAULT 0 CHECK (files >= 0);
ALTER TABLE shares ADD COLUMN ready INTEGER NOT NULL DEFAULT 1 CHECK (ready IN (0, 1));
