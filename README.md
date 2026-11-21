# nōtonawa

Code repo for a custom app for rope planning and journalling, live at
[notonawa.app](https://notonawa.app).

## How the app is structured

nōtonawa is a private rope journal. It runs on Cloudflare: a Worker serves
the API and the static files, D1 (SQLite) holds the data, and R2 holds
photos, videos and backups. There's no framework and no build step. Both the
server and the browser are plain JavaScript ES modules, type-checked from
JSDoc comments.

Almost everything private is encrypted in the browser before it's sent, so
the server stores and returns sealed data it can't read. Accounts are moving
from the original layout ("format 1", plain rows with encrypted columns) to
"format 2", where each journal entry is one sealed record. New sign-ups
start in format 2, and older accounts convert on the device at their next
unlock (`src/format.js`, `src/convert/`, `public/js/convert/`).

### 1. Requests and hosting (`wrangler.jsonc`)

- Anything under `/api/` goes to the Worker in `src/`.
- Everything else is a static file from `public/`. An address that isn't a
  file gets `index.html`, because the app is a single page.
- The app lives only at notonawa.app (the workers.dev address is off).
  A separate copy for testing runs at dev.notonawa.app (`env.dev`) with its
  own database and photos bucket.
- Bindings:
  - `DB` is the D1 database.
  - `PHOTOS` and `BACKUPS` are private R2 buckets.
  - `AUTH_RATE_LIMIT`, `SHARE_RATE_LIMIT`, `MAILBOX_RATE_LIMIT` and
    `LINK_RATE_LIMIT` limit sign-ins, opened shares, mailbox messages and
    new-device sign-ins.
  - `FEEDBACK_EMAIL` sends an email when a bug report or idea comes in.
- Scheduled jobs: once a day, the encrypted backup and the cleanup (ended
  sessions, expired challenges, expired shares, orphaned photo files).
  Every 5 minutes, notices posted with `--push` go out as notifications.
- No request logs are stored (`observability` is off).

### 2. Server (`src/`)

`src/index.js` does the routing. It catches every error (`errors.js` turns
errors into responses) and adds the security headers
(`security-headers.js`). It refuses most requests with a 403 when the user
has to agree to a changed privacy policy first (`consent/`), and applies the
format gate (`format.js`) to every signed-in request. Shared helpers are
`http.js` (`json`, `readJson`, `BadInput`), `parse.js` (field parsers) and
`sql.js` (`NOW`).

Each feature folder is split the same way:

- `parse.js` / `config.js` hold the pure logic (validation and shaping
  data, no I/O) and get unit tests.
- `db.js` holds the D1 queries. Every query is scoped with `owner_id = ?`,
  and multi-step writes go in one `env.DB.batch([...])`, which runs as a
  single transaction.
- `routes.js` holds the HTTP handlers.

| Folder | What it does |
|---|---|
| `auth/` | Passkey (WebAuthn) sign-up and sign-in, sessions, the `__Host-session` cookie, recovery codes. Sign-up is invite-only |
| `account/` | Passkeys, sessions, recovery email, settings (role names, light/dark mode), deleting the account |
| `link/` | Signing in on a new device using one that's already signed in |
| `keys/`, `encryption/` | Stores the wrapped encryption keys. Lists the encrypted columns and seals older plain text |
| `identity/` | Each account's public X-Wing key (format 2), used to seal messages to contacts |
| `records/` | Format 2 sealed records and syncing them to the device's cache |
| `files/` | Format 2 photos and videos in R2 (the row holds only sizes) |
| `convert/` | Converting an account from format 1 to format 2 (the device does the work) |
| `resources/` | Plans, people and locations, all handled by one shared set of routes described in the `RESOURCES` table |
| `locations/` | Reads coordinates out of Google Maps links, following short links |
| `ties/`, `tags/`, `stats/` | Ties (search, paging, roles, tie types), tags, and the data behind Analytics |
| `workshops/` | Workshops, for the Education view |
| `media/` | Format 1 photos and videos: the rows in D1, the files in R2, and a daily sweep for files whose rows are gone |
| `drawings/`, `poses/`, `pose-presets/` | Drawings, 3D poses and saved poser presets on ties, plans and workshops |
| `visuals/` | The shared order of an item's photos, videos, drawings and poses |
| `shares/` | Sealed copies of a profile, tie, plan or workshop that someone else opens with a link |
| `connections/`, `mailboxes/` | Connections between accounts, and where their devices leave each other sealed messages |
| `push/` | Web Push notifications (VAPID and RFC 8291 encryption written in-house) |
| `data/` | Export and import ("Your data") |
| `backup/` | The daily encrypted backup into R2. The Worker can seal backups but can't open them |
| `notices/`, `consent/` | Banners from us, and asking users to agree again after a policy change |
| `feedback/` | Bug reports and ideas sent from the app |
| `version/` | `GET /api/version`, so open pages know when to reload after a deploy |

`migrations/0001…0035` are the only way the database schema changes. The
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
  - The journal views are ties, plans, people, locations, calendar,
    analytics and education (workshops).
  - The rest are account, data, open (shared with you), verify (contacts'
    safety numbers), link (sign in on a new device), sign-in, unlock,
    consent, convert and not-found.
  - A view that needs the encryption key shows the Unlock view in its place
    while the journal is locked.
- **Encryption on the device:**
  - `crypto/` holds the pure crypto code: the data key and its wraps,
    records, files, shares, contacts' keys and safety numbers.
  - `crypto-worker.js` is a Web Worker that holds the unlocked key, so the
    page never has it. `vault.js` is how the page talks to it.
  - `cache/` keeps format 2 records in IndexedDB, still sealed, and syncs
    them with the server.
  - The server only ever stores encrypted text, so keyword search happens
    on the device (`search-match.js`).
- **Poser and drawings:** `pose-*.js` is a 3D figure poser built on
  three.js, with the body mesh in `public/figure/`. `drawing-*.js` is a
  freehand drawing pad. `standalone-poser.js` opens the poser on its own.
- **Sharing and contacts:** `share-*.js`, `connections.js` and
  `contact-*.js`. A share link's key stays after the `#`, so it never
  reaches the server. `qr.js` draws the link's QR code.
- **Installing and notifications:** `manifest.webmanifest` lets phones add
  the app to the home screen. `sw.js` is a service worker used only for
  push notifications (`push.js`). It caches nothing.
- **UI pieces:** `tie-form.js`, `plan-form.js`, `workshop-form.js`,
  `tag-picker.js`, `search-picker.js`, `charts.js`, `world-map.js`,
  `tie-card.js`, `resource-page.js`, `photos-ui.js`, `tour.js` (the welcome
  tour), plus small helpers (`dom.js`'s `h()`, `dialog.js`'s `choose()`,
  `api.js`).
- **Pure modules alongside them:** for example `stats.js`, `list-order.js`,
  `import-csv.js`, `photo-fit.js` and `zip.js` (zip files for exports that
  include photos).
- **Styles and headers:** `app.css` defines colors as CSS variables, with a
  dark theme. `_headers` sets the pages' strict CSP: no inline scripts or
  styles, nothing from other sites, and Trusted Types so the browser refuses
  `innerHTML`.

### 4. Tests and scripts

- **`test/unit/`** tests the pure logic in plain Node.
- **`test/api/`** sends real requests to the Worker with a real D1 database
  built from the migrations. It signs in through `helpers.js`, and
  `fake-passkey.js` is a software passkey for the sign-in tests.
- **`test/db/`** tests the rules the database enforces itself.
- **`scripts/ui-smoke.mjs`** walks through every page in headless Chrome,
  in chunks (`scripts/ui/chunks/`) that each start from a new account.
  It also fails on any CSP violation or any input missing its privacy
  attributes.
- **Admin scripts in `scripts/`:**
  - `invite.mjs` (invite codes), `recovery-code.mjs`, `notice.mjs`,
    `feedback.mjs` (read bug reports and ideas).
  - `backup.mjs` / `restore-backup.mjs`, `backup-keys.mjs` and
    `push-keys.mjs` (make the key pairs).
  - `privacy-html.mjs` (builds `privacy.html` and `src/policy-version.js`
    from PRIVACY.md), `releases.mjs` (builds the in-app release notes from
    RELEASES.md).
  - `vendor.mjs` (copies the browser libraries into `public/js/vendor/`),
    `world-map.mjs` (builds the Analytics map outlines), `figure/` (Python,
    rebuilds the poser's body).
  - `release-cleanup.mjs` (one-off, after the format 2 release).
  - The database scripts take `--remote` for production or `--dev` for
    dev.notonawa.app.
- **Commands:**
  - `npm run dev` runs the app on localhost against the dev environment's
    database and photos bucket.
  - `npm run check` runs lint, type check and tests, and checks that the
    generated files (privacy page, release notes, vendored libraries) are
    up to date.
  - `npm run check:changed` runs only what the changed files need
    (`scripts/areas.mjs`), with `-- --ui` for their walkthrough chunks.
  - `npm run test:ui` runs the walkthrough, 3 chunks at a time (`-- --only
    <chunks>` for some of it, `-- --jobs 1` for one at a time, `-- --format
    2` on format 2 accounts).
  - `npm run deploy:prod` / `npm run deploy:dev` deploy with a new version
    (the UTC date and time) so open pages reload. Always deploy this way,
    not with `npx wrangler deploy`.

### Summary

Pure logic is kept apart from I/O on both the server and the page. Every
row belongs to one user, and the database checks that too. Anything private
is encrypted in the browser, so the server only stores and returns
encrypted data.

For the full rules and a file-by-file layout, see [CLAUDE.md](CLAUDE.md);
for design decisions, see [considerations.md](considerations.md); for
planned features still to build, see [roadmap.md](roadmap.md); for what
changed in each release, see [RELEASES.md](RELEASES.md); for the privacy
policy, see [PRIVACY.md](PRIVACY.md).

## Tech stack

### Platform

| What | Used for |
|---|---|
| Cloudflare Workers | The API (`src/`) and serving the static files in `public/` |
| Cloudflare D1 (SQLite) | All account and journal data. Schema changes only via `migrations/` |
| Cloudflare R2 | Encrypted photos and videos (`PHOTOS`) and the daily encrypted backups (`BACKUPS`) |
| Workers Rate Limiting | Per-IP and per-account limits on sign-in, shares, mailboxes and device linking |
| Cron Triggers | The daily backup and cleanup, and sending pushed notices every 5 minutes |
| Email Workers (`send_email`) | Telling us a bug report or idea came in (only its kind, never its text) |

### Frontend

| What | Used for |
|---|---|
| Plain JavaScript ES modules | The whole app. No framework and no build step: files are served as they are |
| Single page with `<template>`s | One `index.html`, one template per view |
| Custom History API router | Routing (`router.js`, `navigate.js`, `app.js`) |
| Plain modules for state | Each view's state lives inside its `mount(root, { signal })`. The key lives only in the crypto Web Worker. Settings are stored on the server |
| Hand-written CSS | One `app.css` with CSS variables, and light/dark mode as an account setting |
| Custom SVG | Charts (`charts.js`, `chart-parts.js`), the Analytics world map (`world-map.js`, no map tiles or map library) and icons (no icon library) |
| Built-in `Date` and `Intl` | Dates (`format.js`), stored as ISO text. No date library |
| Custom DOM helpers | `dom.js` (`h`, `$`, `privateField`). Never `innerHTML` |

### Browser APIs

| What | Used for |
|---|---|
| WebAuthn (passkeys) with the PRF extension | Signing in, and making the key that unlocks the journal |
| Web Crypto | AES-256-GCM, HKDF and SHA hashing for everything encrypted on the device |
| Web Workers | Holding the unlocked key apart from the page (`crypto-worker.js`) |
| IndexedDB | The format 2 cache of sealed records (`cache/`) |
| WebCodecs (through mediabunny) | Re-encoding videos on the device before upload |
| Service Worker and Push API | Push notifications only (`sw.js`, `push.js`) |
| Web App Manifest | Adding the app to a phone's home screen |
| Screen Wake Lock | Keeping the screen on while the poser is open (`wake-lock.js`) |
| `DecompressionStream` | Reading zip files on import (`zip.js`) |

### Libraries

| Library | Where | Used for |
|---|---|---|
| `@simplewebauthn/server` 14.0.3 | Worker | Checking passkey sign-ups and sign-ins. The only runtime dependency |
| `mediabunny` 1.61.3 | Browser (vendored) | Reading and re-encoding videos (`video-prep.js`) |
| `three` 0.186.1 | Browser (vendored, only the parts used, bundled with esbuild) | Drawing the poser's 3D figure (`pose-scene.js`) |
| `hpke` 1.1.8 with `@panva/hpke-noble` 1.1.8 | Browser (vendored, bundled with esbuild) | Post-quantum (X-Wing) public-key encryption for contacts and device linking |
| `uqr` 0.1.3 | Browser (vendored) | Working out a share link's QR code. We draw the squares ourselves (`qr.js`) |

Browser libraries are installed as dev dependencies and copied into
`public/js/vendor/` by `scripts/vendor.mjs`, with their versions pinned in
`package.json`. Nothing loads from another site.

### Data and assets

| What | Used for |
|---|---|
| [Anny](https://github.com/naver/anny) (NAVER, Apache 2.0), on MakeHuman's CC0 body | The poser's body mesh and skeleton (`public/figure/`, `figure-body-data.js`) |
| Python with Anny and PyTorch | Only for rebuilding the body (`scripts/figure/`), kept outside the repo |
| Natural Earth 1:110m countries | The Analytics map's country outlines (`world-shapes.js`) |

### Tooling (dev only)

| Tool | Used for |
|---|---|
| Wrangler 4 | Running locally, deploying, D1 migrations and queries, and bundling the Worker |
| esbuild (comes with Wrangler) | Bundling the vendored three.js and hpke |
| TypeScript 7 | Type checking the JS through JSDoc (`checkJs`, strict). No compiled output |
| ESLint 10 with `@eslint/js` and `globals` | Linting |
| Vitest 4 with `@cloudflare/vitest-plugin` | Unit tests in Node, and API and database tests inside the Workers runtime |
| Google Chrome over the DevTools protocol | The UI walkthrough (`scripts/ui-smoke.mjs`), with no npm packages |
