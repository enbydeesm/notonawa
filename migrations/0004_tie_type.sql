-- Rope Journal: what kind of tie it was. Optional, so existing ties stay
-- valid with no type. The same list is in src/ties/parse.js and
-- public/js/ties-view.js.

ALTER TABLE ties ADD COLUMN tie_type TEXT
  CHECK (tie_type IN ('suspension', 'partial suspension', 'floor'));
