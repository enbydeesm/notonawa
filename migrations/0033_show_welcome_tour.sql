-- NotoNawa: show everyone the new welcome tour once.
--
-- users.hide_welcome (migration 0015) was the old welcome's "Don't show
-- this again". The welcome tour (public/js/tour.js) replaces that welcome
-- and keeps the same setting: it's shown after unlocking until finished or
-- skipped, which sets it. Setting it back to 0 for every account shows the
-- tour once to those who had hidden the welcome too.
--
-- Data only: no table or column changes.

UPDATE users SET hide_welcome = 0;
