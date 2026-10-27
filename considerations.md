# Considerations

Design ideas we've weighed, planned features, and the reasons behind them, so
we can revisit them later.

## Privacy and accounts

**Status:** built and deployed (all 13 migrations applied to the remote
database, checked 2026-10-19). Videos were built 2026-10-20 (no
migration): see "Videos as built".

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
- **Videos.** Re-encoded on the device (which strips everything and
  shrinks them), sealed in pieces, stored and exported like photos. Photos
  were built so videos needed no new migration or export format. *Built
  2026-10-20; see "Videos as built".*

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
  photos go last. Captions aren't searched. Dragging came later
  (2026-10-20, "Dragging photos into order"), with these buttons kept.
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
  (`crypto/media.js`). One piece per part: photos are small. Videos got a
  format in pieces with its own version (v2; "Videos as built"); photos
  kept v1, as it bought them nothing.
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

### Dragging photos into order

Built 2026-10-20 (no server change: a drop saves with `PUT
/api/media/order`, as the buttons do).

- **Pointer events, not HTML drag and drop**, which doesn't work with a
  finger on phones. `drag-order.js` (pure) has the threshold, which tile a
  pointer is over (or the nearest, in a gap) and the new order;
  `photos-ui.js` the listeners, put on `document` for the length of a drag
  and taken off with an `AbortController`.
- **A mouse drags once it moves 8 px; a finger after holding still for
  350 ms.** A finger that moves sooner is scrolling, so a long grid still
  scrolls. Once a finger drags, `touchmove` is cancelled so the page
  stays put. Pointer capture isn't used (it isn't needed with listeners
  on `document`, and it throws for the walkthrough's made-up pointers).
- **No live reshuffling while dragging**: the tile fades and the one it
  would land on is outlined; the order changes on the drop. Simpler, and
  plain enough on a three-column grid.
- **What a drag mustn't do:** the click that ends it doesn't open the
  viewer (clicks for 400 ms after are swallowed); a held finger doesn't
  open the browser's menu (`contextmenu`, `-webkit-touch-callout`); a
  mouse doesn't drag the image out of the page (`dragstart`).
- **Move earlier/later stay** in the viewer, for keyboards and screen
  readers.

### Videos as built

Built 2026-10-20, from what was weighed on 2026-10-14 (roadmap.md). No
migration: `media.kind` already allowed `video`.

