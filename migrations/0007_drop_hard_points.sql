-- Rope Journal: locations no longer have hard points. Anything worth noting
-- about a place goes in its notes. No live or local location had hard points
-- when this was written, so nothing is moved across.

ALTER TABLE locations DROP COLUMN hard_points;
