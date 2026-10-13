# Considerations

Design ideas we've weighed, planned features, and the reasons behind them, so
we can revisit them later.

## Planned: "Archive now" when adding a location

**Status:** planned (2026-10-12)

We dropped `locations.is_one_off`: a one-off spot is just a location that's
archived straight away. The "Add location" screen should have an "Archive now"
option that sets `archived_at` when the location is created (in the same
INSERT, `archived_at = ${NOW}`), so it's saved for the tie's record but never
clutters the location picker. Existing one-off locations were migrated to
archived as of their creation date.

## Updating `updated_at` automatically with triggers

**Status:** not adopted (2026-10-12)

**Problem:** `updated_at` only changes when each UPDATE remembers to set it. If
a code path forgets, nothing errors; the value just goes stale, which breaks
"recently edited" sorting and anything that relies on it for syncing or caching.

**Idea:** an AFTER UPDATE trigger on each table with `updated_at` (people,
profile_notes, locations, plans, ties):

```sql
CREATE TRIGGER trg_plans_touch AFTER UPDATE ON plans
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE plans SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
END;
```

The `WHEN` clause stops it looping and lets code set its own value when needed.

**Why not (yet):**
- Every UPDATE writes the row twice. D1 bills rows written at roughly 1,000×
  rows read, and all writes go through the single primary database.
- Some automatic changes would count as edits, e.g. deleting a location empties
  `ties.location_id` and would bump the tie's `updated_at`.

**Instead:** code sets `updated_at` explicitly, and CLAUDE.md has a rule
to check for it on every write path.

**Revisit if:** stale `updated_at` values start causing bugs, or something
(like sync) comes to depend on it being exact.
