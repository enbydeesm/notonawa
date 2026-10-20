# Considerations

Design ideas we've weighed, planned features, and the reasons behind them, so
we can revisit them later.

## Privacy and accounts

**Status:** built and deployed (all 13 migrations applied to the remote
database, checked 2026-10-19). Videos aren't built: they're in
[roadmap.md](roadmap.md).

Goal: open the app to other users, with notes and photos end-to-end encrypted
so that even we (and Cloudflare) can't read them. [PRIVACY.md](PRIVACY.md)
describes the result; keep it in step with what's built.

### The features, in the order they were built

Each one left the app working and shippable on its own.

- **Hardening baseline.** *Built 2026-10-12.* Security headers on every
  response (strict CSP with Trusted Types, `Cache-Control: no-store` on
  pages and API, `Referrer-Policy: no-referrer`, `nosniff`,
  `frame-ancestors 'none'`, COOP/CORP, `Permissions-Policy`, HSTS). The
  search keyword left the page URL and the API URL (`POST
  /api/ties/search`, keyword in the body only, never in history). Free-text
  fields get `autocomplete="off"` and `spellcheck="false"`. No stored
  request logs. *First because it was small, needed no packages or
  migrations, and closed leaks that existed then (search words in browser
  history and request logs).* The Worker's headers
  (`src/security-headers.js`) and the static files' (`public/_headers`)
  are the same apart from the CSP, and a unit test checks they stay that
  way: on 2026-10-19 the Worker was found to be missing
  `Permissions-Policy`.
- **Passkey sign-in and app sessions** (replaced Cloudflare Access).
  *Built 2026-10-13; see "Passkey sign-in as built".* WebAuthn registration
  and sign-in in the Worker; `__Host-` session cookie (`HttpOnly; Secure;
  SameSite=Strict`, 30 days max, 7 days idle) with only a SHA-256 hash of
  the token stored; Origin check on writes; rate-limited sign-in; several
  passkeys per account; recovery code; "your sessions" with sign out
  everywhere; 18+ confirmation and consent for sensitive data at sign-up.
  Registration asks for the PRF extension and records whether each passkey
  supports it. The existing account was moved across. No email is
  collected: `users.email` now just holds the user's id (see "Passkey
  sign-in as built"). *Before encryption because the keys hang off
  passkeys and the recovery code.*
- **Account export, import and deletion**, plus the retention rules in
  PRIVACY.md: JSON export, delete-account (one cascading delete), encrypted
  operator backups with a fixed retention, and import (from an export or a
  CSV). *Built 2026-10-13; see "Export, import and deletion as built".*
  *Built before encryption while it was simple; the encryption features
  each extended it.*
- **Optional recovery email**, stored only as a salted hash, so the
  operator can check that someone asking to recover an account owns it.
  PRIVACY.md strongly recommends a second passkey and the recovery code,
  and says recovery isn't guaranteed. *Built 2026-10-14; see "Recovery
  email as built".*
- **Single-page app** (no change in behaviour). One document with a
  client-side router; the pages became views (`<template>`s in
  `index.html` plus a module per view, loaded with `import()`), each with
  an AbortController so nothing leaks between views. Sign-in became a
  view; the privacy page stays a static page, opened from the app in a new
  tab. *Needed because the key lives only in a Worker's memory: in a
  multi-page app every tab change is a page load, which kills the Worker
  (and fires `pagehide`), so each one would mean using the passkey again,
  and even sign-in → home would lose the key.* Decided and *built
  2026-10-14; see "Single-page app as built".*
- **Encryption foundation** (built on the single-page app). Per-user random
  data key (AES-256-GCM), wrapped by a key derived from each passkey's PRF
  output and by the recovery code; wrapped copies stored on the server. A
  dedicated Web Worker holds the non-extractable key and all decrypted
  data; pages ask it for results only. Lock (drop key and plaintext, clear
  rendered notes) after 15 min idle, 5 min hidden, on sign-out and on
  `pagehide`; unlock with the passkey. Nothing decrypted goes to
  localStorage, sessionStorage, IndexedDB or a service-worker cache.
  *Built 2026-10-14; see "Encryption foundation as built".*
