# Rope Journal: instructions for Claude

A private rope journal: plan ties, log what happened, and keep notes on the
people and places involved. Design ideas we've weighed, and planned features,
live in [considerations.md](considerations.md).

## AI behavior rules

- **Propose the structural plan and file changes BEFORE writing the code.**
  Wait for approval, then build.
- **Ask for permission before installing any package.**
- **Keep modules small and easily testable.** Keep pure logic (parsing,
  validation, shaping data) separate from I/O (HTTP, D1, the DOM) so it can be
  tested on its own.
- **Lint, type check and test with every change**: run `npm run check` after
  each change, plus `npm run test:ui` when pages change, and report the results
  faithfully, failures included. New behavior gets new tests; a bug fix gets a
  test that would have caught it.
- **Don't commit, deploy, or apply remote migrations unless asked.** The user
  does those. Local database work is fine. Back up `.wrangler/state` first if
  it could lose data. Database backups/exports go in `backups/` (git-ignored:
  they contain journal data).
- **Never edit a migration that's been applied to the remote database**; add a
  new one. Check with `npx wrangler d1 migrations list rope-journal --remote`.
  Test every migration on a copy of the local database first
  (`--persist-to <copy of .wrangler/state>`), seeded with linked data.
- **Record design decisions** that we weigh but don't adopt, and planned
  features, in considerations.md with the reasons.
- **When the user's request won't work as stated** (e.g. it conflicts with a
  database constraint), say so, explain why, and propose the closest working
  alternative instead of silently changing it.

## Architecture rules

### Core stack

- **Cloudflare Workers** for the API (`src/`) and static pages (`public/`,
  served through the `ASSETS` binding). Anything under `/api/` goes to the
  Worker; everything else is a static file.
- **D1** (SQLite) database `rope-journal`, binding `DB`. Schema changes only via
  numbered files in `migrations/`.
- **Cloudflare Access** for sign-in. The Worker verifies the
  `Cf-Access-Jwt-Assertion` token (`src/auth.js`); `DEV_USER_EMAIL` in
  `.dev.vars` is used on localhost only.
- **Plain JavaScript ES modules, no framework, no build step.** Wrangler bundles
  the Worker; each page loads its `public/js/pages/<page>.js` module.
- **Tooling (dev only)**: ESLint, TypeScript (type checks the JS via JSDoc;
  `checkJs`, strict, implicit `any` allowed for now), Vitest with
  `@cloudflare/vitest-plugin` (tests run in the Workers runtime with D1 built
  from `migrations/`).

### Code layout

Each feature is split into pure logic (`parse.js`, `config.js`: no I/O, unit
tested), database queries (`db.js`) and HTTP handlers (`routes.js`).

- `src/index.js`: routing. `src/errors.js`: errors → responses.
- `src/http.js`: `json`, `notFound`, `readJson`, `BadInput`.
  `src/parse.js`: field parsers. `src/sql.js`: `NOW`.
- `src/auth/jwt.js`: Access token verification (pure; key lookup passed in).
  `src/auth/user.js`: `getUser`, `findOrCreateUser`.
- `src/resources/`: plans, people and locations, all described in one
  `RESOURCES` table (`config.js`) and handled by the same routes.
- `src/ties/`: ties (`parse.js`, `search.js` builds the list filters' SQL,
  `db.js`, `routes.js`). `GET /api/ties` is filtered and paged (20 per page)
  and returns `{ ties, total, page, page_size }`.
- `public/`: one HTML page per section (`index.html` = ties, `plans.html`,
  `people.html`, `locations.html`), shared `app.css`, and scripts in
  `public/js/`: `api.js`, `dom.js` (`h`, `$`), `dialog.js` (`choose`),
  `format.js`, `ties-view.js` and `tie-search.js` (pure), `nav.js` (tabs and
  the + button), `tie-form.js` (the "Log a tie" dialog), `multi-select.js`,
  `resource-page.js` (list/edit pages), and `pages/<page>.js` for each page.
  No inline scripts. Ids inside dialogs are prefixed (e.g. `tie-title`) so they
  don't clash with the page underneath.
- `test/unit/`: pure logic. `test/api/`: requests to the Worker with a real
  D1. `test/db/`: rules the database enforces itself. `scripts/ui-smoke.mjs`:
  headless-Chrome walkthrough of every page.

### Commands

