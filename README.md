# NōtoNawa

code repo for custom app for rope planning and journalling

## How the app is structured

NōtoNawa is a private rope journal. It runs on Cloudflare: a Worker serves
the API and the static files, D1 (SQLite) holds the data, and R2 holds
photos and backups. There's no framework and no build step. Both the server
and the browser are plain JavaScript ES modules, type-checked from JSDoc
comments.

### 1. Requests and hosting (`wrangler.jsonc`)

- Anything under `/api/` goes to the Worker in `src/`.
- Everything else is a static file from `public/`. An address that isn't a
  file gets `index.html`, because the app is a single page.
- Bindings: `DB` is the D1 database, `PHOTOS` and `BACKUPS` are R2 buckets,
  and `AUTH_RATE_LIMIT` limits sign-in requests per IP. A daily scheduled
  job does the cleanup and the backup.

### 2. Server (`src/`)

`src/index.js` does the routing. It catches every error (`errors.js` turns
errors into responses) and adds the security headers
(`security-headers.js`). It also refuses most requests with a 403 when the
user has to agree to a changed privacy policy first (`consent/`). Shared
helpers are `http.js` (`json`, `readJson`, `BadInput`), `parse.js` (field
parsers) and `sql.js` (`NOW`).

Each feature folder is split the same way:

- `parse.js` / `config.js` hold the pure logic (validation and shaping
  data, no I/O) and get unit tests.
- `db.js` holds the D1 queries. Every query is scoped with `owner_id = ?`,
  and multi-step writes go in one `env.DB.batch([...])`, which runs as a
  single transaction.
- `routes.js` holds the HTTP handlers.

| Folder | What it does |
|---|---|
| `auth/` | Passkey (WebAuthn) sign-up and sign-in, sessions, the `__Host-session` cookie, recovery codes |
| `account/` | Passkeys, sessions, recovery email, settings (role names, light/dark mode), deleting the account |
| `keys/`, `encryption/` | Stores the wrapped encryption keys. Lists the encrypted columns and seals older plain text |
| `resources/` | Plans, people and locations, all handled by one shared set of routes described in the `RESOURCES` table |
| `locations/` | Reads coordinates out of Google Maps links, following short links |
| `ties/`, `tags/`, `stats/` | Ties (search, paging, roles, tie types), tags, and the data behind Analytics |
| `media/` | Photos: the rows in D1, the files in R2, and a daily sweep for files whose rows are gone |
| `data/` | Export and import ("Your data") |
| `backup/` | The daily encrypted backup into R2. The Worker can seal backups but can't open them |
| `notices/`, `consent/` | Banners from us, and asking users to agree again after a policy change |

`migrations/0001…0013` are the only way the database schema changes. The
database also enforces ownership itself: triggers reject links between
different users' rows.

### 3. The page (`public/`)

- **App shell:** `index.html` has one `<template id="view-…">` per view.
  - `js/app.js` shows the view for the current address and handles
    Back/Forward.
  - `router.js` (pure) lists the routes, and `navigate.js` changes the view
    from code.
- **Views:** each file in `js/views/*.js` exports `mount(root, { signal })`.
  The signal aborts when you leave the view, so listeners and timers stop
  with it.
  - The journal views are ties, plans, people, locations, calendar and
    analytics.
  - The rest are account, data, sign-in, unlock, consent and not-found.
  - A view that needs the encryption key shows the Unlock view in its place
    while the journal is locked.
- **Encryption on the device:** notes, descriptions and photos are
  encrypted in the browser before they're sent.
  - `crypto/` holds the pure crypto code.
  - `crypto-worker.js` is a Web Worker that holds the key in a form that
    can't be extracted.
  - `vault.js` is how the page talks to that Worker (unlock, lock, seal,
    open).
  - The server only ever stores encrypted text, so keyword search happens
    on the device (`search-match.js`).
- **UI pieces:** `tie-form.js`, `tag-picker.js`, `search-picker.js`,
  `charts.js`, `tie-card.js`, `resource-page.js`, `photos-ui.js`, plus small
  helpers (`dom.js`'s `h()`, `dialog.js`'s `choose()`, `api.js`).
- **Pure modules alongside them:** for example `stats.js`, `list-order.js`,
  `import-csv.js`, `photo-fit.js` and `zip.js` (zip files for exports that
  include photos).
- **Styles and headers:** `app.css` defines colors as CSS variables, with a
  dark theme. `_headers` sets the pages' strict CSP: no inline scripts or
  styles, nothing from other sites.

### 4. Tests and scripts

- **`test/unit/`** tests the pure logic.
- **`test/api/`** sends real requests to the Worker with a real D1 database
  built from the migrations. It signs in through `helpers.js`, and
  `fake-passkey.js` is a software passkey for the sign-in tests.
- **`test/db/`** tests the rules the database enforces itself.
- **`scripts/ui-smoke.mjs`** walks through every page in headless Chrome,
  in chunks (`scripts/ui/chunks/`) that each start from a new account.
  It also fails on any CSP violation or any input missing its privacy
  attributes.
- **Admin scripts in `scripts/`:** `invite.mjs` (invite codes),
  `notice.mjs`, `backup.mjs` / `restore-backup.mjs`, `recovery-code.mjs`,
  `privacy-html.mjs` (builds `privacy.html` and `src/policy-version.js` from
  PRIVACY.md).
- **Commands:** `npm run check` runs lint, type check and tests.
  `npm run test:ui` runs the walkthrough, 3 chunks at a time (`-- --only
  <chunks>` for some of it, `-- --jobs 1` for one at a time). `npm run check:changed` runs only what the changed files need
  (`scripts/areas.mjs`), with `-- --ui` for their walkthrough chunks.

### Summary

Pure logic is kept apart from I/O on both the server and the page. Every
row belongs to one user, and the database checks that too. Anything private
is encrypted in the browser, so the server only stores and returns
encrypted data.

For the full rules and a file-by-file layout, see [CLAUDE.md](CLAUDE.md);
for design decisions, see [considerations.md](considerations.md); for
planned features still to build, see [roadmap.md](roadmap.md).
