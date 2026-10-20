# NotoNawa: instructions for Claude

A private rope journal: plan ties, log what happened, and keep notes on the
people and places involved. Design ideas we've weighed live in
[considerations.md](considerations.md); planned features that still need
building live in [roadmap.md](roadmap.md).

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
  new one. Check with `npx wrangler d1 migrations list notonawa --remote`.
  Test every migration on a copy of the local database first
  (`--persist-to <copy of .wrangler/state>`), seeded with linked data.
- **Record design decisions** that we weigh but don't adopt in
  considerations.md with the reasons, and planned features that still need
  building in roadmap.md (moving them to considerations.md once built).
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
- **D1** (SQLite) database `notonawa`, binding `DB`. Schema changes only via
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
  move between views, so what it holds in memory (since the encryption
  foundation, the unlocked encryption key) survives a tab change: see
  "Single-page app" below.
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
  delete), and my settings (`GET`/`PUT /api/account/settings`: role names
  and light/dark mode (migration 0013), `seen_release`, the last release
  notes shown (migration 0014), and `hide_welcome`, the welcome's "Don't
  show this again" (migration 0015); `settings.js` (pure) parses them).
- `src/data/`: "Your data". `shape.js` (pure: the export document) and
  `db.js` for `GET /api/data/export`; import in `import-parse.js` (pure),
  `import-plan.js` (pure: matching names, new ids, JSON chunks) and
  `import-db.js` (`json_each` inserts) for `POST /api/data/import/items`
  and `/api/data/import/ties` (both take `preview`). See considerations.md,
  "Export, import and deletion as built".
- `src/media/`: photos on ties and plans (migration 0010; files in the R2
  bucket `PHOTOS`). `parse.js` (pure: limits, upload parameters, sealed
  captions, order), `db.js`, `storage.js` (R2: keys, deleting, the daily
  sweep of files without a row), `routes.js` (`GET /api/media?tie_id=|
  plan_id=`, `PUT /api/media/:id` (the upload), `GET /api/media/:id/thumb|
  full`, `PATCH /api/media/:id` (caption), `PUT /api/media/order`, `DELETE
  /api/media/:id`).
- `src/cleanup.js`: the daily cron trigger (ended sessions, expired
  challenges; `index.js` also runs the photo sweep and the backup, each
  carrying on if one before it fails).
- `src/backup/`: the daily backup (migration-free). `run.js` reads every
  table in one batch, gzips it as JSON and saves it in the R2 bucket
  `BACKUPS`, deleting ones over 30 days old; `crypto.js` seals it with
  `BACKUP_PUBLIC_KEY` (RSA-OAEP wrapping a fresh AES-GCM key), so the
  Worker can't open its own backups; `names.js` (pure). The key pair comes
  from `scripts/backup-keys.mjs`; `scripts/restore-backup.mjs` opens one.
- `src/consent/` and `src/policy-version.js`: agreeing to the privacy
  policy again. `policy-version.js` is generated from PRIVACY.md by
  `scripts/privacy-html.mjs` (never edit it): `POLICY_VERSION` (new
  accounts agree to it), `CONSENT_VERSION` (anyone who agreed to an older
  one must agree again) and `CONSENT_SUMMARY`. `parse.js` (pure:
  `needsConsent`, `allowedWithoutConsent`: reads, the account, keys and
  notices); `index.js` refuses anything else with 403 `{ consent: true }`;
  `routes.js` (`GET /api/consent`, `POST /api/consent` with the version
  shown).
- `src/feedback/`: bug reports and ideas from the menu's "Bug and
  feedback" (migration 0015). `parse.js` (pure: kind bug or idea, message
  up to 2,000 characters, the page's app version), `db.js` (at most
  `FEEDBACK_PER_DAY` per account, checked in the insert), `routes.js`
  (`POST /api/feedback`). Plain text, read with `scripts/feedback.mjs`.
  Each one emails contact@notonawa.app (from itself) through the
  `FEEDBACK_EMAIL` binding (`send_email`, Email Routing): `mail.js` (pure:
  the subject and text, a bug report or feedback, with the kind, version
  and time only, never what was written), `notify.js` (sends it; a failure
  is logged, and doesn't fail the request).
- `src/notices/`: messages from us (migration 0012), written only with
  `scripts/notice.mjs`. `GET /api/notices` (for everyone or just me, on
  now, not dismissed), `POST /api/notices/:id/dismiss`.
- `src/resources/`: plans, people and locations, all described in one
  `RESOURCES` table (`config.js`) and handled by the same routes. Plans are
  `tagged`: their tags are sent and listed as names and saved in the same
  batch (`LinkStatements` in `db.js`). The plans list also has
  `linked_ties` (id, title, date and rating of each tie it's on, newest
  first); `jsonColumns` are parsed by `listRows`.
- `src/locations/`: location routes beyond the shared ones. `maps.js`
  (pure: which Google Maps links we accept, reading their coordinates),
  `resolve.js` (following a short link's redirects; `fetch` is passed in),
  `routes.js` (`POST /api/locations/coords` with `{ url }`; routed before
  resources in `index.js`).
- `src/ties/`: ties (`parse.js`, `search.js` builds the list filters' SQL,
  `db.js`, `routes.js`). `POST /api/ties/search` (filters in the JSON body;
  a keyword is searched for on the device, which sends `match_ids`) is filtered and paged (20 per page by default)
  and returns `{ ties, total, all_total, page, page_size }` (`page_size`
  20, 50 or 100; `sort` newest or oldest). `ROLES` (top, bottom, self tie,
  spotter, photographer) are checked with `toRoleOrNull`, which reads the
  old "rigger" and "model" as top and bottom. `GET`/`PUT`/`DELETE
  /api/ties/:id` read, edit (with `keep_deleted` for deleted links to keep)
  and delete one tie. A tie's `tags` are sent as
  names; new ones are created when the tie is saved. `tie_type` is one of
  `TIE_TYPES` (also in `public/js/ties-view.js` and a CHECK, since
  migration 0013), and required (`TYPE_NEEDED`; since migration 0014 the
  API, imports and two triggers refuse a tie without one). `GET /api/ties/recent/locations|people|plans`: ids of the 5 active
  ones most recently on a tie (by tie date), for the tie form's pickers.
- `src/stats/`: the analytics' data (`parse.js`: pure, the filters and
  `ROLE_GROUPS`; `db.js`; `routes.js`: `POST /api/stats/ties`, the ties in a
  date range with only what the counting needs, filtered by my role and by
  any of the chosen people, locations and tags). See considerations.md,
  "Analytics".
- `src/tags/`: tags, shared by ties and plans (`parse.js` parses and
  matches names, ignoring capitals; `db.js`: `tagStatements` and
  `clearTagsStatement` save a tie's or plan's tags; `routes.js`: `GET
  /api/tags` most recently used on a tie first, with `tie_count` and
  `plan_count`, `DELETE /api/tags/:id`).
- `src/app-version.js`: generated from RELEASES.md by
  `scripts/releases.mjs` (never edit it): `APP_VERSION`, whose release
  notes new accounts start as having seen.
- `public/`: `index.html` (the app: a `<template id="view-…">` for each
  view), `privacy.html` (built from PRIVACY.md; a separate page, opened from
  the app in a new tab), `import-template.csv` (the "Your data" view's CSV
  template), shared `app.css`, and scripts in `public/js/`: `app.js` (the
  shell: shows the view for the address, handles links and Back/Forward),
  `router.js` (pure: the routes, which link clicks stay in the app),
  `navigate.js` (`navigate(path, { replace })`: changing view from code),
  `roles.js` (the words shown for roles: the account's names for top and
  bottom, set once unlocked; `roleName`, `roleOptions`, `roleFromName`),
  `settings.js` (reading my settings once unlocked, saving role names and
  the mode) and `settings-dialog.js` (the Settings dialog),
  `crypto/keys.js` (pure: the data key, wrapping, the PRF salt),
  `crypto/fields.js` (pure: sealing and opening notes fields),
  `crypto/media.js` (pure: sealing and opening photos and their captions,
  bound to the photo's id),
  `crypto/vault-core.js` (what the crypto Worker does), `crypto-worker.js`
  (the Worker itself), `vault.js` (the page's side of it: unlock, lock,
  `addWrap`), `key-flows.js` (unlocking, setup, adding a passkey or recovery
  code with proof, sign-up, recovery), `search-match.js` (pure: keyword
  matching), `journal-fields.js` (pure: a whole export or import, kind by
  kind), `import-dedupe.js` (pure: import duplicates from candidates),
  `seal-leftovers.js` (encrypting older plain text), `links.js` (pure: album
  links, checked before sealing and again before being made clickable),
  `releases.js` (generated from RELEASES.md: `APP_VERSION`, `RELEASES`),
  `release-notes.js` (pure: the releases I haven't seen) and `whats-new.js`
  (the "What's new" dialog: from the menu, and once after an update),
  `welcome-text.js` (generated from WELCOME.md by `scripts/welcome.mjs`)
  and `welcome.js` (the welcome dialog: after each unlock, before What's
  new, until "Don't show this again" is ticked), `feedback-dialog.js` (the
  "Bug and feedback" form, with a `mailto:` link for screenshots and
  replies),
  `photo-fit.js` (pure:
  photo sizes, limits, choosing a quality) and `photo-prep.js` (redrawing a
  photo on a canvas: strips its metadata, shrinks it, makes the thumbnail),
  `photo-urls.js` (every `blob:` URL for a decrypted photo, revoked on
  lock), `photo-upload.js` (sealing and uploading one prepared photo and
  its caption; used by the Photos section and import), `photos-ui.js` (a form's Photos section and the photo viewer), `lock-rules.js` (pure) and `lock.js`
  (locking by itself), `api.js`, `dom.js` (`h`, `$`, `privateField`, `infoButton`), `dialog.js` (`choose`),
  `format.js`, `ties-view.js` and `tie-search.js` (pure), `plans-view.js`
  (pure: the Plans search, done on the device over the loaded plans and
  kept only in memory, and a plan's tie count and average rating),
  `nav.js` (the tabs, as icons with their
  names in `aria-label` and `title`: Ties, Plans, People, Locations, Calendar,
  Analytics; the + button and the ☰ menu panel: Settings, Account, Your
  data, Bug and feedback, What's new, Privacy Policy, Sign Out and the version; drawn once,
  `setCurrent` marks the view), `tie-form.js` (the "Log a tie" dialog), `tag-picker.js`
  (its "Edit tags" dialog; the Ties and Plans searches' "Has Tags" open it
  with `forSearch`, for picking existing tags only, on ties or, with
  `noun: "plan"`, on plans) and `tags.js` (pure), `search-picker.js` (its
  search boxes for the location, people and plans, which can also add one),
  `search-choices.js` (pure: what those boxes list and offer to add),
  `rope-rating.js` (ratings drawn as rope hanks; `hankIcon`),
  `stats.js` and `stats-period.js` (pure: the analytics' numbers, and its
  periods and bars; `roleChartTies` and `withSegments` split the tie count
  and partner bars by my role), `charts.js` (bar, partner, location and pie
  charts as SVG; bars, rows and slices are buttons) and `chart-parts.js`
  (pure: their colors and what a bar says in words), `tie-card.js` (a tie as a card, shared by the
  Ties list and Analytics; `editTie`), `tie-list-dialog.js` (Calendar and
  Analytics: the ties behind a day, bar or slice), `multi-select.js`,
  `resource-page.js` (list/edit pages; with `dialog`, the form is in a
  dialog that + and Edit open, as on Plans), `list-tools.js` and `list-order.js`
  (People and Locations: the search box and sort buttons, and the pure
  filtering and sorting), `csv.js`, `import-csv.js` and
  `import-steps.js` (pure: reading CSVs, CSV rows to an import, and an
  import's requests), `import-photos.js` (pure: an import's photos, taken
  off its ties and plans before sending and uploaded once the rest is
  saved), `zip.js` (pure apart from `DecompressionStream`: zip files for
  exports with photos), `notices.js` (the banners between the nav and the
  view), `consent-state.js` (whether I must agree to a changed policy;
  `api.js` marks it on a 403 `consent`, and `app.js` then shows
  `views/consent.js` in place of journal views, except Your data and
  Account (`beforeConsent` routes), so someone who won't agree can export
  and leave), `download.js` (saving a file), `codes.js` and `recovery.js` (pure:
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
  matches PRIVACY.md, the release files match RELEASES.md and the welcome
  matches WELCOME.md. Run after every change.
- `node scripts/releases.mjs`: rebuild `public/js/releases.js` and
  `src/app-version.js` after editing RELEASES.md. Each release is a
  `## YYYY.MM.DD.NNN` heading (the date, and 001, 002… that day; newest
  first) with `- ` notes; the newest is the app's version, shown on
  sign-in and in the menu. Add one before each deploy.
- `node scripts/welcome.mjs`: rebuild `public/js/welcome-text.js` after
  editing WELCOME.md (the welcome dialog's text: a heading, paragraphs, a
  list, **bold**, *italics*; email addresses become links).
- `node scripts/feedback.mjs [--since YYYY-MM-DD] [--kind bug|idea]
  [--remote]`: the bug reports and ideas sent from the app, newest first.
  Answer one with `notice.mjs --user <id>`.
- `node scripts/privacy-html.mjs`: rebuild `public/privacy.html` after
  editing PRIVACY.md. A wording change stamps today's date on the policy
  and makes a new version (`src/policy-version.js`). Add
  `--require-consent "what changed"` when people must agree again; post a
  notice first for changes they should hear about before they take effect.
- `node scripts/notice.mjs "message" [--warning] [--user <id>] [--link privacy]
  [--from YYYY-MM-DD] [--until YYYY-MM-DD] [--remote]`: a banner in the app;
  `--list` and `--end <id>`.
- `node scripts/backup-keys.mjs`: makes the daily backups' key pair once
  (the public half goes in `wrangler.jsonc` as `BACKUP_PUBLIC_KEY`).
- `node scripts/invite.mjs [--remote]`: make an invite code.
  `node scripts/recovery-code.mjs [<user-id>] [--remote]`: list accounts, or
  give one a new recovery code (only when its owner asks, has a recovery
  email, and has proved the address is theirs). `--email <address>` finds
  the account with that recovery email.
- `node scripts/backup.mjs --remote`: an extra encrypted backup on this
  computer, in `backups/`; deletes ones older than 30 days when it runs.
  `node scripts/restore-backup.mjs <file>` decrypts one, or one of the
  daily backups (`.json.gz.enc`, with the backup private key).
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
  It can be renamed, but not archived or deleted (the API refuses: the tie
  form, Calendar and Analytics rely on it), and edits can't change who it
  is (`is_self` is `createOnly` in `src/resources/config.js`; only adding a
  person, or an import into a journal without one, sets it). A unique index
  allows at most one. The People form shows "This is me" only on it, ticked
  and greyed out, and the People list keeps it at the top.
- **At most one default location** (`locations.is_default`, migration 0011;
  a unique partial index per owner). Setting one clears the old one in the
  same batch; archiving clears it, and an archived location can't be made
  the default. A new tie starts at it (`tie-form.js`); imports add one only
  if the journal has none.
- **Roles: one each for the two sides of a tie** (migration 0013): top,
  bottom, self tie, spotter, photographer, on ties and as a person's
  default role. The words shown for top and bottom are each account's
  (`users.top_label`, `bottom_label`; null for "top", "bottom"): always
  show a role through `roleName()` (public/js/roles.js), never the stored
  value. Stored role names are plain text, can't be another role's name,
  and the two must differ. Rigger and model are gone: the API and imports
  read them as top and bottom. A tie's type is one of `TIE_TYPES`
  (suspension, partial suspension, floor, hashira), required on ties
  (migration 0014; imports refuse a tie without one rather than guess)
  and optional on plans (`plans.tie_type`).
- **A plan's type** (`plans.plan_type`: idea, harness or sequence; default
  idea) replaced Stage on the form. `stage` stays in the database and the
  export, but is `createOnly`, so editing a plan leaves it as it was.
- **Multi-statement writes go in one `env.DB.batch([...])`**, which runs as a
  single transaction, so a failure saves nothing.
- **Notes, descriptions and album links are encrypted** (`ties.notes`,
  `ties.album_url`, `tie_participants.notes`, `people.notes`,
  `profile_notes.description`, `locations.notes`, `plans.description`,
  `plans.notes`, `plans.album_url`): parse them with
  `encryptedText`, never `cleanText`; the server never reads, compares,
  searches or sorts by them. The page seals before sending (`vault.seal`,
  `sealOne`) and opens what it shows (`vault.open`). A new encrypted field
  goes in both lists (`crypto/fields.js`, `src/encryption/config.js`).
  Anything that changes a tie's notes or title, or a plan's title, calls
  `forgetSearch()`. The server can't check an album link, so the page does
  (`links.js`: http or https only), before sealing it and again before
  making one clickable.
- **Photo files live in R2, outside D1's transactions.** Anything that
  deletes `media` rows (directly or by cascade: a tie, a plan, the account,
  a new key) must then delete their files (`media/storage.js`); read the
  photo ids in the same batch as the delete. The daily sweep only catches
  what a crash left behind.
- **Photos are prepared and sealed before they leave the device**
  (`preparePhoto`, then `vault.sealPhoto`) and shown only from
  `photoUrl()` (`photo-urls.js`), whose URLs are all revoked on every lock
  (`onWipe`). The crypto Worker fetches photos itself (`openPhoto` takes an
  id), as it does the search index. Captions are sealed bound to their
  photo (`sealCaption`), not through `seal`, so they aren't in the
  encrypted-columns lists.
- **Wrapped keys (`key_wraps`) are never exported** (useless without the
  user's secrets); they go with their passkey or account.
- **Notices are ours, not the journal's**: export lists the ones just for me
  and the ones I dismissed (`account.notices`); import ignores them. They're
  plain text on the page (`textContent`), never HTML.
- **Feedback is plain text, for us to read**: never encrypted, so the form
  warns not to put journal details in it. Export lists it
  (`account.feedback`); import ignores it; it's deleted with the account.
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
  `--danger`, `--danger-text`, and the charts' `--chart-yellow`, `-purple`,
  `-teal`, `-coral`, `-grey`, used through the classes `c-yellow` and so
  on), redefined for dark mode in `:root[data-theme="dark"]`. Never
  hard-code colors elsewhere. Charts: yellow for top and plain bars, purple
  for bottom, teal for self tie; tie types yellow, purple, teal, coral.
- **Light/dark mode is an account setting** (`users.theme`), the same on
  every device: new accounts start dark, and the switch in Settings
  (`settings-dialog.js`) changes it at once and saves it. The device's own
  setting isn't followed. The last mode shown is also kept in
  localStorage (`light`/`dark`) and applied before the page draws by
  `public/js/theme-init.js` (dark if none), a plain script in the `<head>`
  of `index.html` and `privacy.html`; once unlocked, `settings.js` applies
  the account's. `theme.js` holds the pure logic.
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

The plan and reasons are in considerations.md ("Privacy and
accounts"); [PRIVACY.md](PRIVACY.md) is the policy. Keep it true: when a
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
  without proof (an existing wrap and its secret, given just now). The
  encrypted notes' operations work on whole records, never a general
  decrypt. Nothing decrypted goes to localStorage, sessionStorage,
  IndexedDB or a cache. Anything that ends the session or signs out must
  `lock()`.
- **Sensitive account changes need a fresh session** (`isFresh`: signed in in
  the last 10 minutes): adding or removing a passkey, replacing the recovery
  code, setting or removing the recovery email, deleting the account. Throw `NeedsReauth`; the page asks for the passkey again
  (`withReauth`). New sensitive actions should do the same.
- **Only hashes of secrets are stored**: session tokens, invite codes,
  recovery login secrets. **A recovery email never leaves the browser**
  either: only its salted PBKDF2 hash (`public/js/recovery-email.js`).