- `npm run check`: lint + type check + tests. Run after every change.
- `npm run test:ui`: UI walkthrough in headless Chrome on a throwaway database.
- `npm run dev`: local app. `npm run types`: regenerate
  `worker-configuration.d.ts` after changing `wrangler.jsonc`.

### Data rules

- **Scope every query to the signed-in user** with `owner_id = ?` bound to
  `user.id`. Users are keyed by `users.id`, never by email; email is only used
  in `getUser` to look up who's signed in.
- **Ownership is also enforced in the database**: triggers reject linking rows
  that belong to different users, and `owner_id` can't change. Errors start
  with `ownership mismatch`, which the Worker turns into "Linked item not found."
- **Always check whether a code path should set `updated_at`.** Nothing updates
  it automatically (we chose not to use triggers, to avoid a second write per
  UPDATE; see considerations.md). Any UPDATE to a table with an `updated_at`
  column (people, profile_notes, locations, plans, ties) should normally include
  `updated_at = ${NOW}`.
- **Timestamps are ISO text**, e.g. `2026-10-11T21:51:00Z`. In SQL, use the
  `NOW` constant from `src/lib.js` (`strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`),
  never `datetime('now')`, which has no `T`/`Z` and breaks string comparisons.
  Plain dates (`tie_date`, `noted_on`) stay as `YYYY-MM-DD`.
- **Always check whether a query on `plans`, `people` or `locations` needs
  `WHERE archived_at IS NULL`.** Archived rows are still in the table.
  Archiving and deleting are separate actions for all three; archiving never
  expires and is undone with the restore route. Exclude archived rows from
  pickers (choosing a plan, participants or a location for a tie) and from
  default lists, but still show them on existing ties and in their own
  history. A one-off location is just one archived when it's added.
  `GET /api/plans|people|locations` requires `?archived=false|true|all`
  (no default, so a forgotten filter is a 400, not a silent mistake).
- **Show deleted links on ties instead of hiding them:**
  - `tie_participants.person_id` NULL → "(person deleted)"
  - `tie_plans.plan_id` NULL → "(plan deleted)"
  - `ties.location_deleted = 1` → "(location deleted)". Any code that sets a
    tie's `location_id` must also set `location_deleted = 0` (a CHECK enforces it).
- **Deleting a plan needs the user's choice** of `linked_ties=remove` (also drop
  it from ties) or `linked_ties=keep` (ties show "(plan deleted)"). The UI asks
  with a confirmation dialog: remove from linked ties / just delete the plan /
  cancel. The API rejects a delete without the choice.
- **Multi-statement writes go in one `env.DB.batch([...])`**, which runs as a
  single transaction, so a failure saves nothing.

### Design system

- **Colors are CSS variables** on `:root` in `public/app.css` (`--bg`, `--card`,
  `--text`, `--muted`, `--line`, `--accent`, `--accent-text`, `--error`,
  `--danger`, `--danger-text`), redefined for dark mode under
  `@media (prefers-color-scheme: dark)`. Never hard-code colors elsewhere.
- **Layout**: mobile-first single column, `max-width: 640px`, 16px padding.
  Sections are `.card`s; forms stack label above input; `.row` puts two fields
  side by side.
- **Typography**: system font stack, 16px base; muted text (`.item-meta`,
  `.hint`) for secondary info.
- **Components**: `button.primary` (full-width main action), plain `button`
  (secondary), `button.danger` (destructive; `.solid` for the final confirm),
  `button.link`; `.item` list rows with `.item-title`, `.item-meta`,
  `.item-notes`, `.item-actions`; `.badge`; `.deleted` (muted italic) for
  "(… deleted)" labels; `choose()` modal for confirmations.
- **Destructive actions always confirm**, and offer "Archive instead" where
  archiving is available.

### Code style

- ES modules, 2-space indent, double quotes, semicolons, `const` by default.
- **JSDoc types** on exported functions (`@param`, `@returns`, `@typedef`), so
  the type checker can follow the code. Keep modules small and single-purpose.
- Comments explain *why* and what a reader needs to know, in plain language.
  Each route has a comment with its method, path and behavior.
- **SQL**: bind every value with `?`. Never put request data into SQL text;
  table and column names come only from fixed lists in code (e.g. `RESOURCES`).
- **Validation**: parse every request field with the parsers in `src/lib.js`;
  throw `BadInput` with a friendly message, which becomes a 400.
- **Pages**: put user-entered text on the page with `h()` / `textContent`,
  never `innerHTML`. Only make links clickable if they start with http(s).
- User-facing messages are short and friendly ("Couldn't save: …").
