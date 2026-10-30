-- NotoNawa: the poser's default body shape, an account setting.
--
-- users.default_shape: the body new poses start with, as JSON
-- [gender, muscle, weight, height] (public/js/figure-body.js), saved with
-- the poser's "Save as default". NULL until then: new poses start with the
-- in-between body. src/account/settings.js checks it; the CHECK only
-- keeps it valid JSON.
--
-- Only a new column: no table is rebuilt.

ALTER TABLE users ADD COLUMN default_shape TEXT CHECK (default_shape IS NULL OR json_valid(default_shape));