- **Re-encoded, not box-rewritten.** Rewriting MP4/MOV boxes by hand would
  keep full quality but miss whatever we didn't know to strip;
  re-encoding writes a new file from the frames and sound alone. It uses
  **mediabunny** (MPL-2.0, pinned 1.61.3, a dev dependency copied into
  `public/js/vendor/` by `scripts/vendor.mjs`, with `--check` in `npm run
  check`; there's no build step). It runs on the page, over WebCodecs, and
  is only loaded once a video is chosen (dynamic `import()`).
- **What's stripped, and how:** `copy: false` (every frame and sample is
  encoded again: no packet, SEI data or box is copied), `tags: {}` (the
  default copies the input's tags: GPS, dates, make and model), and track
  names dropped (the conversion copies them, and cameras such as GoPros
  put their model there; `forgetName` hides each track's name from the
  conversion through the options callback, which gets the same track
  object). Rotation is drawn into the frames
  (`allowTransformationMetadata: false`). The MP4's own creation time is
  the time it was made on the device, not the recording's. The walkthrough
  makes a clip with a secret title, comment, date and track names, and
  checks none survive.
- **Size: 480p** (the shorter side 480, `video-fit.js`), H.264 at 1.2
  Mbps and AAC at 96 kbps, frame rate capped at 30 (only when it's
  higher: slow-motion clips): about 10 MB a minute. Chosen by the user
  over 720p (about 23 MB a minute) and 1080p (about 38 MB, which would
  have needed R2 multipart uploads).
- **Limits:** clips up to 3:00 (refused before encoding, saying how
  long: no trimming in the app); 40 MB stored a video (a full-length clip
  is about 30 MB, so one `PUT` well under a Worker's 100 MB request
  limit; no multipart); 5 videos a tie or plan within the 30 items,
  checked again inside the INSERT; the 1 GB account limit is shared with
  photos (the user chose to keep it at 1 GB for now).
- **No picture encoder, no video; no sound encoder, ask.** A browser that
  can't encode H.264 gets "This browser can't prepare videos". One that
  can't encode AAC for the clip's sound (checked for its own channels and
  sample rate, and again if the conversion still leaves the sound out)
  asks "Upload without sound?": yes uploads it silent, Cancel leaves it
  out with a message (`SilentRefused`). An import asks once for all its
  videos. (First built as a refusal; the user preferred being asked.)
  Firefox and older Safari may hit this.
- **Sealed in 1 MB pieces** (format v2, `sealPieces`/`openPieces` in
  `crypto/media.js`): each piece has its own IV, and its additional data
  holds the piece's number and whether it's the last
  (`notonawa|media|v2|<user>|<id>|full|<n>|last|more`), so pieces can't be
  reordered, swapped with another video's, or the video cut short, even at
  a piece's edge. The thumbnail (always JPEG, a frame from 1 s in) is
  sealed as a photo's (v1). The kind (from the row) says which format the
  full size is in.
- **Playback:** the whole clip is fetched, opened in the crypto Worker and
  played from a `blob:` URL (`media-src blob:` in the CSP), its thumbnail
  as the poster. Fine at these sizes; no streaming (MediaSource is patchy
  on iPhones, and a service worker holding the key would break "the key
  lives only in the crypto Worker"). Speed buttons 0.25×–2× are our own,
  as iPhones' controls don't offer speeds. Locking pauses and empties
  every video showing a `blob:` URL.
- **The library's own Workers** (for transparent video and live
  recording, which we don't use) are made from `blob:` URLs; the CSP's
  `worker-src 'self'` and Trusted Types refuse them, and we left it so
  rather than loosening the CSP. Checked by reading the bundle: no
  `eval`, network requests or storage.
- **Export and import:** videos go in the zip's `photos/` folder as
  `<id>.mp4` with `kind: "video"`; import prepares each again like a
  chosen file, so nothing but a re-encoded clip is ever stored. Exports
  are built in memory, so a journal with a lot of video is heavy on a
  phone; **revisit** (streaming the zip) if that bites.

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

## The Analytics map: our own outlines, no map tiles

**Status:** built (2026-10-20)

Analytics has a Map card (after Locations): a pin for each location with
coordinates that has ties in the filters, grouped when pins would overlap,
tapping one listing its ties. Ties without a location, at one without
coordinates, or whose location was deleted aren't on it; the card says so,
and says "Showing 3 of 4 ties" when some are left out. Decided:

- **No map tiles or map library.** A normal web map (OpenStreetMap, Google,
  Mapbox tiles, usually through Leaflet or MapLibre) loads its pictures from
  another site, a few at a time for the part shown, which tells that site
  roughly where the ties were and when someone looked; the CSP refuses
  other sites anyway. Instead the map is Natural Earth's 1:110m country
  outlines (public domain), turned into one SVG path by
  `scripts/world-map.mjs` (`public/js/world-shapes.js`, 51 KB, 22 KB
  compressed) and drawn on the device (`world-map.js`, with the sums in
  `map-geo.js`). The cost: no cities, roads or labels, so close up the pins
  stand on plain land. Weighed: the 1:50m outlines (about 10 times bigger,
  for coastlines that only matter zoomed in), and land without borders
  (lighter, but harder to tell where you are).
- **It's a card in Analytics, not its own view**, so it follows the same
  filters and reuses the ties Analytics already has (the stats query
  sends the location's coordinates too; they were already plain text on
  the server). Its code and outlines load only when the card is about to
  scroll into view.
- **Mercator, Antarctica cut off**, like most web maps. It opens fitted to
  the pins (zoomed in no closer than about 160 km across); +, − and "Show
  all" zoom by two, and dragging moves it. No zooming with the mouse wheel
  or pinching: the wheel should scroll the page. On a touch screen a finger
  on the map moves the map, not the page.
- **Pins closer than 30 pixels are one pin** with its tie count, grouped
  around the busiest place; zooming in pulls them apart.

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

## People: educators, based in, social and scene names, and the People dialog (October 2026)

Built for release 2026.10.20.002 (migration 0016).

- **"Based in" and the social and scene names are encrypted**, like notes.
  A FetLife handle or scene name next to a real name and a city is more
  identifying than anything else we keep, and nothing on the server needs
  to read them: every people search already runs on the device. Names and
  pronouns stay readable (the pickers, import's matching by name and the
  ties' "With:" line use them), as PRIVACY.md says. The educator flag is
  readable too: a yes/no, which a workshop's educators list will need.
- **The names are one sealed column (`people.aliases`), not a table.** A
  JSON list of `{ platform, alias }` (`public/js/aliases.js`), sealed
  whole, so the server can't see how many there are or which platforms
  they're on, and there's no new table, ownership triggers or export and
  import code for it: it travels like notes. The cost is that the server
  can't query them, which it never needs to. The opened text is checked
  on the way in (`readAliases`): anything that isn't a list of them reads
  as none, an unknown platform as "other".
- **What a search shows**, as asked: an alias that matches shows as "Name
  (that alias)", even when the name matches too; otherwise the first scene
  name, if there is one ("J (therawkitty)"), or just the name. So typing
  "sam" shows "Sam (knotsam)" when Sam's FetLife name contains it. With
  nothing typed, the scene name shows. People, the tie form's picker and
  the Ties search's People filter all use `personMatch`, so they agree;
  the pickers and the filter open people's rows first to read them. The
  tie form still offers "Add to list" for what's typed, as it does for
  part of a name.
- **The People form is a dialog**, like Plans, opened by + on "Add a
  Person" and by tapping a name; the search is a card of its own between
  them and the list (`searchable.slot`). The cards have no buttons
  (`actionsInDialog` in `resource-page.js`): Archive (or Restore) and
  Delete sit beside Close under Save, and close the dialog when done. "Me"
  gets Close only, as the API refuses the rest. Notes show in the dialog
  only; the card shows pronouns, the usual role as an outlined tag (in
  the account's words), "based in …", "aka …" (scene names first, others
  with their platform), and a cap, in the accent outline, for educators.
  The workshops that will use the educator flag aren't built yet.

## Running only the checks a change needs (October 2026)

`npm run check` had grown to about 20 seconds and `npm run test:ui` to
about 6 minutes, too slow to run after every change.

- **An explicit map of areas** (`scripts/areas.mjs`), not Vitest's own
  `related` / `--changed`. Those follow imports, and the API tests don't
  import the code they test: they send requests to the Worker. Tried on
  `src/tags/parse.js`, `related` found ten test files but not
  `test/api/tags.test.js`. The map is written by hand, so a unit test
  checks it covers every source file, script and test, and names only
  files that exist. A file in no area, or a shared one (the shell, the
  API helper, the vault, migrations, config), runs everything: a missed
  check costs more than a slow one.
- **Lint and type check always run in full**: together about a second.
- **The walkthrough is split into chunks that each start from a new
  account**, rather than letting a chunk run the ones before it to make
  its data. The sections had grown to depend on each other's leftovers
  (Deleting removed what People made; Signing in expected "24 of 24
  ties"), so running a late one alone meant running nearly all of it.
  Chunks that need a journal get it from `scripts/ui/seed.mjs`, through
  the API with notes sealed on the page, matching what the People,
  Locations, Plans and Ties chunks make by clicking. The cost is a sign-up
  per chunk (a few seconds each): a full run went from about 6 to about 7
  minutes, while one area's change now takes well under a minute. A chunk
  that throws counts as a failure and the next one still runs.
- **Chunks run in parallel, 3 at a time by default** (`--jobs`). Each
  batch is a separate copy of `scripts/ui-smoke.mjs` with its own
  database, `wrangler dev` and Chrome on its own ports (`UI_SLOT`), not
  several Chrome tabs on one app: the harness keeps its state (the
  recovery code, the passkey device, console errors) per process, and
  separate databases mean one chunk's SQL (a notice for everyone, a
  deleted key) can't reach another. Batches are shared out longest chunk
  first (`batches()`, by `UI_SECONDS`), and each chunk's output is shown
  whole when it's done, so the output stays readable. Each copy costs
  about 0.5 to 1 GB. Steps that waited a fixed time are the risk on a
  busy machine; `--jobs 1` runs them one at a time to tell a slow machine
  from a real failure.

## Locations: city, state or province and country, and the Locations dialog (October 2026)

**Status:** built (2026-10-20)

- **Where a location is** (migration 0017): `city`, `state_province` and
  `country`, typed in, all optional. Plain text, like the name and the
  coordinates (which already say exactly where it is), so the server can
  list them and later filter by them. Cards show them as "Seattle, WA,
  USA" (`placeText`), and the list's search finds them.
- **Not built yet: filling them in from a Maps link, or from a pasted
  address.** A dropped-pin link holds only coordinates, and a place link
  holds the address as free text whose format changes by country, so
  splitting it on commas isn't reliable; an address needs geocoding to get
  coordinates at all. Both need a geocoding service, called from the
  Worker (as short links are) so the page's CSP doesn't change:
  - **OpenStreetMap Nominatim**: free, no key; works from coordinates
    (dropped pins too) and addresses. Its usage policy asks for at most
    one request a second, a User-Agent saying who we are, and the credit
    "© OpenStreetMap contributors" near the fields.
  - **Google Geocoding API**: closest to what Google Maps shows; needs a
    Cloud account with billing and a secret key.
  - **Parsing the place link's text only**: free and private, but fills
    in nothing for dropped pins or addresses.

  Leaning to Nominatim. Either service would see a location (from
  Cloudflare's address, not the user's), so PRIVACY.md would need to say
  so, with a notice first. A pasted street address wouldn't be stored.
- **The Locations dialog**, as on People: "Add a Location" with the +
  first, a search card, and the form in a dialog that + and tapping a name
  open, with Archive (or Restore) and Delete inside it. Lat and Long are
  narrow (about six digits show) but hold full precision.
- **People's form**: "This is me" moved to the dialog heading's row, and
  Educator to the Name row, both at the right. Pronouns and social names
  aren't capitalized as they're typed (`autocapitalize="none"`).

## Education: workshops attended and taught (October 2026)

**Status:** built (2026-10-20)

- **A seventh tab**, the graduation cap, between Analytics and +. To fit
  seven tabs, the + and ☰ on one row, the gaps shrink on phones and the
  tabs narrow below 375px (checked down to 320px in the walkthrough).
- **Attended or taught isn't stored**: a workshop is taught when my "this
  is me" profile is one of its educators, attended otherwise. One fact,
  so the two can't disagree, and moving myself between educators and
  participants moves the workshop between the tabs.
- **Educators are picked only from people marked Educator**, my own
  profile included: I tick Educator on myself to log what I teach (the
  form and the empty Taught tab say so). Typing someone who isn't an
  educator points to People instead of offering to add them again;
  someone added from the educators box is saved as an educator.
- **Everyone has a role**, educators too (the tie roles: an educator
  demonstrating as top, say). A person is on a workshop once, as an
  educator or a participant, never both (a unique index; the form leaves
  out whoever is chosen in either list). One `workshop_people` table with
  a `kind`, rather than two tables, so that rule is one index.
- **Attendee count is typed in**, not counted from the participants: a
  workshop's participants are the people I tied with, not everyone who
  came. The Taught summary adds the counts up as "Attendees".
- **Search on the device, over all of them**, as on Plans: there are far
  fewer workshops than ties, and their description and notes are
  encrypted, so `GET /api/workshops` sends them all and nothing typed
  goes to the server. It isn't kept in the address. One search narrows
  all three tabs, Summary included, so a date range or a tag gives a
  "résumé" for a year or a subject (the roadmap's tag-filtered résumé).
  A workshop is in a date range if any of its days is.
- **The Summary's numbers**: workshops, days (a two-day workshop counts
  2), educators (co-teachers, for what I taught), locations, partners
  (participants other than me), attendees (taught), the average rating,
  the three most frequent educators and tags, and the first and latest.
  Deleted people and locations aren't counted.
- **Photos on workshops** needed `media.workshop_id`, and the CHECK that a
  photo is on exactly one item changed, so `media` was rebuilt (nothing
  links to it, so it's copied, dropped and renamed).
- **Export and import** carry workshops, with educators and participants
  as two lists. Duplicates are found as for ties: the server lists
  workshops the same in everything it can read, and the page compares the
  description and notes. A CSV still holds ties only.
- **Left out for now**: workshops in Calendar and Analytics, linking ties
  to the workshop they were tied at, and + asking what to add. Each would
  build on what's here without changing it.

## Offering to install the app (October 2026)

**Status:** built (2026-10-22)

- **A banner under the notices**, while the journal is open (not over
  Unlock, sign-in or Consent), offering to install the app. It isn't
  shown once the app runs in its own window (display mode standalone and
  the like, or Safari's `navigator.standalone`).
- **Chrome and Edge get a real Install button**: the page keeps their
  `beforeinstallprompt` event and opens the browser's own install window
  with it. Using the event stops Chrome's own install bar on Android, so
  ours is the only one.
- **Safari and Firefox can't be asked**, so the banner says where to find
  it: Share, then Add to Home Screen on iPhone and iPad (any browser);
  File, then Add to Dock in Safari 17+ on a Mac; Firefox's menu on
  Android. Firefox on a computer can't install sites, so it sees nothing.
  User agents decide which, in `install-rules.js` (pure, tested).
- **"Not now" is per device, for good**, in localStorage
  (`install-dismissed`), like the light/dark mode. Not an account setting:
  installing is per device, and it would mean a migration for little.
  Nothing about it is sent to us, so PRIVACY.md isn't changed (it doesn't
  mention the stored mode either).
- **Known gap**: Safari can't tell the page whether the app is already
  installed, so someone who installed it but opens it in a Safari tab
  still sees the instructions until they choose Not now.

## Drawings on ties, plans and workshops (October 2026)

**Status:** built (2026-10-22)

- **Kept as lines, not a picture** (`drawings.data`: JSON of each line's
  points, color and width on a 900 × 1200 canvas). A picture could only be
  painted over: once saved, the app wouldn't know which pixels were which
  line, so erasing one line would cut gaps in the lines it crossed, and
  undo would stop at the last save. As lines, the eraser takes out whole
  lines, undo goes back past a save, and a duplicate edited later is
  still a drawing, not a flattened copy. Line drawings are also smaller as
  lines (a few KB) than as an image, and stay sharp at any size.
- **In D1, not R2**: a drawing is small (limits: 2,000 lines, 100,000
  numbers, a 600 KB request), so it's a row. Editing is one UPDATE in a
  transaction, deleting a tie deletes its drawings by cascade with no
  files to clean up, and the daily backup holds them.
- **Not encrypted, by choice**; the caption is. The server checks the
  format (known colors and widths, whole-number points on the canvas) and
  stores only those fields. PRIVACY.md says drawings are readable and not
  to put identifying details in one. Captions are sealed like notes
  (`drawings.caption` in both encrypted-column lists), not bound to the
  drawing's id as photo captions are, so a copy needs no re-sealing and a
  new key empties them as it does notes.
- **Duplicate and Copy to… add a new drawing** with the same lines and
  caption (`POST /api/drawings`): the page already has the lines, so
  there's no copy route. A drawing never moves (a trigger), as photos
  don't. Copy to… lists ties (searched as on the Ties page, the keyword on
  the device), plans (not archived) and workshops, by title.
- **The pad is a full-screen dialog, not a view**: changing view closes
  open dialogs, which would lose the tie form, and a new tie has no id
  until it's saved. A new item's drawings wait in the form, as photos do.
- **Colors are app.css's** (`--ink-*`, `--paper`), the same in both
  modes, so a drawing looks the same in dark mode (the paper stays
  light). The export's SVGs read the same variables.
- **Export and import**: a drawing's lines are in the JSON, so a .json
  export carries them; with drawings, the export is a zip with an SVG of
  each too (`drawings/<id>.svg`), for viewing outside the app. Import
  saves them once the journal is in, onto items that have none yet, as
  photos. An imported drawing is new (its own id, created_at, updated_at).
- **Dragging into order** is shared with photos (`tile-drag.js`).
- **Left out for now**: shapes, text and straight lines; zooming the pad;
  a count of drawings on tie cards.

## Tapping a card opens it; plans as cards (October 2026)

**Status:** built (2026-10-24)

- **The whole card opens it**, on Ties, Plans, People, Locations and
  Education (and the tie lists in Calendar and Analytics, the same card),
  not just its title: a small target on a phone. The title or name stays a
  button, so keyboards and screen readers have the same way in, and a tap
  on a link, button or field on the card does only its own thing, as does
  the tap that ends selecting text (`opensOnTap` in `dom.js`).
- **Plans work like People and Locations**: no Edit, Archive or Delete on
  the card; Archive (or Restore) and Delete are in the plan's dialog, and
  an archived plan opens from its card too. The plan card is laid out like
  a tie's: the title, and the plan type where a tie's date goes; the tie
  type and what it's a variation of, and the difficulty in hanks; how many
  photos, and how many ties it's on at the right; the album link; the tags.
  The description and notes are in the dialog only, as a tie's notes are,
  and the average rating of its ties left the card (the dialog lists each
  tie's).
- **No version on the card.** `plans.version` has been 1 for every plan
  since migration 0001: it was meant to count substantive edits for a plan
  history that was never built, and nothing changes it. Showing "v1" on
  every card would say nothing; it's back when something bumps it.

## Poses: a 3D figure on ties, plans and workshops (October 2026)

**Status:** built (2026-10-23)

- **Our own figure, not Mannequin.js.** Mannequin.js does almost exactly
  this, but it's GPL-3.0: shipping it in the page would mean releasing the
  app's code under the GPL. The figure here is a tree of bones
  (`figure-rig.js`) drawn as capsules and ellipsoids: genderless by
  design, with joint limits chosen for rope (a box tie's shoulders, a
  futomomo's hip and knee). Revisit if the app is ever open-sourced under
  the GPL anyway.
- **three.js, bundled to only the parts used.** The whole library is about
  2 MB, and every static file is `no-store`, so it would be fetched every
  time the poser opens. `scripts/vendor.mjs` bundles only what
  `scripts/vendor/three-entry.mjs` names, minified with the esbuild that
  comes with wrangler (555 KB, about 140 KB over the wire), and the types
  are ours (`scripts/vendor/three.d.ts`), covering just those parts, rather
  than another package. It's fetched only when a form has poses to show, or
  one is added (`poses-ui.js` imports the 3D code itself).
- **Kept as numbers, like drawings' lines**: each joint's angles, the body's
  turn and height, the view, the hardpoint and the ropes (`pose-format.js`;
  `src/poses/parse.js` checks the same format). A picture couldn't be posed
  again, and is far bigger. Rope points are kept in millimetres from a bone,
  in the bone's own directions, so a rope stays on the arm it was laid on
  when the arm moves. **Not encrypted, by choice**, as drawings aren't; the
  caption is. PRIVACY.md says so.
- **One copy of the joint limits each side**, page and server, kept in step
  by a unit test (as drawings' format is), and the tests pose the figure
  with three.js's math (`pose-skeleton.js` has no drawing in it) to check
  the presets: a box tie's wrists are behind the back, kneeling shins are on
  the floor, face down faces the floor.
- **Sliders, not 3D handles.** Dragging gizmos in 3D is hard with a finger on
  a phone; tapping a part and moving sliders isn't. One finger turns the
  view, two pinch and pan it (sideways too: the camera's target has an x
  and z since the second round, so older poses' four-number cameras are
  read as not panned). Undo and redo cover everything but the view
  (turning the view isn't a change to undo).
- **Body and arms presets, separately** (second round, after trying it on a
  phone). One "Start from…" list set every joint, so choosing kneeling
  after placing the arms put them back in a box tie. Now a body preset
  sets everything but the arms (trunk, head, legs, the body's turn and
  height) and an arms preset only the shoulders, elbows and wrists, so
  each leaves the other, and any arm moved by hand, as it was.
- **One hardpoint at a time: a ring, a bamboo or a hashira**, each added in
  view (a ring or bamboo at 195 cm; the first ring, at 280, was above the
  view, so adding it looked like nothing happened). Several at once is for
  a later release. Between a ring and a bamboo the uplines move across
  (to the bamboo's middle, or the ring), as both hang the body from above;
  a hashira's ropes are tied to the side of a post, with nothing to match
  overhead, so switching to or from it takes its rope points out, after
  asking. A bamboo point is how far along it; a hashira point is where on
  the post, in its own directions, so both stay put when it's moved or
  turned.
- **"Add to visuals"** in the poser (it was "Add as photo" in the pose's
  details) draws the pose on the device and hands the picture to the
  Visuals section, which prepares and seals it like any photo, last.
  Pictures and thumbnails come from one hidden 3D view, reused: browsers
  allow only a few at once.
- **Flatter torso.** The chest, waist and hips are squared-off ellipsoids
  (a superellipsoid made from a sphere, as three.js's rounded box isn't in
  the bundle), and the shoulders smaller, so a rope between two points on
  the front doesn't cut so deep into the body; the nose is gone.
- **A sequence is a plan with several poses in order**: no new schema.
- **Export and import**: poses are in notonawa.json as their numbers. No
  picture of each in the zip (drawings have SVGs): that would need the 3D
  view, which the export doesn't load. Import saves them once the journal
  is in, onto items with none yet, as drawings (`import-poses.js`; the
  data page's `importSaved` does both).
- **Left out for now** (see roadmap.md): ropes that follow the body's
  surface between points, a second figure, props, and animation.
  (Dragging a limb came next: "Poser: dragging limbs, typed values, saved
  presets", below.)

## Visuals: photos, drawings and poses in one order (October 2026)

**Status:** built (2026-10-23)

- **One section and one order** on ties, plans and workshops, in place of
  separate Photos and videos, Drawings and Poses sections, so a sequence
  can mix them (a photo, then the pose that explains it). + opens "Add a
  visual from…" (photo/video, drawing, model poser). Each tile is outlined
  in its kind's chart color (photos teal, videos purple, drawings coral,
  poses yellow), with a key of icons beside the label; videos keep their ▶,
  and each tile's name says its kind, so color isn't the only clue.
- **No migration: the three tables share one count.** Each kind keeps its
  own table and `position` column; a new one goes after the item's last
  visual of any kind (`nextPosition` in `src/visuals/db.js`), and `PUT
  /api/visuals/order` numbers all three in one batch, each update checking
  the whole list (every visual, under its own kind) so it's all or
  nothing. The per-kind order routes are gone, as they'd renumber one
  kind from 0. Items from before overlap (each kind counted from 0); the
  page breaks ties photos, drawings, poses, then oldest first, and the
  first move saves the mixed order.
  - **Weighed and not adopted:** one `visuals` table, or a separate order
    table. Either means a migration and joins for three kinds stored
    differently (files in R2, lines, numbers), for nothing the shared
    count doesn't already give.
- **Export and import** keep each visual's position, so the file holds the
  mixed order. Import adds each kind in turn (they go through different
  routes), then puts each item's back in the file's order. An item that
  already had visuals, or where one couldn't be added, is left as saved:
  the order route only takes all of an item's visuals.
- **The details dialogs** share their caption row (Save caption beside the
  label, muted until the caption changes, then yellow), "← Move earlier"
  and "Move later →", and swiping left or right to the next or the one
  before, across kinds (not from the caption, the buttons or a video's own
  controls). They open focused on themselves, not the caption, so a phone
  doesn't put its keyboard over the picture. A drawing's and a pose's Edit
  is outlined in the accent above the caption, with Duplicate and Copy to…
  side by side.

## Poser: dragging limbs, typed values, saved presets (October 2026)

**Status:** built (2026-10-26)

- **Dragging an arm or a leg (inverse kinematics)**, alongside the sliders
  rather than in place of them. Any part of an arm or leg drags: the
  upper arm or thigh swings at the shoulder or hip alone; the forearm,
  hand, shin or foot also bends the elbow or knee (elbows and knees were
  asked for too, not just hands and feet). A drag that starts anywhere
  else still turns the view, so no mode switch: the quickest, and tapping
  first to "arm" a limb was weighed and left for if drags grab limbs by
  mistake on a phone.
- **The point held moves on a flat surface facing the camera**, through
  where it was picked, so it stays at the same depth; to move it nearer or
  further, turn the view and drag again. A 3D handle with depth was
  weighed and left out, for the same reason as sliders over gizmos.
- **The solver** (`pose-ik.js`) is damped least squares over the joint
  angles, with each angle's effect found by trying a small change (no
  analytic two-bone solve: the joints' Euler orders and limits differ, and
  this handles both), moving at most 6 cm toward the target a round so a
  far target doesn't fold the limb. Only the shoulder's or hip's forward
  and out turns and the elbow's or knee's bend move: twisting while
  dragging rolled the limb unexpectedly. Angles stay within the sliders'
  limits, so a target out of reach gets as near as it can. Each finger
  move solves from the last, so the limb follows smoothly. One drag is
  one change to undo, and the part dragged is selected, its sliders
  showing the result.
- **Typed values**: the number beside each slider is an input (type
  number, so an iPhone keyboard has a minus sign; 16px, so it doesn't zoom
  in) that commits on Enter or leaving it, kept within the slider's range;
  anything but a number puts the old value back.
- **Saved presets, per account, for every pose** (migration 0025,
  `pose_presets`), not per pose or in the browser: they were wanted "over
  and over in all poses", on any device. Body and arms stay separate, as
  the built-in ones are. The name is encrypted (it could name a person:
  "Sam's shoulder-safe boxtie"); the angles aren't, matching poses, so the
  server checks them against the joint limits. A body preset doesn't keep
  where the figure is moved across or front to back, as the built-in ones
  don't. 50 an account. The name column is nullable only so a new key can
  empty it, as with other encrypted fields; the poser shows it unnamed.
  In the export (account.pose_presets, names opened); an import adds the
  ones not already there by kind and name.

## Poser: cinches, see-saws, the bamboo, the pencil (October 2026)

**Status:** built (2026-10-26)

- **▲ and ▼ beside every slider's box**, one step each, each tap one
  change to undo. Holding to repeat was offered and not wanted.
- **The preset menus' own sheet: not now.** Body… and Arms… are the
  phone's own `<select>` picker, whose popup can't be given a ✕ or a
  Cancel. A sheet of our own (title, ✕, presets, Cancel) would do it, and
  was put off by choice: the native pickers stay.
- **A bamboo's length and hanger inset** are in the pose
  (`[x, y, z, turn, length, inset]`), 90–215 cm long (about 3 to 7 ft), the
  inset keeping both hangers on their own side of the middle. A new one is
  152 cm, hung 30 cm in. Older four-number bamboos read as 150 cm hung 8 cm
  in, as they were drawn, so no migration (poses are JSON). Shortening it
  slides rope points in to stay on it, rather than taking ropes off. The
  ring's and bamboo's lines are a twisted three-strand jute rope, a fixed
  9 m long from the hardpoint up out of sight, so moving the hardpoint
  doesn't stretch the twist or rebuild the geometry.
- **Hanging stretches are drawn straight**: a rope from the body to the
  ring or bamboo is taut, so it's a straight run; the rest of a rope,
  round the body, still curves through its points. One curve through
  everything bowed a rope over the ring outward.
- **Cinches** are ropes tied between two spots: at least one on an
  upline's hanging stretch, the other on another upline, another rope or
  the body. A spot is `["rope", index, segment, along]` (thousandths along
  that segment's straight line). The cinch's length is saved, capped at
  taut: shorter, the gap between its ends closes, an upline end moving
  toward the other (half each when both are uplines) and bending the
  upline in two straight runs; an end on the body or a body rope stays
  put (bending a rope away from the body it's wrapped on would look
  wrong). Slack (a cinch longer than the gap, sagging) was weighed and
  left out: it stops at taut. One cinch per rope for now, and none on a
  cinch, so ropes don't chain; erasing a rope takes its cinch, and the
  rest are renumbered. Ropes reference each other by index, so anything
  that removes ropes or changes a rope's points in number goes through
  `relink` (pose-format.js).
- **"Move the body"** (ticked for a new cinch) keeps each cinched
  upline as long as it was before the slider moved, by turning the joints
  between the body and the upline's end (an arm's or leg's, as dragging
  it would; the waist and chest; the whole body's tilt and height for the
  hips), so cinching a chest upline to a thigh upline draws the chest and
  thigh together. It's the drag solver's method (`pose-constraints.js`),
  not physics: nothing weighs anything, so it finds a fold that keeps the
  lengths, not necessarily the one a body would hang in, and gets as near
  as it can when the joints' limits stop it. It runs only while the cinch
  slider moves, so the body can be posed freely afterwards. Whether it's
  ticked is the poser's own (`still` on the rope, dropped on saving).
- **See-saw ropes**: a rope from the body over the ring or bamboo and
  back to the body keeps its length, so when a joint moved (slider, ▲▼,
  typing, or dragging a limb) brings one end closer, the other end's joints
  (not the ones moved) take it up. Optional per rope (`s: true`, saved),
  ticked for a new one, since some uplines are tied off at the ring.
  Skipped when nothing can balance it: moving the whole body or the
  hardpoint, the other end on the hips, or on the joints moved.
- **Choosing a rope is by distance on the screen**, not by hitting its
  1–2 cm tube: a tap chooses the nearest rope within 18 px (a finger's
  width), unless it's hidden behind the body or hardpoint there
  (`pose-scene.js`). Hitting the tube exactly was too hard, even zoomed
  in. The trade-off, accepted: while no rope is being laid, a tap on the
  body right beside a rope chooses the rope rather than starting a new
  one; once one is being laid, taps go to the body.
- **"Move along bamboo"**, for a chosen upline on the bamboo, swaps the
  bamboo's sliders for one, where along it that end is tied (cm from the
  middle), with Done to go back. It moves the bamboo end of the stretch
  tapped.
- **The poser's tools stay in one row** from 375px wide (Add to visuals at
  the end; narrower, it gets a row of its own rather than going off the
  edge), and the sliders' panel, 37% of the screen's height, fades at the
  bottom while there's more to scroll; its message line takes no room when
  empty.
- **The pencil draws flat on the screen**, not in 3D: marks are in view
  units (1000 down the view's height, x from its middle), so they stay on
  what they were drawn over whatever shape the view or picture is (the 3D
  view's field of view is up and down). They aren't saved with the pose,
  only drawn onto "Add to visuals" and the download's picture, and show
  only on the view they were drawn on: turning it hides them, and drawing
  on a new view starts afresh. In pencil mode fingers only draw, so the
  view can't be knocked out of line. Marks attached to the 3D scene, so
  they'd turn with it, were weighed and left for later (much more work,
  and marks in empty air need a rule). Saving them with the pose was
  weighed too: it would change the format, the limits and the export.

## Sharing between accounts (October 2026)

**Status:** planned (2026-10-24). Phase 1 (two notes fields on people)
built and deployed 2026-10-24, migration 0021. Phase 2 (shares on the
server) built 2026-10-24, migration 0022, deployed to dev. Phase 3
(profile invites) built 2026-10-24, migrations 0023 and 0024, not yet
deployed. Phase 4 (connecting accounts) built 2026-10-26, migration 0026,
not yet deployed. Phase 5 (sharing ties, plans and workshops) built
2026-10-26, no migration, not yet deployed. Phase 6 (photos and videos in
shares) built 2026-10-27, migration 0027, not yet deployed; the rest
isn't built.
The build plan is at the end of this section.

Goal: let people send each other copies of ties, plans and workshops, and
add each other's profiles to People, without the server ever being able to
read what's shared. Messaging and shared plans come later (Connections,
below).

### What decides the design

- **Everything is sealed with one person's key.** Each account has one data
  key that only its own devices can unlock, and the server can't read
  notes, descriptions, aliases, captions or photos. So anything shared is
  opened on the sender's device and sealed again under a key meant for
  someone else. The server only ever passes along what it can't open.
- **Some things can't be prevented, and the app mustn't promise them.**
  Once something is open on the recipient's screen, they have it: a
  screenshot, a screen recording or another phone gets around any block.
  "Can't be downloaded" would be untrue. What we can do:
  - **View-only**: never added to their journal or their export, no save
    button, photos drawn on a canvas, not as saveable images. This stops
    casual saving, not someone determined.
  - **Can't be forwarded**: a verification code at the moment it's opened
    (below) makes a forwarded link useless. Sealing a share so only one
    account can ever open it needs Connections' identity keys.
  - **Expiry and Revoke**: the sender can end a share, and the server
    deletes its sealed copy.
  - **A watermark** with the recipient's name on view-only photos, to
    discourage passing them on.
- **Connections between accounts are new information for the server.**
  Today it sees separate journals. Knowing that two accounts know each
  other is information about people, even with everything else sealed. So
  it's only ever created when someone chooses it, after a disclosure, and
  either side can remove it (see "Connecting accounts").

### Two ways to share, and the one chosen first

- **Option A, "send a copy" links (chosen first).** A share is a sealed
  snapshot behind a link, and a QR code is just that link. No long-lived
  new keys, nothing about who shares with whom kept on the server unless
  someone chooses to connect accounts, and the recipient's side reuses
  import. Anyone who has the link (and passphrase, if one is set) can open
  it, unless the sender also asks for a verification code.
- **Option B, Connections (later).** Each account gets an identity key
  pair. Things sent between connected accounts are sealed to the
  recipient's own key, so only they can open them. Shared plans with
  messages, sending in the app and profiles that keep themselves up to
  date need it. It's a much bigger piece of work, and builds on the
  connections table Option A adds (see "Later: Connections").

### Share links

- **The link is `/open#<share id>.<key>`.** Both are after the `#`, which
  the browser never sends to the server, puts in a Referer header or in a
  request log. The key is 32 random bytes, not anything typed (the rule
  against user-entered text in addresses still holds). The page reads it,
  removes it from the address (`history.replaceState`) and keeps it only in
  memory. As the app is one page, it survives the Sign in and Unlock steps
  without being written anywhere. `/open` is an ordinary route
  (`needsKey`), so the router needs no pattern matching.
- **A snapshot, not a live copy.** What's shared is what the item was when
  the share was made. Editing the original later doesn't change it.
- **Sealed on the device with a fresh share key**: AES-256-GCM, bound to
  the share's id, kind and format version, like wraps and captions are.
  The share key isn't the data key, and the crypto Worker never returns or
  wraps the data key for it. Sealing and opening shares are new Worker
  operations, so photos are opened and sealed again there, as now.
- **Opening one**: the recipient must be signed in and unlocked (Sign-up is
  still invite-only, so the page says so if they have no account). The
  page fetches the share by its id in a POST body, opens it and shows a
  preview. **Add to my journal** saves it through the import code that
  exists already (`import-plan.js`, `import-dedupe.js`, the photos and
  drawings imports), so new ids, tags and duplicates work as they do for
  an import. Opening your own share shows it, but there's nothing to add.
- **The sender chooses** for every share: how long it lasts (10 minutes,
  1 hour, 1 day, 7 days, 30 days, or until revoked) and how many people
  can open it (one, or any number), plus optionally a passphrase, a
  verification code and view-only. The Share screen warns about one
  combination: a profile invite that never expires, can be used by
  anyone and offers to connect accounts lets anyone who ever sees that QR
  code connect to you (on social media, say).
- **Shared by me** (in Your data) lists every share that hasn't ended: its
  kind, the name the sender gave it (sealed with their own key), when it
  ends and how many times it's been opened (counts only, never by whom),
  with **Revoke**. It also lists connections made from profile invites.
- **Where it's kept**: a `shares` row in D1 (owner, kind, the sealed name,
  expiry, uses allowed and used, revoked, which locks are on) and the
  sealed snapshot and photos in R2. They count toward the sender's 1 GB.
  The daily job deletes shares that have expired, been used up or been
  revoked, and their files. A deleted account's shares go with it, files
  read in the same batch as the delete (the photos rule).
- **The QR code** is drawn as SVG elements with `h()` (no `innerHTML`),
  and there's a Copy link button and the phone's share sheet
  (`navigator.share`) for sending it over Signal and the like. **No
  scanner in the app**: a phone's own camera opens the link. That keeps
  `camera=()` in Permissions-Policy, and Safari still has no
  `BarcodeDetector`, so a scanner would need a decoding library too.
  Making QR codes needs a small library, vendored like mediabunny and
  three.js (needs permission to install). It sees every share's key, as
  the key is in the link it encodes, so: one with no dependencies, read
  before it's vendored and pinned there (`vendor.mjs --check`); only its
  grid of squares is used (no SVG strings or `data:` images, which Trusted
  Types and the CSP refuse anyway); loaded only when the Share screen
  opens; and tested against known codes, so a change to what it draws
  shows up. Writing our own encoder is the fallback if none passes that
  reading.
- **Installed app**: on iPhone a scanned link opens in Safari, not the
  installed app, so the recipient signs in there. That works, it's just a
  second place they're signed in.

### Locks on opening

- **Passphrase**: a second factor, never the only one. Sealed only by a
  passphrase, the server's copy could be guessed offline as fast as a
  computer can go. Instead the key that opens it comes from both the
  link's key and the passphrase (PBKDF2, many rounds, then HKDF with the
  link's key), so neither works alone. From the passphrase the page also
  makes a separate proof; the server stores only a hash of it and sends
  the sealed share only after the right proof, with a limited number of
  wrong tries (then the share is cancelled). Suits a class: one
  passphrase said out loud.
- **Verification code**: the sender has to be there when it's opened.
  1. The sender ticks "Require a code when opened". Their screen shows the
     QR code and "Waiting for them to open it…", asking the server every
     few seconds.
  2. The recipient opens the link. Their page makes a random one-time
     claim id and sends it. The server keeps `(share, claim id)`, not who
     the recipient is.
  3. The sender's screen shows a 6-digit code; the server stores only its
     hash.
  4. The recipient types it. Right, and the server sends that claim the
     share and deletes the claim; 5 wrong tries cancel the share.

  A forwarded or photographed link is then useless without the sender,
  there or on a call. It's a check by the server, not sealing to one
  account (that needs Connections), but it covers the worry. Not for
  classes (20 people, 20 codes): that's what the passphrase is for.
- **The server knows who's opening at that moment**, as with every request
  from a signed-in person, but doesn't store it: claims hold a random id,
  and there are no request logs.

### What can be shared

- **Ties, plans and workshops: every field can be shared**, each ticked on
  the Share screen: title, date, type, rating, location (its name and
  place, not its notes), plans, tags, people with their roles and notes,
  notes, description, album link, and visuals. **People go as names only**:
  never their account ids or anything from their profile.
- **Who's who on the recipient's side: "Who is this?" for every person.**
  A shared name can be spelled differently from the recipient's card for
  the same person, or match a card for someone else entirely, so names
  are never matched silently. The preview lists each person on the item
  with their role, and for each one the recipient picks **Me**, one of
  their people, or **New person** (named as shared, which they can
  change). Choosing Me keeps their role, so Calendar, Analytics and
  Education count it right. The preview suggests a choice for each one,
  and the recipient confirms them all before anything is added:
  - the sender (the snapshot marks which name is theirs, not their
    account) is suggested as the recipient's linked card for them when the
    two are connected: the server can tell the recipient's page which of
    its own cards that is without telling it the sender's account id;
  - a name that matches one of their people exactly (ignoring capitals) is
    suggested as that person;
  - anyone else is suggested as New person.

  Two shared names can't both become the same person (one person is on an
  item once), and two people with the same name in a share stay two. The
  choices are pure (`share-people.js`: the suggestions and whether a set
  of choices can be saved), then the import code adds the new people and
  links everyone by id.
- **A profile (a "me" invite)**: name, pronouns, each social or scene name
  on its own, based in, Educator, About me, and Connect our accounts
  (see "Connecting accounts"). Private notes are never offered.
- **Visuals**: photos and videos are opened and sealed again under the
  share key and uploaded with it; drawings and poses go in the snapshot as
  their lines and numbers, captions included.

### Two notes fields on people

- **`people.notes` stays private** and never leaves the journal. On every
  card it's "Private notes".
- **A new encrypted `people.about`.** On my own profile it's **About me**,
  the part a profile invite can share. On someone else's card it's
  **About them, shared by them**: shown but not edited there, and replaced
  only by their next share. Hidden on others' cards while empty.
- **Adding a shared profile**: **New person**, or **Add to an existing
  card** (active people, not me). For an existing card a merge dialog asks,
  field by field, whether to replace or keep the name, pronouns, usual
  role, based in and Educator, and whether to add the new social names to
  the list or replace it. About is replaced when they shared one (it's
  theirs), with the date; private notes are never touched. The rules are
  pure (`contact-merge.js`).

### Connecting accounts

- **Optional**, unticked, on profile invites only, as **Connect our
  accounts**. Ticking it shows: "Connecting your accounts lets NotoNawa's
  server see that the two accounts know each other. It still can't read
  anything in either journal. You can remove the connection at any time
  from Shared by me, and it's deleted if either of you deletes your
  account. Without it, these won't be possible with this person: sending
  them ties, plans and workshops inside the app (sharing by link or QR
  code still works), shared plans with messages, offering them a copy of
  ties you log with them, and their profile card updating when they
  change it."
- **The recipient confirms too**, with a shorter version: the connection
  reveals their account as well. If they say no, the card is still added,
  just not linked.
- **Account ids never leave the server.** The invite carries no account
  id: accepting it makes a row in a `connections` table (its own random
  id, the two accounts, when) between the share's owner and whoever
  accepted. Either side can delete it. A table rather than an account id
  on the recipient's card, as that card belongs to the recipient and the
  sender couldn't remove it.
- **The card holds the connection's id, not the person's account id**: a
  new `people.connection_id` (`linked_user_id`, there since migration 0001,
  stays unused). The database allows it only while that connection exists
  and the card's owner is one of its two accounts, clears it when the
  connection goes, and allows one card per connection in a journal.
  Linking to yourself is refused. Deleting either account deletes the
  connection. Everything that needs the other account (the sender's card
  on a shared tie; later, sending in the app) goes through the connection
  on the server, so no page ever learns another person's account id.
- **The sender doesn't learn who connected** unless they share back. Shared
  by me shows "Connected through *the invite's name*, 2 Nov", the sealed
  name copied from the share, with Remove.
- **The link icon**: a linked card shows a yellow link icon top right
  (right of the Educator cap, if there is one), and its dialog shows it
  where "This is me" is on my own profile, with "Linked to their account"
  as its label and Remove link beside it. Color isn't the only clue: it
  has its own icon and words.
- **Export and import**: a card's `connection_id` is exported with it, and
  my connections are listed (their ids and dates, no account ids), as
  notices are. Import keeps a card's `connection_id` only if that
  connection still exists and the importing account is one of its two;
  otherwise the card comes in unlinked and the import says how many
  links couldn't be kept. So restoring a deleted card, or the journal
  after being locked out and recovered into the same account, keeps its
  links; importing into a new account doesn't, as the other person agreed
  to connect with the old one (they can send a new invite). An edited
  file can't link to anyone: an id that isn't one of my live connections
  is refused like any other. Shares by me are listed but not imported.
  The round-trip test covers both a kept and a refused link.
- **PRIVACY.md** must say what the server holds: sealed shares until they
  end, their counts, and connections that people chose. Whether existing
  accounts must agree again is a decision for when it's written: nothing
  new is collected unless someone chooses to share, so a notice may do.

### Connecting accounts as built

Built 2026-10-26 (migration 0026). What changed from the plan above, and why:

- **A connection is two rows, one for each account** (`connections`:
  `owner_id`, `peer_id`, `invited`, `label`, `answered`), made in one
  batch; deleting either deletes the other (`trg_connections_pair`). So
  every query is scoped to `owner_id` as everywhere else, each side's
  sealed label fits the encrypted-columns lists (scoped to its owner), and
  a page only ever sees its own row's id: even the connection's id means
  nothing to the other account. `people.connection_id` holds my row's id;
  the triggers just check the row is mine (and the card isn't "Me").
- **The invite says it offers to connect, in plain** (`shares.connect`,
  profile invites only). The server can't read the invite, and without the
  flag anyone who opened any profile invite could connect to its owner.
- **Opening it makes an offer, accepting spends it.** A one-use invite is
  deleted as it's opened, but the recipient decides after the preview. So
  opening someone else's connectable invite (when we aren't connected
  already) returns a random token; `connection_offers` keeps its hash, the
  inviter and the invite's sealed name for a day, not who opened it.
  Accepting (`POST /api/connections`, after the card is saved) makes both
  rows, links the card and deletes the offer, all in one batch; if we're
  connected already, that connection is used and the link moves to the
  card chosen.
- **The inviter answers "Which of your People is it?"** with a banner
  after the notices: Add to a Person, New Person (a name typed in: nothing
  of the accepter's comes with it) or Not now (`answered`). It says
  "Someone accepted your invite": with an invite anyone can use, the
  inviter can't know who. Their own details come later, if they share a
  profile back: opening an invite from someone I'm connected to says so
  (`connection_id`), suggests the card linked to them, and links the card
  I choose.
- **Names on both sides.** The inviter's row holds the invite's name,
  copied (it's sealed as a share's label, so it's opened as one); the
  accepter's, the name the profile was shared as, sealed with their own
  key. Shared by me's Connections list uses them for a connection on no
  one: "Not on any Person · through "Munch"" or "shared as "Rin"", with
  Add to Person and Remove.
- **A connection outlives its card.** Deleting a linked card leaves the
  connection (in Connections, on no one), so restoring the card from an
  export links it again.
- **Remove link removes the connection for both**, from the card or from
  Connections, and can also clear the About I shared from their card for
  me (`DELETE /api/connections/:id?about=remove|keep`, the choice
  required, like deleting a plan's). About on someone else's card only
  ever comes from their invites, so the server can clear exactly that
  without reading it. Removing is allowed before agreeing to a changed
  privacy policy, as deleting the account is.
- **Import keeps a link** only to one of my connections not already on
  someone, and not on "Me"; the rest come in unlinked, counted as
  `links_dropped` in the preview and the result. The export lists my rows
  (`account.connections`: id, invited, label, answered, created_at).
- **PRIVACY.md** now covers sharing and connections (and the About fields
  from phase 1), as a wording change with a new version, not one people
  must agree to again: nothing new is collected unless someone shares or
  connects. A notice should go out before deploying.

### Sharing ties, plans and workshops as built

Built 2026-10-26 (no migration). What changed from the plan above, and why:

- **Share is in each saved item's dialog** (tie, workshop, and the plan
  dialog's actions beside Archive and Delete), and shares the item as last
  saved, not what's typed. The dialog (`share-item-dialog.js`) loads what
  the form doesn't have: my profile (to mark me), the location's place and
  the drawings and poses. Every field is a tickbox, all ticked, except
  what the item can't do without (a tie's date and type, a workshop's
  title and dates, a plan's title). The snapshot is built and read by
  `share-item.js` (pure), strictly, like a shared profile.
- **People's notes and ratings on a tie aren't offered**: the tie form
  never loads or shows them (only the export has them), so the sender
  couldn't see what they'd be sending.
- **"Your name on it"**: when my profile is on the item, the dialog asks
  the name to show for me (blank while it's still "Me"), and that person
  is marked `sender`.
- **A person is on an item once**, strictly, as the plan says, even though
  a tie allows someone in two roles: no two shared people can be the same
  one of mine (`share-people.js`). The suggestions follow the plan; a
  match already suggested for someone else falls back to New person.
- **The location and the tie's plans get a choice too** (asked 2026-10-26):
  the name match or New, so nothing is matched silently. A new location is
  added active, not as an archived one-off.
- **Through the import, with one change**: an item sent with `match: false`
  is always added, never matched by name (`src/data/import-plan.js`), so a
  New person named like one of mine stays new, and a shared plan isn't
  swallowed by one of mine with its title. People, locations and plans
  chosen from my journal aren't sent at all; the page fills in their ids
  (`share-to-import.js`) before the import swaps the share's ids for mine.
  Drawings and poses are saved one by one afterwards, in the shared order
  (each goes last as it's saved, so no reordering is needed).
- **Already in my journal?** A tie or workshop is checked with the
  import's duplicate preview (one with anything new can't be a
  duplicate); a plan, by the same title, description and notes. Either
  way the page says so and offers **Add another copy** (asked 2026-10-26).
- **Photos and videos** aren't shared yet (phase 6); the dialog says so
  when the item has some.

### Photos and videos in shares as built

Built 2026-10-27 (migration 0027). What changed from the plan, and why:

- **A migration after all** (the build plan said none). A share was one
  request; with photos it's its row and snapshot, then each file (up to 30,
  a video up to 40 MB), so `shares.ready` (0 while uploading: it can't be
  opened or listed, so nobody gets half of it) and `shares.files` (how many
  it has). Each file's size is added to `shares.bytes` in the statement
  that checks the 1 GB, as a photo's row is. `POST /api/shares/:id/ready`
  checks they're all in R2, and starts the expiry again from then, so
  uploading doesn't use up a 10-minute share. If any step fails, the page
  revokes the share. One never made ready is deleted after a day, and
  counts in the 50 till then. Weighed: uploading the files first and making
  the row last, with no migration; files with no row count toward no one's
  1 GB, so the bucket could be filled until the daily sweep.
- **An hour's grace for the files.** A share's last allowed open deleted it
  at once, but the recipient fetches the photos after opening it (when
  they choose Add), and a short expiry could end mid-add. So a share with
  files is ended, not deleted, by its last use (`expires_at` set to now),
  and its files can be fetched for an hour after it ends, either way;
  nobody can open it again, and it's off Shared by me. The daily clean-up
  deletes it after the hour. Shares without files are deleted at once, as
  before; revoking still deletes everything at once.
- **Fetching a file** (`POST /api/shares/files`, the ids in the body as
  for opening) needs a signed-in account, the share live or in its hour,
  and the file's id: a random UUID listed only in the sealed snapshot. Not
  rate-limited (a share has up to 30 files, and the opening that gave out
  the ids is).
- **Sealed in the same format as my own photos** (`media.js`: the
  thumbnail, then the full size, a video's in 1 MB pieces), with a key made
  from the link's by HKDF ("notonawa share v1 file", not the snapshot's),
  each part bound to the share's id and the file's. The plan said pieces
  for photos too; keeping the format means a shared file is the size of
  mine, so the same limits fit. `media.js` now takes the binding as a
  parameter; my photos' bytes are unchanged, pinned by a test that spells
  out the additional data.
- **Nothing opened leaves the crypto Worker** but a thumbnail for the
  preview: `reshareMedia` fetches one of mine, opens it and seals it with
  the link's key; `adoptShareFile` fetches a shared one, opens it and seals
  it as mine under a new id, for `uploadSealed`. The Worker fetches share
  files itself, as it does my photos.
- **Their own tickbox, "Photos and videos"**, apart from "Drawings and
  poses", saying what they'd take of my 1 GB. Each gets a new random id in
  the share, so nothing in it names the photo in my journal. Both groups
  keep the one order of the item's visuals; the recipient adds them in
  that order, and any that fail (their own 1 GB or 30 an item, or the
  share revoked) are counted, as drawings' were.

### Later: Connections (Option B)

Planned once Option A is in use; built on its `connections`.

- An identity key pair (ECDH P-256) per account: the public half on the
  server, the private half sealed with the data key, so it unlocks with
  the journal. Connecting through a QR code compares a fingerprint of the
  key, so the server can't swap in its own and read along.
- **Sending in the app**: ties, plans and workshops sealed to the
  recipient's key, into a "Shared with me" inbox. Logging a tie with a
  connected person offers "Send [name] a copy?", each time, never
  automatically: a tie can hold notes nobody meant to send.
- **Shared plans with messages**: a shared plan is a space with its own
  key, wrapped to each member's key, outside `plans` (whose ownership
  triggers allow one owner a row). Its content and message thread are
  sealed with that key; removing someone makes a new key. Messages are
  fetched when the plan is opened, with an unread count; no push. Leaving,
  deleting your own messages and blocking from the start.
- **Profiles that keep up**: a connected person's changed pronouns or
  socials show as "Updated info available", never overwriting by
  themselves.
- **View-only for one person**: an educator's handout sealed to one
  account, so it can't be forwarded at all.

### Weighed and not adopted

- **Shares the server can read**: simplest, and the end of end-to-end
  encryption.
- **Sealed by a passphrase alone**: guessable offline from the server's
  copy (see "Locks on opening").
- **The key in the query string** (`?key=`): sent to the server and into
  logs. After `#` it isn't.
- **Leaving people's names off shared ties by default**: every field is the
  sender's choice instead, but never their account ids or profiles.
- **A fixed 10-minute profile invite**: the sender chooses how long, with
  the warning above.
- **The account id kept only inside the recipient's sealed card**: the
  server couldn't see the link, but the sender could never remove it, and
  Connections would need a real connection anyway.
- **The other person's account id on the card** (`linked_user_id`): it
  would go into exports, and an edited file could name any account. The
  connection's id means nothing outside its two accounts.
- **An "Approve" button for the sender** in place of the code: it doesn't
  show who is opening it; someone else could open it at the same time.
- **A plain table of shares I've received**: it would show the server who
  receives from whom. View-only shares I keep are listed inside my own
  sealed data instead.
- **Promising "can't be downloaded"**: untrue (see above).
- **Automatically sending every new tie to a connected person**: too easy
  to send notes nobody meant to.
- **A QR scanner in the app**: the phone's camera already opens links.
- **QR codes made by the server or an online QR service**: the share's key
  would leave the device.
- **"Request share"** (an inviter asking a connected person for their
  profile, as a banner on their side, weighed 2026-10-26): without Option
  B, all it could do is ask them to make a link and send it outside the
  app. It fits Option B's sending in the app.
- **Replies sealed with the invite's own key** (both sides have it; the
  server never did): it would let the accepter send their profile back in
  the app, but anyone else who saw the link would also have that key, so
  someone with the link and the server's data could read the reply (worse
  for an invite anyone can use). Identity keys (Option B) do it properly.
- **Clearing the social names I shared from their card** when removing a
  connection: they're one sealed list per card, mixing what I shared with
  what they typed, so the server can't take out just mine. Marking each
  shared one inside the list would work, but only for names shared after
  the change, applied by their page on their next unlock. Only About is
  offered.

### Build plan

Each phase leaves the app working and shippable, with tests for its new
behavior, `npm run check:changed -- --ui` after each change and the full
checks before a release. Times are rough, in working days with Claude,
tests and the walkthrough included.

1. **Two notes fields on people** (about 1 day). *Built 2026-10-24.* The
   About field's label and whether it's shown come from `person-about.js`
   (pure). PRIVACY.md isn't changed yet: it's folded into phase 4's update,
   so people see one new policy version when sharing arrives (until then it
   names fewer encrypted fields than there are, never more). Migration 0021:
   `people.about`, encrypted. `src/encryption/config.js` and
   `crypto/fields.js`, `src/resources/config.js`, the People dialog (About
   me on my profile, Private notes on every card, About them shown and
   not editable on others' when filled), export and import
   (`src/data/shape.js`, `import-parse.js`, `journal-fields.js`), PRIVACY.md
   (one more encrypted field). Tests: the encrypted-columns unit test, the
   export round trip, the People walkthrough chunk. *First: small, no new
   ideas, and invites need it.*
2. **Shares on the server** (2–3 days). *Built 2026-10-24.* Changed from
   the plan: revoking deletes the row and files at once (no `revoked_at`);
   the last allowed open deletes the share in the same request (a use
   counts when the sealed copy is sent, since that's when it can be
   read); an ended share and one that never was get the same 404; the
   passphrase, claims and view-only get their own migrations in phases 7
   and 8. Snapshots are in the photos bucket under
   `<owner id>/shares/<share id>/`, so deleting the account's files takes
   them; the photo sweep checks them against `shares`. Starting a new key
   deletes the account's shares (their names couldn't be opened). The
   link's key goes into HKDF before sealing, so phase 7 can mix in a
   passphrase. As first planned: Migration 0022: `shares` and
   `share_claims`. A new `src/shares/` (`parse.js`: kinds, expiry choices,
   uses, limits; `db.js`; `storage.js`: R2 under `shares/`; `routes.js`:
   create, upload files, list mine, revoke, open). Cleanup in
   `src/cleanup.js`, account deletion, a rate limit for opening (a new
   binding in both environments in `wrangler.jsonc`, `npm run types`), the
   export lists shares by me. `crypto/share.js` (pure: the share key,
   sealing a snapshot bound to its id, kind and version) and its Worker
   operations. No pages yet, so nothing for users changes. Tests: unit for
   parse and crypto; API for expiry, uses, revoke, ownership, the daily
   cleanup, account deletion (`account-delete.test.js`). *Alone because
   it's the security-critical part, worth reviewing without UI around it.*
3. **Profile invites** (2–3 days). *Built 2026-10-24.* Changed from the
   plan: the name to share is typed in (suggested from my profile's, or
   empty while it's still "Me", which would mean nothing in someone else's
   People), not ticked; and each share keeps its link's key, sealed with
   the owner's data key (`shares.link_key`, migration 0023), so Shared by
   me can show the code again. The cost: anyone who could unlock my journal
   could open my live shares, a small step past having the journal itself.
   The key isn't exported (it opens the share, so it stays with the
   account, as wraps do). uqr 0.1.3 was read in full and vendored; only its
   `encode()` is used, with medium error correction and a 4-square border,
   and a test pins its output. A share arriving from another account is
   read strictly (`profile-share.js`). Opening a share spends a use, so the
   opened contents are kept in memory until added or locked, and coming
   back to `/open` shows them again. After trying it: Share my profile
   sits in the middle of the dialog's title row; the usual role can be
   shared too (stored as the role, so it reads in each account's own role
   names; a merge keeps the role I'd set for them unless I choose theirs);
   and About them says when it was shared (`people.about_shared_on`,
   migration 0024, a plain date: the server sees the save anyway). An
   invite without an About leaves the card's About and its date as they
   were, rather than emptying them. As first planned: Needs the QR library (vendored, with
   permission). The Share screen (what to include, how long, how many
   people, the QR code, Copy link, the share sheet), the `/open` route,
   view and template, opening and the preview, New person or Add to an
   existing card, `contact-merge.js` (pure), Shared by me in Your data.
   No connecting accounts yet. Tests: unit for the merge rules and expiry choices;
   a walkthrough chunk where one account makes an invite and a second
   opens it (two accounts in one chunk, new to the harness). *The smallest
   piece people can use.*
4. **Connecting accounts** (2 days). *Built 2026-10-26, migration 0026;
   see "Connecting accounts as built" for what changed.* As first planned:
   Migration 0023: `connections`,
   `people.connection_id`, triggers allowing it only for a live
   connection the card's owner is in and clearing it with one, the
   one-card-per-connection index. Import keeping or refusing links. Routes to accept
   one (inside opening an invite) and remove one; the two disclosures; the
   link icon on cards and in the dialog; Remove link; connections in Shared
   by me and the export; PRIVACY.md, and a notice. Tests: `test/db/` for
   the triggers and index, API for accept, remove, account deletion
   from either side and import (kept, refused, another account's), the walkthrough for the disclosures and the icon.
5. **Ties, plans and workshops** (3 days). *Built 2026-10-26, no
   migration; see "Sharing ties, plans and workshops as built" for what
   changed.* As first planned: A Share button on each dialog,
   choosing fields; the snapshot built from what the page already has
   open; the preview with "Who is this?" for each person
   (`share-people.js`, pure); adding through the import code. Drawings and
   poses go in the snapshot. Tests: unit for building and reading
   snapshots and for the people choices (suggestions, a name matching
   someone else, two people of the same name, two names chosen as one
   person); an API check that a share round-trips into the second journal
   with people chosen; and the walkthrough for one of each kind.
6. **Photos and videos in shares** (2 days). *Built 2026-10-27, migration
   0027; see "Photos and videos in shares as built".* As first planned:
   Opening and sealing again
   under the share key in the crypto Worker, uploading with the share,
   counting toward 1 GB, the recipient's import of them
   (`import-photos.js`). Tests: crypto unit tests, an API test of the
   files' limits and cleanup, the walkthrough with one photo. *Apart from
   phase 5 because R2, sizes and video make it its own risk.*
7. **Locks on opening: passphrase and verification code** (2–3 days).
   Both change only creating and opening a share: the passphrase proof and
   key, claims and codes, the sender's waiting screen, wrong-try limits.
   Tests: unit for deriving the keys and proof; API for wrong tries,
   cancelling, a claim used twice; the walkthrough with two accounts and
   a code.
8. **View-only** (2–3 days). Opening without adding, a sealed "Shared with
   me" list in my own data, photos drawn on a canvas with the watermark,
   nothing in the export (it isn't mine). Tests: that view-only shares
   never reach the journal or the export, the walkthrough.

Then Connections (Option B), planned separately when the time comes.

## Reloading a page left open over a deploy (October 2026)

A page keeps running the code it loaded, so after a deploy an open tab
(often on a phone) unlocked into the old version, with no new features and
no "What's new", until it was reloaded by hand. The files were never cached
(`no-store`); it was only the open page.

- **Checked while locked, on the sign-in and Unlock views** (`GET
  /api/version`, compared with the page's `APP_VERSION`): nothing unlocked
  is lost and no form is open. On showing, on coming back into view (phones
  lock after 5 minutes in the background, so that's usually when), and once
  more when Unlock or Sign in is tapped, which then reloads instead, and is
  tapped again on the new page.
- **Only a newer version reloads**, not just a different one: a reloaded
  page is on the server's version, so it can't reload over and over (say,
  if the files were briefly out of step), and nothing needs remembering in
  the browser's storage. Rolling back a deploy doesn't reload open pages.
- **Not while a share link is waiting to be opened**: its key is only in
  memory. It's forgotten at the next lock, and the check after reloads.
- **Not adopted (for now): a "new version, Reload" banner while
  unlocked.** It would mean reading the version off every API response.
  A tab in use the whole time catches up at its next lock (at most 15
  minutes idle) instead.

## No pull-down-to-reload (October 2026)

Pulling down at the top of a page reloads it on phone browsers, and it was
easy to do by accident (scrolling the ties list, using the poser's
controls); a reload locks the journal, so it meant unlocking again.
`overscroll-behavior-y: none` on the page turns it off, and `contain` on
dialogs stops a dialog's scrolling carrying on to the page under it.
There's no Reload in the app to replace it: there's little need, as a page
left open over a deploy reloads itself (version-check.js). Android's
browsers follow the setting; whether Safari on the iPhone stops its own
pull-to-reload too is to be tried on a phone. Installed to the home
screen, neither has pull-to-reload at all.

