-- Rope Journal: a plan's type, and a default location for new ties.
--
-- plan_type replaces stage on the Plans form (stage stays, unused by the
-- form for now: new plans still get 'idea', and edits leave it alone).
-- Every existing plan starts as an idea. The same list is in
-- src/resources/config.js and public/js/views/plans.js.
--
-- is_default marks the location the tie form fills in for a new tie. At
-- most one per journal (the index below); the app moves it in one batch
-- and clears it when the location is archived.

ALTER TABLE plans ADD COLUMN plan_type TEXT NOT NULL DEFAULT 'idea'
  CHECK (plan_type IN ('idea', 'harness', 'sequence'));

ALTER TABLE locations ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0
  CHECK (is_default IN (0, 1));

CREATE UNIQUE INDEX idx_locations_one_default ON locations(owner_id) WHERE is_default = 1;
