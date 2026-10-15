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

- **Cloudflare Workers** for the API (`src/`) and static files (`public/`,
  served through the `ASSETS` binding). Anything under `/api/` goes to the
  Worker (`run_worker_first`); everything else is a static file, and any
  address that isn't one gets `index.html` (`not_found_handling:
  "single-page-application"`), the app's only page.
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
  the Worker. The app is one page (`index.html`) that stays loaded while you
  move between views, so what it holds in memory (from step 4b, the unlocked
  encryption key) survives a tab change: see "Single-page app" below.
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
- `src/encryption/`: encrypted notes. `config.js` (the encrypted columns and
  how each table is scoped to its owner), `db.js`, `routes.js` (`GET
  /api/encryption/pending`, `POST /api/encryption/seal`: older plain text
  found and overwritten).
- `src/keys/`: wrapped encryption keys (migration 0009). `parse.js` (pure:
  a wrap's shape), `db.js`, `routes.js` (`GET /api/keys`, `POST
  /api/keys/setup`, `PUT /api/keys/passkeys/:id`). Sign-up, adding a
  passkey and replacing the recovery code also take wraps (auth/, account/).
- `src/account/`: `GET /api/account`, renaming/removing passkeys, ending
  sessions, replacing the recovery code, setting or removing the recovery
  email (`PUT`/`DELETE /api/account/recovery-email`: a hash and salt only;
  `parse.js`), deleting the account (`DELETE /api/account`: one cascading
  delete).
- `src/data/`: "Your data". `shape.js` (pure: the export document) and
  `db.js` for `GET /api/data/export`; import in `import-parse.js` (pure),
  `import-plan.js` (pure: matching names, new ids, JSON chunks) and
  `import-db.js` (`json_each` inserts) for `POST /api/data/import/items`
  and `/api/data/import/ties` (both take `preview`). See considerations.md,
  "Step 3 as built".
- `src/media/`: photos on ties and plans (migration 0010; files in the R2
  bucket `PHOTOS`). `parse.js` (pure: limits, upload parameters, sealed
  captions, order), `db.js`, `storage.js` (R2: keys, deleting, the daily
  sweep of files without a row), `routes.js` (`GET /api/media?tie_id=|
  plan_id=`, `PUT /api/media/:id` (the upload), `GET /api/media/:id/thumb|
  full`, `PATCH /api/media/:id` (caption), `PUT /api/media/order`, `DELETE
  /api/media/:id`).
- `src/cleanup.js`: the daily cron trigger (ended sessions, expired
  challenges; `index.js` also runs the photo sweep).
- `src/resources/`: plans, people and locations, all described in one
  `RESOURCES` table (`config.js`) and handled by the same routes.
- `src/ties/`: ties (`parse.js`, `search.js` builds the list filters' SQL,
  `db.js`, `routes.js`). `POST /api/ties/search` (filters in the JSON body;
  a keyword is searched for on the device, which sends `match_ids`) is filtered and paged (20 per page by default)
  and returns `{ ties, total, all_total, page, page_size }` (`page_size`
  20, 50 or 100; `sort` newest or oldest). `GET`/`PUT`/`DELETE
  /api/ties/:id` read, edit (with `keep_deleted` for deleted links to keep)
  and delete one tie. A tie's `tags` are sent as
  names; new ones are created when the tie is saved. `tie_type` is one of
  `TIE_TYPES` (also in `public/js/ties-view.js` and a CHECK in migration
  0004). `GET /api/ties/recent/locations|people|plans`: ids of the 5 active
  ones most recently on a tie (by tie date), for the tie form's pickers.
- `src/tags/`: tags (`parse.js` parses and matches names, ignoring capitals;
  `db.js`; `routes.js`: `GET /api/tags` most recently used first,
  `DELETE /api/tags/:id`).
- `public/`: `index.html` (the app: a `<template id="view-…">` for each
  view), `privacy.html` (built from PRIVACY.md; a separate page, opened from
  the app in a new tab), `import-template.csv` (the "Your data" view's CSV
  template), shared `app.css`, and scripts in `public/js/`: `app.js` (the
  shell: shows the view for the address, handles links and Back/Forward),
  `router.js` (pure: the routes, which link clicks stay in the app),
  `navigate.js` (`navigate(path, { replace })`: changing view from code),
  `crypto/keys.js` (pure: the data key, wrapping, the PRF salt),
  `crypto/fields.js` (pure: sealing and opening notes fields),
  `crypto/vault-core.js` (what the crypto Worker does), `crypto-worker.js`
  (the Worker itself), `vault.js` (the page's side of it: unlock, lock,
  `addWrap`), `key-flows.js` (unlocking, setup, adding a passkey or recovery
  code with proof, sign-up, recovery), `search-match.js` (pure: keyword
  matching), `journal-fields.js` (pure: a whole export or import, kind by
  kind), `import-dedupe.js` (pure: import duplicates from candidates),
  `seal-leftovers.js` (encrypting older plain text), `lock-rules.js` (pure) and `lock.js`
  (locking by itself), `api.js`, `dom.js` (`h`, `$`, `privateField`, `infoButton`), `dialog.js` (`choose`),
  `format.js`, `ties-view.js` and `tie-search.js` (pure), `nav.js` (tabs, the
  + button and the ☰ menu panel; drawn once, `setCurrent` marks the view), `tie-form.js` (the "Log a tie" dialog), `tag-picker.js`
  (its "Edit tags" dialog; the Ties search's "Has Tags" opens it with
  `forSearch`, for picking existing tags only) and `tags.js` (pure), `search-picker.js` (its
  search boxes for the location, people and plans, which can also add one),
  `search-choices.js` (pure: what those boxes list and offer to add),
  `rope-rating.js` (ratings drawn as rope hanks), `multi-select.js`,
  `resource-page.js` (list/edit pages), `csv.js`, `import-csv.js` and
  `import-steps.js` (pure: reading CSVs, CSV rows to an import, and an
  import's requests), `download.js` (saving a file), `codes.js` and `recovery.js` (pure:
  typed codes, recovery codes and their login secret), `recovery-email.js`
  (pure: reading and hashing a recovery email), `webauthn-json.js`
  (pure) and `webauthn.js` (making and using passkeys), `auth-flows.js`
  (sign-in flows shared by the sign-in and account views), and
  `views/<view>.js` for each view.
  No inline scripts. Ids inside dialogs are prefixed (e.g. `tie-title`) so they
  don't clash with the view underneath.
- **Single-page app.** Each view module exports `mount(root, { signal })`,
  run each time the view is shown (its state starts fresh inside it).
  Routes with `needsKey` show the Unlock view (`views/unlock.js`) in their
  place while the journal is locked, and are drawn again when it locks. Its
  markup is cloned from its template first. `signal` aborts when the view is
  left: anything outside the view's own elements (listeners on `window` or
  `document`, observers, timers) must stop with it (`{ signal }`, or
  `signal.addEventListener("abort", …)`). Change view with links (app.js
  catches same-origin links to views) or `navigate()`, never
  `location.href`; use `replace: true` for redirects (signed out, signed in)
  so Back doesn't land on them. Open dialogs close when the view changes. A
  new view needs a route in `router.js`, a template in `index.html`, a
  loader in `app.js` and a module in `views/`.
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
  give one a new recovery code (only when its owner asks, has a recovery
  email, and has proved the address is theirs). `--email <address>` finds
  the account with that recovery email.
- `node scripts/backup.mjs --remote`: encrypted backup into `backups/`, and
  deletes ones older than 7 days (only when it runs: run it at least weekly).
  `node scripts/restore-backup.mjs <file>` decrypts one.
- `npm run test:ui`: UI walkthrough in headless Chrome on a throwaway database
  (with a generated copy of `wrangler.jsonc` whose sign-in rate limit is
  higher, as every page load there locks and unlocks).
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
- **Every journal has a "this is me" profile**, named "Me" when the account
  is made (`newUserStatements`; migration 0005 added one to older accounts).
  It can be renamed or archived; a unique index allows at most one.
- **Multi-statement writes go in one `env.DB.batch([...])`**, which runs as a
  single transaction, so a failure saves nothing.
- **Notes and descriptions are encrypted** (`ties.notes`,
  `tie_participants.notes`, `people.notes`, `profile_notes.description`,
  `locations.notes`, `plans.description`, `plans.notes`): parse them with
  `encryptedText`, never `cleanText`; the server never reads, compares,
  searches or sorts by them. The page seals before sending (`vault.seal`,
  `sealOne`) and opens what it shows (`vault.open`). A new encrypted field
  goes in both lists (`crypto/fields.js`, `src/encryption/config.js`).
  Anything that changes a tie's notes or title, or a plan's title, calls
  `forgetSearch()`.
- **Photo files live in R2, outside D1's transactions.** Anything that
  deletes `media` rows (directly or by cascade: a tie, a plan, the account,
  a new key) must then delete their files (`media/storage.js`); read the
  photo ids in the same batch as the delete. The daily sweep only catches
  what a crash left behind.
- **Wrapped keys (`key_wraps`) are never exported** (useless without the
  user's secrets); they go with their passkey or account.
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
  `public/js/theme-init.js`, a plain script in the `<head>` of `index.html`
  and `privacy.html`. `theme.js` holds the pure logic.
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
  (`public/js/recovery.js`); the server stores a SHA-256 of that. The
  encryption key's wrapping key comes from the code differently
  (`crypto/keys.js`); keep the two derivations apart.
- **PRF output never leaves the browser**, and only the crypto Worker uses
  it. Every passkey answer sent goes through `withoutPrfResults`; send only
  whether it was given. Hand it to the Worker by transferring the buffer.
  `prfOutputFor()` is not a sign-in: never use it as proof of identity or
  to start or freshen a session.
- **The encryption key lives only in the crypto Worker**, non-extractable.
  Never add a Worker operation that returns the key, or that wraps it
  without proof (an existing wrap and its secret, given just now). Step 5's
  operations work on whole records, never a general decrypt. Nothing
  decrypted goes to localStorage, sessionStorage, IndexedDB or a cache.
  Anything that ends the session or signs out must `lock()`.
- **Sensitive account changes need a fresh session** (`isFresh`: signed in in
  the last 10 minutes): adding or removing a passkey, replacing the recovery
  code, setting or removing the recovery email, deleting the account. Throw `NeedsReauth`; the page asks for the passkey again
  (`withReauth`). New sensitive actions should do the same.
- **Only hashes of secrets are stored**: session tokens, invite codes,
  recovery login secrets. **A recovery email never leaves the browser**
  either: only its salted PBKDF2 hash (`public/js/recovery-email.js`).