- **Encrypted notes and on-device search.** The free-text fields are
  encrypted: `ties.notes`, `tie_participants.notes`, `people.notes`,
  `profile_notes.description`, `locations.notes`, `plans.description`,
  `plans.notes`. Older plaintext is encrypted by the browser after unlock
  and overwritten. Keyword search moved into the crypto Worker (matching
  with `toLocaleLowerCase`, which also fixed "Keyword search ignores case
  for A–Z only" below); the server takes a list of matching tie ids
  instead of a keyword, and `q` left the API entirely. Export decrypts on
  the device. *Before photos because it removed plaintext that existed,
  and it built the crypto Worker plumbing photos reuse.* *Built
  2026-10-14; see "Encrypted notes as built".*
- **Encrypted photos.** Private R2 bucket (no public access, no `r2.dev`
  URL); the browser strips metadata by redrawing the image on a canvas
  (`createImageBitmap` applies the EXIF rotation first), makes a thumbnail,
  encrypts both and uploads through an owner-checked Worker route. Shown
  from `blob:` URLs that are revoked on lock. Deleting a tie, plan or the
  account deletes its R2 objects; export includes decrypted photos.
  *Built 2026-10-14; see "Encrypted photos: decisions" and "Encrypted
  photos as built".*
- **Videos** come after photos and aren't started: see
  [roadmap.md](roadmap.md), which also has what we weighed. Photos were
  built so videos need no new migration or export format.

### Decided along the way

- **Passkeys only; no passwords, email sign-in, or Google/Apple sign-in.**
  Third-party sign-in tells that company the user has an account here, and
  email would be another identifier to protect. Recovery is via a second
  passkey or the recovery code, and as a last resort the operator (only for
  accounts with a recovery email; see "Recovery email as built").
- **Encryption foundation design notes** (2026-10-14, from planning; as
  built, with the changes from review, in "Encryption foundation as
  built"):
  - Sign-in is discoverable (no `allowCredentials`), so PRF can't use
    `evalByCredential`: one fixed app-wide salt in `prf.eval.first`, and
    HKDF(PRF output, a random salt per wrap, info "notonawa wrap v1")
    gives the wrapping key. The recovery code's wrapping key uses HKDF with
    another `info` than "login".
  - Each wrap is bound to its user, wrap id and version as AES-GCM
    additional data, so the server can't swap one wrap for another.
  - The everyday data key is non-extractable. Rewrapping (adding a passkey,
    a new recovery code) happens at "Confirm it's you", whose passkey use
    gives the PRF output again: unwrap an extractable copy just long enough
    to wrap it again.
  - PRF results at registration are patchy, so a new passkey often needs a
    follow-up `get()` with that credential to wrap the key for it.
  - The existing account had no wrapped key, and the browser never had its
    recovery code: first unlock runs a one-time setup that also makes a new
    recovery code.
  - An operator-made recovery code has no wrap, so that account signs in but
    can't unlock: the app needs a "start a new key" state.
  - `new Worker(url)` is a Trusted Types sink, and `trusted-types 'none'`
    forbids every policy: the crypto Worker needs a named policy allowing
    only its URL, plus `worker-src 'self'`.
  - The PRF output passes through the page (`navigator.credentials` only
    runs there): transfer the buffer to the Worker so the page's copy is
    emptied. PRIVACY.md says so.
  - Wraps are checked by unwrapping them before upload: the server can't
    tell a bad wrap from a good one.
  - Once notes are encrypted, the recovery email's ⓘ text should add that
    a recovery never brings back encrypted notes and photos. (Done: it
    says signing in that way doesn't unlock them.)
- **Titles, names, dates, ratings, links, tags, location coordinates and map
  links stay readable by the server** so filtering, sorting and paging keep
  working server-side. PRIVACY.md says so plainly. **Revisit** encrypting
  people's names and location coordinates/map links, now that encrypted
  notes are done.
- **Passkeys without PRF** unlock with the recovery code. **Revisit** if that
  turns out to be common enough to need a passphrase option.
- **Spellcheck is off** (`spellcheck="false"`) on free-text fields, along
  with `autocomplete="off"`. Basic spellcheck is local, but Chrome's opt-in
  "enhanced" spellcheck sends the text to Google, and we can't tell which one
  a user has on.
- **HSTS with `includeSubDomains`** (2026-10-14): the app moved from
  `workers.dev` (whose other subdomains aren't ours) to `notonawa.app`. The
  whole `.app` TLD is on browsers' HSTS preload list, so every subdomain is
  HTTPS-only regardless; preloading the domain itself would add nothing.
- **No stored request logs** (`observability.enabled: false`). Errors are
  only visible live with `wrangler tail`. Accepted (2026-10-12).
- **Packages per feature** (each needed approval when its work started):
  - Hardening baseline: none.
  - Passkey sign-in: verifying WebAuthn responses needs CBOR and COSE-key
    parsing and signature checks for several algorithms. Possible by hand
    with WebCrypto, but it's security-critical and easy to get subtly
    wrong, so the Worker uses `@simplewebauthn/server`. The browser side
    needs nothing: `navigator.credentials` plus
    `PublicKeyCredential.parseCreationOptionsFromJSON` /
    `parseRequestOptionsFromJSON`, with a small hand-written fallback for
    browsers without them.
  - Export and import, the recovery email, the encryption foundation and
    encrypted notes: none (WebCrypto does AES-GCM, HKDF and PBKDF2). CSV
    parsing and backup encryption are hand-written.
  - Encrypted photos: none for JPEG, PNG and WebP: redrawing on a canvas
    and re-encoding writes a new file that has no metadata. HEIC is the
    exception: only Safari decodes it. iPhones usually convert to JPEG when
    the file input `accept`s only JPEG/PNG/WebP, so that's what we rely on;
    no HEIC decoder.

### Passkey sign-in as built

- **`users.email` couldn't be dropped.** SQLite won't drop a UNIQUE column,
  and rebuilding `users` would cascade-delete every journal row (DROP TABLE
  runs an implicit DELETE). Migration 0003 overwrites each email with the
  user's id instead, and new users get email = id. Dropping the column at
  the next full table rebuild is in [roadmap.md](roadmap.md).
- **Moving the existing account:** no Access-and-passkeys overlap. After
  deploying, `node scripts/recovery-code.mjs <id> --remote` gave the
  account a recovery code; sign in with it and add a passkey. Then remove
  the Access application in Zero Trust.
- **Recovery code → login secret.** The browser derives a login secret
  (HKDF-SHA256, info "login") from the code and sends only that; the server
  keeps its SHA-256. The code is 160 random bits, so a fast hash is enough.
  The key-wrapping key is derived with a different `info` (see "Encryption
  foundation as built").
- **A recovery session** lasts 15 minutes and can only add a passkey,
  sign out, and read three things (`allowedInRecovery` in
  `src/auth/guard.js`): the account, my settings (so the right role names
  and light/dark mode show), and the wrapped keys (to unlock with the code
  and wrap the key for the new passkey). Adding a passkey turns it into a
  full session. The old code keeps working until a new one is set (the
  page does that straight after), so a crash mid-way can't lock anyone
  out.
- **"Confirm it's you"** (fresh session, 10 minutes) for adding or removing a
  passkey and replacing the recovery code, so a stolen session can't quietly
  take over the account. Renaming and ending sessions don't need it.
- **Removing a passkey ends the sessions it started** (`ON DELETE CASCADE`).
- **Invites:** 80-bit codes, single use, 14 days by default; the trigger on
  `invites` makes two sign-ups racing for one invite fail cleanly.
- **`prf_capable`** comes from the browser's `prf.enabled` at registration;
  NULL when it doesn't say (some only report PRF at sign-in). Sign-in and
  unlock fill unknowns in.
- **Rate limit:** 20 requests a minute per IP across `/api/auth/` (Cloudflare's
  rate-limit binding, counted in memory).

### Export, import and deletion as built

- **Export** (`GET /api/data/export`, the "Your data" page): one JSON file,
  `format: "notonawa-export"`, `version: 1`. Items keep their ids so the
  file's links can be followed and rebuilt; deleted links stay as null ids
  and `location_deleted`. Account details are only dates, the terms version
  and passkey names: no hashes, public keys or sessions. The page fetches it
  and saves it from a `blob:` URL (revoked after 10 s) rather than linking to
  the route, so it can decrypt on the device first.
- **Photos in exports**, decided before photos were built: the export
  becomes a `.zip` holding `notonawa.json` and a `photos/` folder, files
  named by photo id. Each tie and plan lists its photos in `photos: [{ id,
  file, caption, position, created_at }]`, `file` being the path inside the
  zip, so the JSON stays the record of what's attached where (titles repeat
  and change; ids don't). The browser builds the zip, because only it can
  decrypt the photos: a store-only zip (JPEGs are already compressed) is
  ~100 lines with a CRC32, no package. Import then saves the journal first
  and uploads each photo afterwards, one by one, to the new tie or plan id
  (R2 uploads can't be in a D1 transaction). `photos` was in version 1 from
  the start, so photos needed no new version; import accepts both `.json`
  and `.zip`. Not chosen: base64 inside the JSON (a third bigger, one huge
  file, photos not viewable) or a separate photo download (the link
  depends on keeping two files together).
- **Delete account** (`DELETE /api/account`): needs a fresh session and
  typing "delete". One `DELETE FROM users` cascades through everything
  (tested table by table, and that other users are untouched). Then the page
  calls `PublicKeyCredential.signalUnknownCredential` where the browser has
  it, so the passkey can disappear from the user's password manager.
- **Daily cleanup:** a cron trigger (`src/cleanup.js`) deletes ended
  sessions and expired challenges, as PRIVACY.md promises.
- **Backups:** `scripts/backup.mjs --remote` exports D1 and encrypts it
  (PBKDF2-SHA256 600k + AES-256-GCM via WebCrypto, header authenticated).
  The plaintext backups from earlier migrations were deleted (2026-10-13).
  **Kept 30 days** (`RETENTION_DAYS` in `scripts/backup-lib.mjs`), as
  PRIVACY.md says; confirmed 2026-10-19. It first kept 7, matching D1's
  rolling history on the Free plan, and had to run weekly for that to
  hold. Since the Worker's own daily backup (see "Notices, agreeing to
  policy changes, and daily backups" below, also 30 days), this script is
  only an extra copy on the Mac, and deletes old ones only when it runs,
  so it should run at least monthly. PRIVACY.md's "up to 30 days" for
  D1's own history covers both the Free plan's 7 days and Paid's 30.
- **Import**: from an export, or a CSV of ties (one per row:
  date, title, type, duration, rating, location, latitude, longitude, people
  as `Sam (bottom); Alex (top)` (my own names for top and bottom, and the old
  rigger and model, work too), plans, tags, notes; `/import-template.csv`).
  Decided:
  - **Coordinates are the location's**, so latitude and longitude (both or
    neither, the location form's limits) go with a row's location. Giving
    them on one row is enough; a different pair for the same name later is
    an error, not a silent pick. Like any matched item, a location already
    in the journal keeps its own coordinates. (Added 2026-10-17.)
  - **CSV is ties only.** People, locations and plans named in it that the
    journal doesn't have are created.
  - **Matched by name**, ignoring capitals (exact spelling first, active
    before archived); the file's "this is me" matches the user's own. A
    matched item is used as it is, never changed, so its details in the file
    (notes, profile notes, tags) aren't imported.
  - **Exact duplicate ties are skipped:** the same date, title, notes, type,
    location, duration, rating, people (with roles), plans and tags as one
    already in the journal. Two identical ties within one file are both kept.
    (Until 2026-10-13 only date, title and notes were compared, so two
    untitled, note-less ties on the same day counted as one even with
    different people. created_at isn't compared: a CSV has none.)
  - **Fresh ids always.** File ids only link items within the file; the
    ownership triggers still check every link.
  - **Sent in parts** because of the Free plan's 10 ms CPU per request:
    items first (the answer maps file ids to journal ids), then ties in
    batches of 200, each all-or-nothing. If a batch fails, importing the same
    file again finishes the job: saved ties are skipped as duplicates, and
    items match by name. (One catch: two different people with the same name
    in a file, re-imported after a partial import, both match the first.)
  - **One statement per table**, not per row: rows go in as JSON and come
    back out with `json_each`, which stays under D1's 50 queries per request
    (Free) and 100 bound values per statement. Chunks stay under D1's 2 MB
    per value.
  - **Preview first:** both requests take `preview: true` and save nothing;
    the page shows what's new, what matched and how many ties are skipped
    before the user confirms.
  - **Encrypted notes:** the page encrypts notes before sending; it already
    built every request, so only that part was new (see "Encrypted notes as
    built", import duplicates).
- **Ties import keeps more than the tie form does:** participants' ratings
  and notes, plan versions, deleted links and timestamps, so an export
  round-trips exactly (tested).

### Recovery email as built

- **Recovery email, optional, hashed in the browser**
  (`public/js/recovery-email.js`): the address is trimmed and lower-cased,
  then PBKDF2-SHA256 with 600,000 rounds and a random 16-byte salt each time
  it's set. The browser sends `{ email_hash, salt }` to `PUT
  /api/account/recovery-email`; the server stores both
  (`users.recovery_email_hash`, `recovery_email_salt`, migration 0008) and
  refuses anything else, such as the address itself. Hashed in the browser
  because the Worker's 10 ms CPU limit (Free plan) can't run 600,000 rounds.
  The browser makes the salt (rather than asking the server for one) to
  save a request; it's not secret either way.
- **Why hashed, not stored as typed** (decided 2026-10-14): a leaked
  database doesn't list anyone's address, and testing guessed addresses is
  slow. The cost: we can never email users (announcements, breach notices
  go through the app). Recovery doesn't need email: the user writes to us.
- **Recovery by the operator:** `node scripts/recovery-code.mjs --email
  <address>` hashes the address with each account's salt (about 0.3 s each:
  fine for hundreds of accounts, slow for many thousands) and lists the
  match. Then the operator emails a one-time code to that address from
  their own mailbox and waits for it to come back, because a From address
  can be faked. Only then a new recovery code is set. Without a recovery
  email there's no way to check, so no help. Not limited to the operator's
  own account (decided 2026-10-14).
- **Setting, changing or removing it needs a fresh session**, so a stolen
  session can't make itself the way back in. Not allowed in a recovery
  session.
- **The account page** asks for the address twice (it can never be shown
  again, so a typo would make it useless). Once set it shows only "set",
  with Change and Remove. An ⓘ button next to the label shows or hides the
  explanation (a disclosure rather than a hover tooltip, so it works on
  touch screens; `infoButton` in `dom.js`).
- **Export** says only `recovery_email_set`; the hash and salt never leave
  the server. Import ignores it. Account deletion removes it with `users`.

### Single-page app as built

- **One page:** `public/index.html` holds the nav's place, `#view`, and a
  `<template>` per view with the markup the old pages had (moved over
  unchanged). Cloning a template is CSP- and Trusted-Types-safe and kept the
  markup as HTML rather than rewriting it as `h()` calls. The old
  `plans.html`, `people.html`, `locations.html`, `account.html`, `data.html`
  and `signin.html` are gone; `privacy.html` stays a static page.
- **Serving:** `not_found_handling: "single-page-application"` gives
  `index.html` (with the pages' CSP and `no-store`, checked) to any address
  that isn't a file, and `run_worker_first: ["/api/*"]` keeps the API with
  the Worker even for a page load. Unknown addresses (old `….html` ones
  included) show a "Page not found" view.
- **Views** (`public/js/views/`, moved from `pages/` with git history) export
  `mount(root, { signal })`; app.js loads each with `import()` from a fixed
  list (so the type checker follows it) and aborts the previous view's
  signal. The Ties view hangs its `popstate` and `TIE_SAVED` listeners, its
  `ResizeObserver` and its keyword timer off it; Locations its lookup timer.
- **History:** a link or `navigate()` adds an entry and always draws the view
  afresh, even the one already shown (as a page load did). Back and Forward
  change view only when the path's view changes: within Ties, its own
  `popstate` listener restores the filters and page. app.js's listener is
  registered first, so leaving Ties aborts it before its listener runs.
  Redirects (signed out → sign-in, signed in → journal, sign-out) replace
  the entry, so Back doesn't land on a page that only sends you on.
- **Scroll and focus:** a new view starts at the top; Back puts back the
  position saved on its entry (best effort: lists still loading may be
  shorter than it). Focus moves to the view's `<h1>` so screen readers
  announce the change (not on the first load).
- **Dialogs close on a view change**, as they vanished with the old page.
- **No loading indicator between views**: modules are small and same-origin;
  each view shows its own "Loading…" until its data arrives.
- **A missing file** (e.g. a mistyped script path) also gets `index.html`,
  which `nosniff` refuses to run as a script, so it fails loudly.

### Encryption foundation as built

- **Threat model, plainly:** the crypto Worker keeps the key from being
  *taken* (it's non-extractable, never sent anywhere, and only wrapped again
  with proof). It doesn't stop the key being *used* by script running in
  the page while unlocked: injected script or a browser extension could ask
  for and read what's shown. The defences against that are keeping such
  script out (strict CSP with Trusted Types, no third-party code) and
  limiting where data could go (`connect-src 'self'` stops `fetch` to other
  sites; it could still be written into a readable field through our own
  API, or carried off by navigating the page). PRIVACY.md says so. The
  Worker's operations for notes act on whole records (decrypt a tie's notes
  for display, search), never a general `decrypt(ciphertext)`: that limits
  misuse a little, not entirely.
- **Keys** (`public/js/crypto/keys.js`): one random AES-256-GCM data key per
  user. Wraps use AES-GCM `wrapKey` with a key from HKDF-SHA256(secret, a
  random 16-byte salt per wrap, info `"notonawa wrap v1 <kind> <user
  id>"`); the additional data is `notonawa|v<version>|<user
  id>|<wrap id>|<kind>`. The secret is a passkey's PRF output, or the
  recovery code (160 random bits, so HKDF is enough). The PRF salt is fixed
  (`SHA-256("notonawa prf v1")`): sign-in has no username, so it can't
  be per user before a passkey is chosen (Copilot's review suggested a
  per-user salt); the user id went into the HKDF info instead.
- **The Worker** (`crypto-worker.js`, logic in `crypto/vault-core.js`): holds
  the key non-extractable; `setup`, `unlock`, `addWrap`, `status`. Every
  wrap it hands out has been unwrapped once first. `addWrap` needs proof (an
  existing wrap and its secret, given just now), so a script in the page
  can't have the key wrapped for a secret it chose. PRF output is
  transferred to it (the page's buffer is emptied), and it zeroes PRF bytes
  after use; a typed recovery code is a string and can't be wiped.
- **`vault.js`** starts the Worker through the Trusted Types policy
  `crypto-worker` (allows only `/js/crypto-worker.js`; the CSP has
  `trusted-types crypto-worker` and `worker-src 'self'`). Locking is
  `worker.terminate()`.
- **PRF output is never sent.** `toJSON()` (and our fallback) copy the
  extension results, PRF output included; `withoutPrfResults` takes it out
  of every answer sent, and the walkthrough checks no request body has it.
  Sign-in sends only `prf: true`, which fills in `prf_capable`.
- **`prfOutputFor(credentialId)` is not a sign-in**: a `get()` with a
  challenge made in the browser, whose answer is never sent. It only gets
  PRF output from a passkey just made (devices that don't give it at
  creation), and must never stand in for proof of identity.
- **Server** (migration 0009, `src/keys/`): `key_wraps` (one per passkey,
  one recovery wrap per user, cascades with passkeys and users, replaced
  never updated, an ownership trigger). `GET /api/keys` (also in a recovery
  session), `POST /api/keys/setup` (fresh session; once, or `replace`),
  `PUT /api/keys/passkeys/:id` (fresh session). Sign-up needs the recovery
  wrap; adding a passkey takes its wrap; replacing the recovery code needs
  the new wrap once there's a key. Export leaves wraps out.
- **Recovery wraps remember their code** (the login secret's hash). After an
  operator reset the wrap no longer matches, `GET /api/keys` says
  `current: false`, and the next unlock (with a passkey or an older code)
  makes a new recovery code at once, so the old one doesn't keep working
  (from Copilot's review). In-app rotation always replaced the wrap.
- **Prompts:** sign-in and unlock 1; sign-up 1–2; add a passkey 2–3
  (proof first, as a server-checked sign-in that also freshens the session,
  then create, then maybe `prfOutputFor`); new recovery code 1; recovery
  sign-in 1–2. A passkey without a wrap unlocks with the code once, which
  wraps the key for it if it gives PRF output.
- **Locking** (`lock-rules.js`, `lock.js`): 15 minutes without taps, keys or
  scrolling; 5 minutes hidden (checked on return too, as background timers
  are slowed); `pagehide`; sign-out; the session ending (api.js). Routes
  have `needsKey`; while locked, app.js shows the Unlock view in their
  place at the same address, and redraws when the journal locks. Anything
  typed and not saved is lost on a lock.
- **Unlock view states:** locked (passkey or code), the recovery code
  (why: the passkey can't unlock, or can't yet), set up encryption (an
  account from before encryption: the first key and a new recovery code),
  and "that code can't unlock" (an operator reset with no older code:
  try another, or start a new key with `replace`).
- **Unlocking counts against the sign-in rate limit** (20 requests a
  minute per IP across `/api/auth/`; an unlock is 2). That's 10 unlocks a
  minute, plenty for a person. The UI walkthrough reloads far more often, so
  it runs `wrangler dev` with a generated copy of `wrangler.jsonc` whose
  limit is 1000; the app and its config are unchanged, and the limit is
  still tested in `test/api/auth.test.js`. A "limits off" switch in the
  app was rejected: it could be left on in production by mistake.
- **Deploying** (done): migration 0009 first. Existing accounts got "Set up
  encryption" at their first unlock, with a new recovery code to save;
  other passkeys need the code once each.

### Encrypted notes as built

- **Format:** `e1.<iv>.<ciphertext>` (base64url) in the same columns (no
  migration). AES-256-GCM with the data key; the additional data is
  `notonawa|field|v1|<user>|<table>.<field>`. Text is trimmed and empty
  text stored as null, as `cleanText` did. `crypto/fields.js` (browser) and
  `encryptedText` in `src/parse.js` (server) check the same pattern; a unit
  test keeps them, and the two lists of encrypted columns
  (`src/encryption/config.js`), in step. The server refuses plain text in
  these fields everywhere: forms, ties, both imports, `/api/encryption/seal`.
- **Not bound to the row** (decided 2026-10-14): the server could swap two
  of the same user's notes. Binding to the row would need the browser to
  choose every new row's id, imports included. Photos, whose ids the
  browser makes anyway, are bound to theirs; notes still aren't.
  **Revisit** if the browser comes to make every row's id.
- **The Worker works on whole records of a kind** (`seal`, `open`,
  `searchTies`, `forgetSearch`); `vault.js` exposes `seal`, `sealOne`,
  `open`, `searchTies`. A field that won't open is null and listed in
  `unreadable`; lists show "(can't decrypt the notes)", the tie form says
  saving replaces them, and the export counts them. Plain text (not yet
  encrypted) opens as it is.
- **Search on the device** (decided 2026-10-14): `searchTies(q)` in the
  Worker fetches `GET /api/ties/search-index` itself (id, title, notes
  sealed, plan titles), opens it, keeps it until the journal locks or
  `forgetSearch()` (after a tie or plan is saved or deleted, an import, or
  encrypting leftovers), and matches with `toLocaleLowerCase`
  (`search-match.js`): title, notes and linked plans' titles. Notes of ties
  not on screen never reach the page. `POST /api/ties/search` takes
  `match_ids` and refuses `q`; it still filters, sorts and pages. The server
  learns which ties matched (not the keyword); PRIVACY.md says so. This
  fixed "Keyword search ignores case for A–Z only" (below).
- **Import duplicates** (decided 2026-10-14): the import preview returns
  `candidates: [{ i, notes }]` (my ties the same in all but the notes, from
  the old SQL check minus notes); the page opens their notes and compares
  (`import-dedupe.js`), and sends `skip` with each batch. The page checks
  each batch again just before saving it, so re-importing after a failure
  still finishes the job. The file is sealed once on the device
  (`journal-fields.js`) and only the sealed copy is sent; the plain copy is
  kept for comparing.
- **Older plain text** (`GET /api/encryption/pending`, `POST
  /api/encryption/seal`, `seal-leftovers.js`): the first time a journal view
  shows after each unlock, the page seals what's left and overwrites it,
  only where the value is still plain. `updated_at` isn't touched (decided
  2026-10-14: encrypting isn't an edit). It waits for a journal view, not
  the unlock itself: sign-up and recovery unlock before the session is full,
  and the pending request would then end the session (found by the UI
  walkthrough).
- **Starting a new key** empties the encrypted fields in the same batch, and
  deletes profile notes, whose description can't be empty (an API test
  found the NOT NULL failure). PRIVACY.md already says what the old key
  encrypted is lost.
- **No sentence on D1's history or backups holding pre-encryption plain
  text** (decided 2026-10-14): only test data existed then.

### Encrypted photos: decisions

Agreed 2026-10-14, before building:

- **Photos on ties and plans.** A plan's photos belong to the plan, not to
  one version. A tie that uses a plan doesn't show the plan's photos.
- **Table `media`** (migration 0010), not `photos`, with `kind` (`photo`;
  `video` is allowed by the CHECK for videos, refused by the API) and
  `mime`. The export keeps the `photos` list that export and import
  planned, each entry with its `kind`.
- **One R2 object per photo**, `<owner id>/<photo id>` in the private
  `notonawa-photos` bucket (location hint `enam`: users are in the US
  and Canada; R2's only jurisdictions are EU and FedRAMP). The object is the
  sealed thumbnail then the sealed full size; `thumb_bytes` says where one
  ends, and the routes serve each with an R2 range read. One `PUT` per
  photo, streamed into R2 (almost no Worker CPU).
- **Ids made by the browser** (`crypto.randomUUID()`), so the sealed photo
  and its caption are bound to the photo's id and the user: the server
  can't swap one for another.
- **Preparing a photo** (browser): the input takes JPEG, PNG and WebP (so
  iPhones convert HEIC themselves); `createImageBitmap` applies the EXIF
  rotation; redrawn on a canvas (white behind transparency) and saved as
  WebP where the browser really makes WebP (Safari's canvas quietly returns
  PNG: the result's type is checked), else JPEG. Full size at most 2048 px,
  aiming for 500 KB (up to 3 tries at lower quality); thumbnail 320 px. No
  "keep the original": it would keep the metadata. A file that won't decode
  (HEIC in Chrome) gets "Save it as JPEG and try again"; no HEIC decoder.
- **Limits:** files up to 30 MB going in (only protects the phone's memory:
  the browser shrinks them); the server stores at most 10 MB an object, 30
  photos a tie or plan, and 1 GB an account (the sum of `bytes`, checked
  again inside the INSERT so two uploads at once can't both get past).
- **Captions** up to 200 characters, sealed; shown under each thumbnail.
  **Reordering** with "Move earlier" / "Move later" in the photo viewer
  (simpler on touch screens and with screen readers than dragging). New
  photos go last. Captions aren't searched. Dragging and searching
  captions are in [roadmap.md](roadmap.md) as ideas.
- **Ties list** shows a photo count only, not thumbnails (up to 100
  decrypts a page). **Revisit** if thumbnails are wanted there (also in
  roadmap.md as an idea).
- **Deleting** a tie, plan or the account, or starting a new key, deletes
  the rows in D1 (cascades) and then the R2 files. Rows and files can't
  change in one transaction, so the daily clean-up deletes files that have
  had no row for over a day.
- **Re-importing** a tie that's skipped as a duplicate: it gets the file's
  photos only if it has none yet, so a failed import can be run again to
  finish without making copies.

### Encrypted photos as built

- **Sealed format:** each part (thumbnail, full size) is a 12-byte IV and
  its AES-GCM ciphertext, with additional data
  `notonawa|media|v1|<user>|<photo id>|thumb|full|caption`
  (`crypto/media.js`). One piece per part: photos are small. Videos will
  need a format in pieces with its own version (not built now, despite the
  earlier idea of using it for photos too: it bought nothing yet).
- **The crypto Worker** gained `sealPhoto`, `openPhoto` (fetches the part by
  id itself, like the search index), `sealCaption` and `openMedia`; results
  that are buffers are transferred, not copied. Captions are sealed bound
  to their photo, not through `seal`, so they're not in the
  encrypted-columns lists.
- **Locking** also runs `onWipe` hooks, even for a quiet lock (account
  deleted): `photo-urls.js` revokes every `blob:` URL and empties the
  images showing them.
- **CSP:** `img-src 'self' blob:`. `connect-src 'self'` still keeps `fetch`
  off `blob:` URLs (the app never needs that; the walkthrough reads photos
  through `openPhoto` instead).
- **WebP check:** a 2×2 canvas with something drawn on it is encoded once;
  a blank one came back as JPEG in headless Chrome.
- **The Photos section** (`photos-ui.js`) on something already saved saves
  each change as it's made (add, caption, move, delete). On a new tie or
  plan the photos wait in the form and upload after it's saved; if one
  fails, the form stays open as an edit of the saved item and saving again
  retries the rest.
- **Export:** a `.json` as before when there are no photos, a `.zip` when
  there are (`zip.js`, stored, checked against `unzip -t`). A photo that
  can't be decrypted is listed with `file: null`; unreadable captions are
  counted with the notes.
- **Import** reads `.zip` (stored or deflated) as well as `.json` and CSV.
  Photo lists come off the file before anything is sealed or sent
  (`import-photos.js`), so a plain caption is never sent. Each photo is
  prepared again (a zip from elsewhere could hold metadata). The ties
  request answers each tie's new id, and the duplicate candidates their
  ids. **Known gap:** if an import stops part-way through one tie's
  photos, running it again skips that tie (it has some photos already).
  Fixing it is in [roadmap.md](roadmap.md).
- **Backups** are of D1 only: photos aren't backed up, which PRIVACY.md
  says. (True of `scripts/backup.mjs` and of the daily backup added
  later.)
- **Deploying** (done): create the bucket (`npx wrangler r2 bucket create
  notonawa-photos --location enam`, public access left off), apply
  migration 0010, then deploy.
- **The UI walkthrough sometimes hung** on a step ("took over a minute")
  or met an Internal Server Error while unlocking, before any photo UI
  existed. Finding the cause is in [roadmap.md](roadmap.md).

### Weighed and not adopted

- **An owner back door** (a special login for the operator): rejected. It
  would be a way in for anyone who got hold of it, and couldn't open
  encrypted data anyway. The owner uses several passkeys (including a
  hardware key) and a stored recovery code like anyone else, with
  `scripts/recovery-code.mjs` as a last resort for signing in.
- **Challenges in a signed cookie** instead of the `auth_challenges` table:
  stateless, but can't be made single-use without storing something anyway.
- **Cloudflare Access for everyone:** built for teams, priced per seat beyond
  the free tier, and not a public sign-up flow.
- **Hosted auth (Clerk, Auth0, Supabase Auth, …):** another company holding
  the user list.
- **Device-only storage (no server):** a lost phone loses the journal, there's
  no sync between devices, and Safari can clear site data from sites that
  aren't installed.
- **Server-side encryption with a key in a Worker secret:** protects leaked
  database dumps, but we could still read everything.
- **Blind index for keyword search** (HMAC'd words stored server-side): keeps
  server paging, but matches whole words only and shows the server which
  ties share words. On-device search is affordable at journal scale.

## Adjustable ties per page, and sorting

**Status:** built (2026-10-14)

The list header has a page-size picker (20, 50 or 100; `PAGE_SIZES` in
`src/ties/parse.js` and `public/js/tie-search.js`) and a sort button
(newest or oldest tie date first). Both go in the page address
(`per_page`, `sort`, left out at their defaults) and in the search body
(`page_size`, `sort`); any other page size is a 400. They aren't filters, so
Clear search keeps them. Oldest first is the exact reverse of newest first,
same-day ties included, so paging never shifts.

## `?archived=` with a default when it's left out

**Status:** not adopted (2026-10-12)

`GET /api/plans|people|locations` takes `archived=false` (active),
`archived=true` or `archived=all`. We weighed making a missing parameter mean
"all" (or "active", as it used to).

**Why not:** pickers must leave archived items out and histories must keep
them in. With a default, a caller that forgets the parameter gets one of those
wrong silently, and nothing errors. Making it required turns that mistake into a
400 that tests catch. `all` is a word rather than an empty value because a
query string has no real null and `archived=` is easy to send by accident.

## Keyword search ignores case for A–Z only

**Status:** fixed by encrypted notes and on-device search (2026-10-14)

Tie keyword search used SQLite `LIKE`, which ignores case only for ASCII
letters: "Ö" didn't match "ö". Search now happens on the device with
`toLocaleLowerCase` (`public/js/search-match.js`), which folds capitals in
any language.

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

## Tag recency worked out from ties, not a `last_used_at` column

**Status:** not adopted (2026-10-12)

The "Edit tags" dialog lists tags most recently used first. We weighed adding
`tags.last_used_at`, set whenever a tie is saved with the tag.

**Why not:** it's another value to keep in sync by hand (like `updated_at`),
and it goes wrong quietly: deleting or (later) editing a tie, or changing its
date, would leave it pointing at a use that's gone. `GET /api/tags` works it
out from the newest tie each tag is on (tie date, then when it was logged),
which is always right and cheap at journal scale. **Revisit if** listing tags
gets slow with many thousands of ties. Plan tags don't count towards recency
yet; plans can't be tagged in the UI.

## Tags are created when the tie is saved

**Status:** decided (2026-10-12)

Typing a tag and pressing + in the dialog only adds it on the page. The tie's
`tags` (names) are matched to existing tags, ignoring capitals, when the tie
is saved, and any new ones are created in the same batch. So a cancelled tie
leaves no stray tags behind, and a failed save creates none. The match uses
JavaScript's `toLocaleLowerCase` on both the page and the server, so unlike
the keyword search, "Ö" and "ö" count as the same tag.

## Tags on the ties list

**Status:** built (filter 2026-10-13, tags on each tie 2026-10-14)

The search has a "Has Tags" filter: tags are picked in the tie form's tag
dialog (`forSearch`: existing tags only, no adding or deleting, since a new
tag can't match anything), with an OR / AND switch (any of the tags, or all).
Tag ids, not names, go in the page address, as names are typed by the user.
Each tie in the list shows its tags (`listTies` fetches them with the
participants and plans).

## Every tie has a date

**Status:** decided (2026-10-13), migration 0006

Ties used to need a title or a date. A tie without a date never matched a date
search, so it could quietly disappear from a search for a period it belonged
to. Now the date is required by the API, the tie form, both imports (JSON and
CSV reject an undated tie and name it) and the database (`tie_date NOT NULL`).
No tie, live or local, had a missing date when this changed.

Weighed:
- **A default date range** (earliest to latest tie) on the search: not
  adopted. It would hide undated ties, and new ties outside the range.
- **A trigger rejecting NULL dates** instead of rebuilding `ties`: cheaper,
  but the rule wouldn't be visible in the table's schema. Chose the rebuild
  (as in 0002), with the link tables rebuilt alongside so nothing cascades.
- **Filling missing dates from `created_at`** on import: not needed, as no
  undated ties existed to export.

## The ties list as cards, and editing from the list

**Status:** built (2026-10-14)

Each tie is a card: title (a button that opens the tie to edit) and date;
"Floor at Studio" ("at Studio" with no type) and the rating; who took part, on
one line; and the tags. Duration, plans and notes left the list on purpose:
they're in the edit form. The header says "Showing X of Y ties" (matching,
and all; the search returns `all_total`).

- **People on one line:** the page measures each person after drawing and
  hides those that don't fit, ending the line with "+2" (its tooltip names
  them), so nobody silently goes missing. Redone when the list's width
  changes (`peopleThatFit` in `ties-view.js` is the pure part).
- **Editing** reuses the "Log a tie" form (`openTieForm(tie)`), with
  `GET`/`PUT`/`DELETE /api/ties/:id`. A save replaces the tie's people, plans
  and tags, but a person kept in the same role keeps their link row (and
  any ratings or notes an import put on it), and a plan kept keeps the
  version this tie recorded. Deleted people, plans and locations show as
  "(… deleted)" rows that can be removed but not changed; they're kept only
  if sent back in `keep_deleted`.
- **Deleting** a tie asks first. Its people, plans and tags stay; there's no
  archive for ties.

## Analytics: counted on the device, charts drawn by hand

**Status:** built (2026-10-15)

Two views: Calendar (`/calendar`, the calendar tab: a month, with a hank on
each day with ties) and Analytics (`/analytics`, the bar-chart tab: a
period's numbers, tie count bars, top 10 partners, a pie chart of tie
types, and bars for the days of the week and locations; see "Chart colors
and roles" below for how they look since 2026-10-17). They started as two halves of one
Analytics view; Calendar got its own tab once the nav became icons
(2026-10-16). Decided:

- **The server sends the ties, the page counts them.** `POST
  /api/stats/ties` returns only what the counting needs (date, type, length,
  rating, location, who took part in which role), and `public/js/stats.js`
  and `stats-period.js` do the counting. The numbers stay testable as pure
  functions, and every bar, slice and day keeps its tie ids for the drill-down
  ("Tapping a chart or calendar day lists its ties", below). Weighed:
  counting in SQL (`GROUP BY`) per chart. Fewer bytes, but a query per
  chart and nothing to drill into.
- **Charts are hand-drawn SVG (`public/js/charts.js`), not a chart
  library.** Three simple kinds, and the calendar is custom anyway; no new
  third-party code in an app holding encrypted journal data (a supply-chain
  risk, and 70–150 KB more to load), nothing to upgrade, and colors come
  from CSS variables (`--chart-yellow` and so on) so they follow the theme
  and the CSP's no-style-attributes rule. If fancier charts are wanted later
  (zooming, trend lines), Chart.js is the lowest-risk library: no runtime
  dependencies.
- **Partners** are the other people on a tie, leaving out my own profile,
  spotters and photographers (someone both spotting and modelling on a tie
  counts). Deleted people aren't counted.
- **The role filter is about me**: "As top" (or my name for it) is ties
  where my own profile was top, and so on. Ties without me on them only count
  under "All roles", so the top and bottom percentages can add up to less
  than 100% (rare, so accepted).
- **More filters (people, locations, tags) match ANY of the choices within
  a filter**, and different filters narrow together. This differs from the
  Ties search, where several people means ties with all of them
  (`person_match: "any"` in `src/ties/search.js` does the analytics' way).
- **Bars**: a month each for a year or the last 365 days; a day each for a
  month or the last 4 weeks; for All time a year each, or a month each while
  the ties span less than a year; for Custom a day each up to six weeks,
  then a month each.

## Roles, role names, Settings and dark mode by default

**Status:** built (2026-10-17, migration 0013)

- **One role per side of a tie.** Rigger and top meant the same thing, as
  did model and bottom, so they're now top and bottom, and each account
  chooses the words shown for them (Settings: "Person tying is called",
  "Person being tied is called"; `users.top_label`, `bottom_label`). The
  stored role never changes, so counting, filtering and imports don't
  depend on the words. Weighed: keeping rigger and model as their own
  roles and letting people hide the ones they don't use. Rejected: two
  roles for one thing split every count in two.
- **Every account's data was converted** by the migration: rigger to top,
  model to bottom, on ties and default roles. An account that only ever
  used rigger (never top) got "rigger" as its name for top, so nothing
  changed on its screen; the same for model. A person on one tie as both
  rigger and top became one row (the top one kept, with its ratings and
  notes; the other's were dropped, which no data had).
- **Self tie is a role**, on ties and as a default role (so someone who
  mostly ties themselves can make it their own profile's usual role). Its
  name isn't customizable. Analytics has "As self tie".
- **Hashira is a tie type**, after floor.
- **Role names are stored as plain text**, like tag names, so they're there
  before the journal is unlocked and the server can check them (1–24
  characters, different from each other and from the other roles' names).
- **Light/dark mode is an account setting** (`users.theme`), the same on
  every device, changed by the switch in Settings at once (role names wait
  for Save). New accounts start dark; accounts from before keep whatever
  their device showed, saved the first time they open the app. The
  device's own light/dark setting is no longer followed. Weighed: keeping
  it per device. Rejected: picking light on one device should mean light
  everywhere.
- **Imports** read rigger and model (and my own names, in a CSV) as top and
  bottom. An export carries its role names (`account.settings`); importing
  it takes them only if mine are still the defaults, so names I chose are
  never replaced.
- **Settings is a dialog** opened from the menu's first row (a gear), in
  place of the old Light / Dark Mode row; Sign Out is at the bottom of the
  menu too, below the privacy policy, as well as on the Account page.

## Chart colors and roles

**Status:** built (2026-10-17)

- **One palette in both modes**: yellow `#fec762` (the app's accent), purple
  `#7e51a2`, teal `#248686`, coral `#e07a5f`, and a grey that's lighter or
  darker to suit the mode. In light mode yellow is pale on white, so every
  bar carries its count.
- **The tie count and partner bars are split by my role**: top yellow,
  bottom purple, self tie teal, with a key under the heading. They count
  only ties where I was top, bottom or self tie; a switch (top and bottom on
  one tie) counts once, as top, so the parts add up to the bar. With the
  role filter on spotter or photographer, they count those ties in grey.
  The other charts and the numbers at the top count every tie in the period.
- **Tie types** keep a color each: suspension yellow, partial purple, floor
  teal, hashira coral, not set grey.
- **Days of the week** are seven yellow bars, Sunday to Saturday, days
  without ties included. **Locations** are horizontal yellow bars, the
  busiest 9 then the rest as Other: the name right-aligned on the left, the
  count just after the bar.

## Tapping a chart or calendar day lists its ties

**Status:** built (2026-10-16)

Tapping a calendar day, a bar, a partner, or a pie slice or its legend
entry opens a dialog of the ties behind it (`tie-list-dialog.js`): the Ties
list's cards (`tie-card.js`, shared with the Ties view), newest first, 100
at a time with "Show more", fetched with `POST /api/ties/search` and the
ids as `match_ids`. Tapping a title opens the tie form; saving or deleting
reloads the list and the view's numbers. A calendar day with one tie opens
it straight in the form.

Weighed: going to the Ties list with those ids instead. Simpler, but
leaving Analytics resets it (Back lands on this month's calendar, not the
Insights period and filters you'd set up), and the Ties list can't say why
it's showing those ties.

## "This is me" can't be moved, archived or deleted

**Status:** built (2026-10-16)

Every account gets its own profile at sign-up, so the People form's "This
is me" checkbox no longer needs to be editable: it shows only on that
profile, ticked and greyed out, beside the Name label. With no other way to
mark someone as me, the profile is protected on the server too: edits
ignore `is_self`, and archiving or deleting it is refused (400). Archiving
would drop it from the tie form's people picker, and deleting it would
leave Calendar, Analytics' role filter and the partner counts with no "me".
Renaming is still fine. Weighed: letting the checkbox move "me" to another
person. Not needed (it's always the account owner), and a slip would
quietly change every role-based number.

## People and Locations: search, sort and a default location

**Status:** built (2026-10-16)

The People and Locations lists have a search box (names containing what's
typed, ignoring capitals) and two sort buttons, by name and by date added.
They start newest first; tapping the chosen sort again flips it. It's done
on the device over the list already loaded (`list-order.js`), as these
lists are small and their names aren't encrypted, so no API change was
needed. My own profile stays at the top of People, whatever the order.
Times are to the second, so things added in the same second sort A to Z.
The order isn't remembered between visits; that can be added if wanted.

One location can be the default for new ties, ticked beside its Name
label. Ticking another asks whether to replace the current default; the
server moves it in one batch, and a unique partial index stops two (a
race between two devices gets a "reload and try again" message). Archiving
a location clears its default, and the checkbox isn't offered for one
archived as it's added. Weighed: a default stored in account settings. A
flag on the location keeps it with the location's export, import and
deletion.

The page titles (NotoNawa, Plans, People, Locations) are kept for screen
readers but hidden (`visually-hidden`), taking no space.

## Notices, agreeing to policy changes, and daily backups

**Status:** built (2026-10-17)

**Notices.** Messages from us show as banners over the journal. They're
written with `scripts/notice.mjs` (like invites), not from an admin screen
in the app: no admin role means nothing for an attacker to aim at. Plain
text only, with one optional fixed link (the privacy policy), so a notice
can't carry markup or send people to another site. A notice can be for
everyone or for one account (e.g. a legal request), and has a start and an
optional end. Dismissals are kept per person.

**Agreeing again.** The policy's version is the time it was built
(`scripts/privacy-html.mjs` stamps it, with the date shown on the policy,
whenever the wording changes). Most changes just need telling, with a
notice before they take effect; `--require-consent` marks a change people
must agree to. Until they do, the server refuses anything but reading,
agreeing, account and key changes and notices, and the app shows the
agreement in place of the journal, while Your data and Account still open
so someone who won't agree can export and delete. Weighed: blocking
everything, export included. Refused: leaving should always be possible.

**Daily backups.** Weighed a scheduled job on the Mac (backups away from
Cloudflare, but only when it's awake) against one in Cloudflare (always
runs). Chose Cloudflare: the cron Worker reads every table in one batch,
gzips it as JSON, and seals it with a public key whose private half never
reaches Cloudflare, so the Worker can't read its own backups; a separate
private bucket holds them, and each run deletes ones over 30 days old.
Photos aren't backed up (they'd double the storage, and deleted ones
should stay gone). On the Workers Free plan a cron run has 10 ms of CPU
time; reading, gzipping and sealing a small journal fits, but if backups
start failing as the journal grows (Cloudflare's Cron Events show it),
Workers Paid gives 30 seconds. `scripts/backup.mjs` still makes an extra
copy on the Mac when wanted.

## Quick polish (October 2026)

Built from the roadmap's first group, with no database changes:

- **The default location is pinned** at the top of Locations, the way "Me"
  is on People (`pinned` in `searchable`): first whatever the sort, but
  still hidden by a search it doesn't match.
- **Plan difficulty is picked with rope hanks**, like a tie's rating
  (`ratingField`, which also returns a setter, since the Plans form is
  reset and filled again rather than drawn afresh). Tapping the filled-in
  last hank clears it, so "not set" is still possible; the Plans list shows
  hanks too. The label for a plan's type is "Plan type".
- **The tie form's blanks**: "–" for no tie type, "Choose Role" for a
  person's role.
- **Deleting the account** says "THIS CAN'T BE UNDONE." on its own line,
  in bold.
- **Sign-in and Unlock** end with "Trouble signing in? Email
  contact@notonawa.app for assistance.", the address as a `mailto:` link.

## Tie types, plan tags, album links and release notes (October 2026)

Built together, as all but the release notes change the ties and plans
tables (migration 0014).

- **Every tie has a type.** Ties without one became hashira. The rule is
  kept by two triggers rather than `NOT NULL`: changing the column would
  mean rebuilding ties and every table linked to it, as 0013 did, for the
  same effect. The API and imports refuse a tie without a type first, with
  a friendlier message. Imports refuse rather than guess: an export saved
  before 0014 with an untyped tie has to be fixed before it imports. The
  tie form starts on "–" and won't save until a type is chosen.
- **Plans have an optional tie type** (one, like ties) and **tags**. Ties
  and plans share one list of tags (`plan_tags` existed since 0001, with
  its ownership triggers, export and import), so deleting a tag takes it
  off both. "Most recently used" still counts ties only; a tag used only on
  plans sorts with the unused ones, and the Ties search's tag picker
  leaves those out, as they can't match a tie. Analytics counts ties only.
- **Album links are encrypted**, like notes: a shared album link can open
  the photos for anyone who has it. So the server can't check one; the
  page accepts only http(s) (`links.js`) before sealing, and checks again
  before making one clickable. Any site is allowed, not just Google Photos
  and iCloud. An import's duplicate check ignores the album link (it's
  sealed): a tie that differs only by its album counts as the same. The
  ties list now opens each page of ties on the device, for the cards'
  album links.
- **Version and release notes.** The version is the release date and that
  day's release number, `YYYY.MM.DD.NNN` (three digits, so they compare as
  text). RELEASES.md holds the notes, built into the page and the Worker by
  `scripts/releases.mjs`, as PRIVACY.md is. Each account stores the last
  version whose notes it saw (`users.seen_release`, plain text like the
  other settings, and in PRIVACY.md). After unlocking, any releases since
  then are shown together in one dialog, newest first (up to 10), so
  several releases in a day mean one dialog, not several; closing it in
  any way counts as seen. New accounts start on the current version, so
  they get no backlog. The notes are signed-in only; the version also
  shows on the sign-in screen and at the bottom of the menu.

## Welcome, Bug and feedback, and the Plans dialog and search (October 2026)

Built for release 2026.10.20.001 (migration 0015).

- **The welcome shows after each unlock until "Don't show this again" is
  ticked** (`users.hide_welcome`, an account setting like the others, so
  every device stops at once). OK without the box ticked means "show me
  again next time", which is what the checkbox implies. The column starts
  at 0 for every account, those made before it included, so existing
  accounts see it at their next unlock with no separate "push it to
  everyone" step. A way to send it again (as notices can be sent) wasn't
  needed yet: setting `hide_welcome = 0` for an account does it. It shows
  before What's new, one after the other, never both at once. The text is
  WELCOME.md, built into `welcome-text.js` by `scripts/welcome.mjs` and
  drawn with `h()` (the CSP and Trusted Types rule out putting HTML on the
  page), as RELEASES.md and PRIVACY.md are built. It mentions features not
  built yet (the map, workshops) on purpose.
- **Feedback goes to D1, with email as the other way.** The app can't send
  email, and a `mailto:` link alone isn't a form. So the form saves to a
  `feedback` table (kind, message, app version, time), read with
  `scripts/feedback.mjs`, and answered, if at all, with a notice to that
  account: we don't have anyone's email address. The form also links to
  our email for a screenshot or an answer by email. Feedback is plain
  text, as we have to read it; the form warns not to put journal details
  in it, and PRIVACY.md says so. It's in the export and deleted with the
  account (import ignores it, like notices). The kind starts blank and is
  required, so it's a choice, not a default. Ten a day per account,
  counted in the insert itself.
- **The Plans form is in a dialog** opened by + on a small "Add a Plan"
  card, and by Edit, as the tie form is. `resource-page.js` does it with a
  `dialog` setting, so People and Locations keep their forms on the page.
  The dialog's ids start with `plan-`, as the tie form opens over it. As
  with the tie form, a tap outside doesn't close it (a half-written plan
  isn't lost); Esc does.
- **The Plans search runs on the device**, over the plans already loaded
  (their notes are opened for the list anyway), so it needs no API, and
  the keyword never leaves the device. Plan type and tie type use the
  Ties search's multi-select (any of those chosen); tags work as on Ties.
  Unlike the Ties search, it isn't kept in the address: plans are few
  enough that there's no paging to come back to, and it starts empty each
  time Plans is shown.
- **Linked ties come with the plans list** (`linked_ties`, a JSON column
  like `tags`), not from a separate request per plan: the card's count
  and average need them all anyway, and titles, dates and ratings aren't
  encrypted. The average counts rated ties only, to one decimal place, and
  is drawn as hanks rounded to the nearest whole one, with the number
  beside it. Tapping a linked tie opens it in the tie form over the plan's;
  saving it reloads the list and the form's linked ties, keeping what's
  typed in the plan.
- **An email for each report, for now.** Email Routing's `send_email`
  binding sends from and to contact@notonawa.app (verified as a
  destination), so no other address or service is involved. It says only
  the kind (a bug report, or feedback for an idea), the app version and
  the time, with the script to read it, so nothing anyone wrote is copied
  into the inbox and PRIVACY.md needed no change. It's sent once the
  report is saved; if it fails, the report is still saved and the error is
  logged. A daily digest from the cron job is the plan once reports are
  more frequent.
