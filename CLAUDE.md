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
- **Passkeys (WebAuthn) for sign-in**, with app sessions in D1, using
  `@simplewebauthn/server`. Sign-up is invite-only (`scripts/invite.mjs`).
  `RP_ID` and `ORIGIN` in `wrangler.jsonc` (localhost values in `.dev.vars`):
  passkeys are tied to `RP_ID` for good, so changing domain means everyone
  adds a new passkey with their recovery code. `AUTH_RATE_LIMIT` limits the
  `/api/auth/` routes per IP.
- **No stored request logs** (`observability` is off in `wrangler.jsonc`).
  Watch errors live with `npx wrangler tail`.
- **Plain JavaScript ES modules, no framework, no build step.** Wrangler bundles
  the Worker; each page loads its `public/js/pages/<page>.js` module.
- **Tooling (dev only)**: ESLint, TypeScript (type checks the JS via JSDoc;
  `checkJs`, strict, implicit `any` allowed for now), Vitest with
  `@cloudflare/vitest-plugin` (tests run in the Workers runtime with D1 built
  from `migrations/`).

### Code layout

Each feature is split into pure logic (`parse.js`, `config.js`: no I/O, unit
tested), database queries (`db.js`) and HTTP handlers (`routes.js`).

- `src/index.js`: routing; catches every error and adds the security headers.
  `src/errors.js`: errors → responses.
