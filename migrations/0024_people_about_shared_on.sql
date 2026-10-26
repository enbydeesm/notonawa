-- NotoNawa: when someone's About on my card was last shared by them.
--
-- people.about_shared_on: the date (YYYY-MM-DD) I last added a profile
-- invite of theirs that had an About in it (views/open.js), shown as
-- "Shared by them on …" under About them. A later invite without an About
-- leaves both as they were. Plain, like other dates: the server sees the
-- save itself anyway. NULL when it never came from an invite.
--
-- Only a new column: nothing is rebuilt.

ALTER TABLE people ADD COLUMN about_shared_on TEXT;
