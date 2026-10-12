# Instructions for Claude

Instructions, best practices and context for working on the Rope Journal app
(Cloudflare Workers + D1). Design ideas we've weighed, and planned features,
live in [considerations.md](considerations.md).

## Database writes

- **Always check whether a code path should set `updated_at`.** Nothing updates
  it automatically (we chose not to use triggers, to avoid a second write per
  UPDATE; see considerations.md). Any UPDATE to a table with an `updated_at`
  column (people, profile_notes, locations, plans, ties) should normally include
  `updated_at = ${NOW}`.
- **Timestamps are ISO text**, e.g. `2026-10-11T21:51:00Z`. In SQL, use the
  `NOW` constant in `src/index.js` (`strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`),
  never `datetime('now')`, which has no `T`/`Z` and breaks string comparisons.
  Plain dates (`tie_date`, `noted_on`) stay as `YYYY-MM-DD`.

## Queries

- **Always check whether a query on `plans`, `people` or `locations` needs
  `WHERE archived_at IS NULL`.** Archived rows are still in the table.
  Archiving and deleting are separate actions for all three; archiving never
  expires and is undone with the restore route. Exclude archived rows from
  pickers (choosing a plan, participants or a location for a tie) and from
  default lists, but still show them on existing ties and in their own
  history. A one-off location is just one archived when it's added.
- **Scope every query to the signed-in user** with `owner_id = ?` bound to
  `user.id`. Users are keyed by `users.id`, never by email; email is only used
  in `getUser` to look up who's signed in.
- **Show deleted links on ties instead of hiding them:**
  - `tie_participants.person_id` NULL → "(person deleted)"
  - `tie_plans.plan_id` NULL → "(plan deleted)"
  - `ties.location_deleted = 1` → "(location deleted)". Any code that sets a
    tie's `location_id` must also set `location_deleted = 0` (a CHECK enforces it).
- **Deleting a plan needs the user's choice** of `linked_ties=remove` (also drop
  it from ties) or `linked_ties=keep` (ties show "(plan deleted)"). The UI asks
  with a confirmation dialog: remove from linked ties / just delete the plan /
  cancel. The API rejects a delete without the choice.

## Migrations

- Don't edit a migration that's been applied to the remote database; add a new
  one. Check with `npx wrangler d1 migrations list rope-journal --remote`.
- Test migrations on a copy of the local database first
  (`--persist-to <copy of .wrangler/state>`).