- `src/security-headers.js`: headers on every Worker response (no-store, an
  API-only CSP, etc.). Static files get theirs from `public/_headers`
  (the pages' CSP lives there); keep the shared headers the same in both.
- `src/http.js`: `json`, `notFound`, `readJson`, `BadInput`.
  `src/parse.js`: field parsers. `src/sql.js`: `NOW`.
- `src/auth/`: sign-in. `session.js` (pure: tokens, hashes, expiry rules),
  `cookie.js` (pure: the `__Host-session` cookie), `guard.js` (pure: Origin
  check, what a recovery session may do, rate-limit key), `parse.js` (pure),
  `webauthn.js` (the library with our settings), `db.js`, `user.js`
  (`getUser`: the session's user), `routes.js` (`/api/auth/register|login/
  options|verify`, `/api/auth/recover`, `/api/auth/logout`).
- `src/account/`: `GET /api/account`, renaming/removing passkeys, ending
  sessions, replacing the recovery code, deleting the account
  (`DELETE /api/account`: one cascading delete).
- `src/data/`: "Your data". `shape.js` (pure: the export document) and
  `db.js` for `GET /api/data/export`; import in `import-parse.js` (pure),
  `import-plan.js` (pure: matching names, new ids, JSON chunks) and
  `import-db.js` (`json_each` inserts) for `POST /api/data/import/items`
  and `/api/data/import/ties` (both take `preview`). See considerations.md,
  "Step 3 as built".
- `src/cleanup.js`: the daily cron trigger (ended sessions, expired
  challenges).
- `src/resources/`: plans, people and locations, all described in one
  `RESOURCES` table (`config.js`) and handled by the same routes.
- `src/ties/`: ties (`parse.js`, `search.js` builds the list filters' SQL,
  `db.js`, `routes.js`). `POST /api/ties/search` (filters in the JSON body,
  so the keyword never goes in a URL) is filtered and paged (20 per page)
  and returns `{ ties, total, page, page_size }`. A tie's `tags` are sent as
  names; new ones are created when the tie is saved.
- `src/tags/`: tags (`parse.js` parses and matches names, ignoring capitals;
  `db.js`; `routes.js`: `GET /api/tags` most recently used first,
  `DELETE /api/tags/:id`).
- `public/`: one HTML page per section (`index.html` = ties, `plans.html`,
  `people.html`, `locations.html`, `account.html`), plus `signin.html` and
  `privacy.html` (built from PRIVACY.md), `data.html` (export and import;
  `import-template.csv` is its CSV template), shared `app.css`, and scripts in
  `public/js/`: `api.js`, `dom.js` (`h`, `$`, `privateField`), `dialog.js` (`choose`),
  `format.js`, `ties-view.js` and `tie-search.js` (pure), `nav.js` (tabs, the
  + button and the ☰ menu panel), `tie-form.js` (the "Log a tie" dialog), `tag-picker.js`
  (its "Edit tags" dialog) and `tags.js` (pure), `multi-select.js`,
  `resource-page.js` (list/edit pages), `csv.js`, `import-csv.js` and
  `import-steps.js` (pure: reading CSVs, CSV rows to an import, and an
  import's requests), `download.js` (saving a file), `codes.js` and `recovery.js` (pure:
  typed codes, recovery codes and their login secret), `webauthn-json.js`
  (pure) and `webauthn.js` (making and using passkeys), `auth-flows.js`
  (sign-in flows shared by the sign-in and account pages), and
  `pages/<page>.js` for each page.
  No inline scripts. Ids inside dialogs are prefixed (e.g. `tie-title`) so they
  don't clash with the page underneath.
- `test/unit/`: pure logic. `test/api/`: requests to the Worker with a real
  D1, signed in by `test/helpers.js` (a session made directly in the
  database); `test/fake-passkey.js` is a software passkey for the sign-in
  tests. `test/db/`: rules the database enforces itself.
  `scripts/ui-smoke.mjs`: headless-Chrome walkthrough of every page, signing
  up with Chrome's virtual passkey.

### Commands

- `npm run check`: lint + type check + tests, and checks `public/privacy.html`
  matches PRIVACY.md. Run after every change.
- `node scripts/privacy-html.mjs`: rebuild `public/privacy.html` after
  editing PRIVACY.md.
- `node scripts/invite.mjs [--remote]`: make an invite code.
  `node scripts/recovery-code.mjs [<user-id>] [--remote]`: list accounts, or
  give one a new recovery code (only when its owner asks).
- `node scripts/backup.mjs --remote`: encrypted backup into `backups/`, and
  deletes ones older than 7 days (only when it runs: run it at least weekly).
  `node scripts/restore-backup.mjs <file>` decrypts one.
- `npm run test:ui`: UI walkthrough in headless Chrome on a throwaway database.
- `npm run dev`: local app. `npm run types`: regenerate
  `worker-configuration.d.ts` after changing `wrangler.jsonc`.

### Data rules

- **Scope every query to the signed-in user** with `owner_id = ?` bound to
  `user.id`. Users are keyed by `users.id`. `users.email` is a leftover that
  just holds the id (see migration 0003); never read it or put anything in it.
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
- **When a table or column is added, update export and import**
  (`src/data/`): the export must hold everything in an account, and an
  export must import back exactly (`test/api/data-import.test.js`). Account
  deletion relies on every table cascading from `users`; add new tables to
  `test/api/account-delete.test.js`.

### Design system

- **Colors are CSS variables** on `:root` in `public/app.css` (`--bg`, `--card`,
  `--text`, `--muted`, `--line`, `--accent` (fills: buttons, selected tags,
  underlines), `--accent-text` (text on `--accent`), `--accent-ink` (the
  accent as text or a thin outline: links, link buttons), `--error`,
  `--danger`, `--danger-text`), redefined for dark mode in two blocks that
  must match: `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`
  (the device is dark) and `:root[data-theme="dark"]` (dark picked in the
  menu). Never hard-code colors elsewhere.
- **Light/dark mode** follows the device unless the user picks the other mode
  with "Light / Dark Mode" in the nav's ☰ menu (`nav.js`). The choice (`light`/`dark`) is
  saved in localStorage and applied before the page draws by
  `public/js/theme-init.js`, a plain script in every page's `<head>`
  (new pages need it too). `theme.js` holds the pure logic.
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
  never `innerHTML` (Trusted Types makes the browser refuse it anyway). Only
  make links clickable if they start with http(s).
- User-facing messages are short and friendly ("Couldn't save: …").

### Privacy rules

The plan and reasons are in considerations.md ("Planned: privacy and accounts
roadmap"); [PRIVACY.md](PRIVACY.md) is the draft policy. Keep it true: when a
change affects what's collected, stored, readable or kept, update it too.

- **Never put user-entered text in a URL**, page address or API path/query
  (it ends up in browser history and request logs). Send it in a POST body.
  Ids, dates and page numbers are fine in URLs.
- **The CSP is strict** (`public/_headers`): no inline scripts or styles, no
  `style` attributes (use classes in `app.css`), no `eval`, nothing from other
  sites. Something new (images from `blob:`, a Web Worker) needs its own
  directive added there, deliberately. `npm run test:ui` fails on any CSP
  violation.
- **Every input and textarea** (except checkboxes) has `autocomplete="off"`
  and `spellcheck="false"`: in HTML directly, in JS via `privateField()`.
  `npm run test:ui` checks every page and dialog.
- **Never log request bodies or journal content**; `console.error` only for
  unexpected errors.
- **No third-party scripts, fonts, analytics or trackers.**
- **A recovery code never leaves the browser.** Send only `loginSecret(code)`
  (`public/js/recovery.js`); the server stores a SHA-256 of that. Step 4 will
  derive the encryption key from the code differently, so keep the two
  derivations apart.
- **Sensitive account changes need a fresh session** (`isFresh`: signed in in
  the last 10 minutes): adding or removing a passkey, replacing the recovery
  code, deleting the account. Throw `NeedsReauth`; the page asks for the passkey again
  (`withReauth`). New sensitive actions should do the same.
- **Only hashes of secrets are stored**: session tokens, invite codes,
  recovery login secrets.
