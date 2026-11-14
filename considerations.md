# Considerations

Design ideas we've weighed, planned features, and the reasons behind them, so
we can revisit them later.

## Privacy and accounts

**Status:** built and deployed (its migrations, through 0013, applied to
the remote database, checked 2026-10-19). Videos were built 2026-10-20 (no
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

Built 2026-10-20 (no server change at the time: a drop saved with `PUT
/api/media/order`, as the buttons did; since "Visuals: photos, drawings
and poses in one order", both save with `PUT /api/visuals/order`).

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
gets slow with many thousands of ties. Only ties count towards recency:
plan and workshop tags don't (see "Tie types, plan tags, album links and
release notes").

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
  page), as RELEASES.md and PRIVACY.md are built. It mentioned features
  not built yet (the map, workshops) on purpose; both are built now.
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
  isn't lost); Esc does. (Since then People and Locations got dialogs too,
  and the plan form became `plan-form.js`, a dialog of its own: see "The
  plan form, a dialog of its own".)
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
  gets Close only, as the API refuses the rest. (Since replaced by icons on
  the dialog's heading row: see "Edit dialogs: heading icons and unsaved
  changes".) Notes show in the dialog
  only; the card shows pronouns, the usual role as an outlined tag (in
  the account's words), "based in …", "aka …" (scene names first, others
  with their platform), and a cap, in the accent outline, for educators.
  The workshops that use the educator flag came next (see "Education").

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
  was put off by choice: the native pickers stay. (Built since: see "Poser:
  pickers, twists and the whole body's sliders".)
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

## Poser: a realistic body from Anny (October 2026)

**Status:** built (2026-10-29)

- **Anny, not the atlas's code or SMPL.** The body is Anny's
  (github.com/naver/anny): its code is Apache 2.0 and its body assets are
  MakeHuman's, CC0, so they can ship in the app. We don't use its
  SMPL-X topology, which is non-commercial only. MMHuman3D was looked at
  and isn't for this: it estimates poses from photos, on SMPL. The 3D
  anatomy atlas (github.com/authorOd/3d-anatomy-atlas) has CPAL-1.0 code,
  so we wouldn't take its code. Its nerves come from Z-Anatomy (CC BY-SA),
  which is where we'd take the nerves from, for the overlay
  (roadmap.md).
- **Always an adult.** Anny's age slider at 0.5 sits between "child" and
  "young adult", so its own demo's default is a teenager. The figure's age
  is fixed at Anny's young-adult setting, with no age slider.
- **Built offline, blended in the browser.** Anny is Python and PyTorch,
  with no browser or glTF export. `scripts/figure/` takes its body at the
  36 corners of the sliders (gender, muscle and weight at three settings,
  height at two), posed arms down. It packs them as 23 components, which
  give those shapes exactly, into `public/figure/body-1.bin` (now
`body-2.bin`, as a changed body needs a new file name; 2.3 MB, about
  1.8 MB compressed, cached a week). Anny blends between corners linearly,
  so a shape between them is their blend, made on the device when a slider
  moves. No morph targets on the GPU: the shape changes rarely, so the
  skin's vertices are worked out once and the normals computed again. No
  GLTFLoader either: it would add to the bundle, and a file of our own is
  simpler to read.
- **Heavier than Anny goes.** Anny's heaviest is only about BMI 23. The
  weight slider runs 0–100, with Anny's heaviest at 50. Past it, Anny's
  own weight change carries on in a straight line (its "extrapolate"), and
  fat is added to the belly, waist, hips, thighs, arms and neck from its
  local targets. The top is about BMI 36. Further than that, the belly
  gets lumpy.
- **The joints stay the poser's.** The pose format, the joints' limits,
  the IK and the presets are as they were. Each joint turns Anny bones
  (`DRIVES`): the waist, chest and neck share their turn across several
  vertebrae, so the back curves. Anny's bones are lined up with the world
  at rest, so a joint's angles mean what they did, and each bone's skin
  inverse is just a move back from its joint. The body's proportions are
  close to the first figure's: its hips are 98.6 cm up rather than 99, and
  its joints are within a few cm. The seiza, kneeling-up and hug presets
  were retuned for its legs and chest.
- **Older poses' ropes moved, not migrated in the database.** A pose
  without `shape` is from the first figure. It opens on the in-between
  body, each rope point moved by how far its joint moved, so it sits where
  it was (`readPose`). It's saved with a shape the next time.
- **Changing the shape keeps the lowest joint where it was**, so feet stay
  on the floor standing, knees kneeling, and a body lying down stays down.
  Joint centres, not the skin, so a much smaller body's knees can sink a
  centimetre or two.
- **Tapping the body** picks the part whose bones move that spot most.
  The selected part is shown by coloring its vertices.

## Poser: shoulders, bends, limits and contact (October 2026)

**Status:** built (2026-10-29)

- **Measurements taken out** of the Body shape fold, by choice: the
  sliders stay. (`figure-body.js` still has `measurements`, tested.)
- **The skin is bound in Anny's own pose** (arms out about 45°), not baked
  arms down. Baking it arms down squashed the armpit before anything
  moved, so raising an arm tore it. The joints are still measured from
  arms down: each bone's skin inverse is its turn from Anny's pose to arms
  down after a move back from its bound joint (`TURNS`, `BIND_HEADS`).
- **Shoulders**: a raise is shared with the collarbone (12%) and shoulder
  blade (8%), so the shoulder rises with the arm. The upper arm's and
  thigh's twist is spread over their two bones. Swing and twist come from
  the joint's own angles (twist is turned last), as splitting a turn
  after the fact is unsteady with the arm straight up.
- **Four bones per vertex** (all three.js takes): a dropped bone's pull
  goes to its nearest kept relative in the skeleton, not shared out over
  all four, which made the shoulder sag (up to 22% of its pull dropped).
- **Dual-quaternion skinning** (`pose-skinning.js`), in a shader patch
  and on the CPU for taps: a tight bend keeps its volume and rounds off,
  where three.js's linear blend folded elbows and knees to a point. The
  usual cost is a slight bulge at a bend, which suits a body. Corrective
  shapes sculpted in Blender would be the next step if it isn't enough.
- **Limits that depend on several movements** (`joint-limits.js`): a
  shoulder twists ±90° low and about ±55° straight up; an arm swings back
  70° hanging, 40° once out to the side; a leg goes out 90° forward but
  45° behind; a leg crosses the other only once forward. Base twists
  tightened: hips ±45°, waist and chest ±35° each. Enforced on the server
  too, not just the poser (the user asked for the stricter way). The
  server imports the page's file itself rather than a copy kept in step,
  so they can't differ. Older poses and presets are brought within the
  limits as they're read, on opening (`readPose`) and on import
  (`jointsInReach`), so nothing already saved is refused. One saved and
  never opened again keeps its old angles in the database.
- **Contact** (`pose-contact.js`): the body as capsules fitted to the skin
  at every corner of the sliders (`pack_body.py`; each torso segment
  three side by side, as a torso is wider than deep). Only what a move
  makes worse counts, so a pose that starts touching (hands at the
  thighs, a box tie) is left as it is.
  - *First built as a stop* (a slider or drag halted where a limb
    touched). Dropped: a slider snapping back, with nothing to say what it
    hit, looked broken.
  - *As built:* moves go anywhere, through the body too. While one is
    made, the parts it pushes into each other are red. Let go (a slider,
    a typed value, ▲▼, or a limb dragged), it's settled as one change:
    another limb moves aside (its shoulder and elbow, or hip and knee, up
    to 30°), or the head tilts away (up to 20°), each as little as it can;
    a limb pushed into the trunk comes back out to the nearest clear spot
    from where it was let go. The trunk never moves aside: bending it
    would carry both arms, the head and their ropes. A move into the trunk
    comes back first, so nothing else moves for a clash that clears
    anyway; what's still clashing after all that is taken back the way it
    came until it's clear. Presets, the body's sliders and the rope solver
    aren't settled.
  - Known limits: capsules, not the skin, so a centimetre or so either
    way; a limb moved aside can carry its ropes off where they were put.

## Poser: allowing collisions, a flexible body, the nav's poser (October 2026)

**Status:** built (2026-10-31)

- **"Allow collisions"**, a checkbox bottom right of the view, ticked by
  default and kept while the page is open (not saved with the pose or
  the account). Ticked, nothing is settled and the limits that depend on
  several movements (`joint-limits.js`) are off (`setReachRules` in
  `figure-rig.js`); each movement's own range still holds. Clashes show
  orange only while a move is made, as the red did.
- **Unticking with clashes left** asks Fix them now or Leave them.
  What counts as a clash left: anything pushed in further than the
  contact accepted (`contactAccepted`): what the pose opened with,
  lowered as parts are pulled apart, reset by a preset, a part's Reset or
  a new body shape. Fix brings every joint within reach and moves each
  limb in a clash out of it (`fixClashes`), as one change. Leave changes
  nothing; a limb moved again is settled against the accepted contact,
  so it comes out then.
- **The server no longer checks the limits that depend on several
  movements**, only each movement's own range, so a pose made with
  collisions allowed saves. This reverses "Enforced on the server too"
  in "Poser: shoulders, bends, limits and contact" above (the user chose
  it). `readPose` and import (`jointsInRange`, was `jointsInReach`) bring
  joints within ranges only.
- **The ranges widened** about a fifth to a third for a flexible person;
  elbows and knees go 10° past straight. The reach rules loosened to
  match (a shoulder twists ±110° low, an arm swings back 90°, a leg goes
  out 120° forward and 60° behind; hip and knee twists 80° together).
- **The poser in the nav**, after Education: a button (it opens a dialog
  over the view, as + does), disabled while locked. Cancel is Close;
  Download still works. (At first it had nothing to save to, so Add to
  visuals and Save pose were greyed out: now they ask where, see "Poser:
  "Add pose to…", from the nav's poser" below.)

## Poser: the account's default body (October 2026)

**Status:** built (2026-10-30)

- "Save as default", on the Body shape fold's heading row (beside the
  fold, not in its summary, so it shows folded and doesn't toggle it),
  saves the body shown as `users.default_shape` (migration 0028), an
  account setting like light/dark mode, so it's the same on every device.
  New poses start in it, feet on the floor. Saved poses keep their own.
  Kept on the device instead was offered and not chosen.
- It's in the export's settings; an import takes it only into an account
  that hasn't saved one, as role names are taken.

## Poser: pickers, twists and the whole body's sliders (October 2026)

**Status:** built (2026-10-30)

- **Forearm and lower-leg twist**: the elbow and knee have a Twist out
  slider (the forearm −80 to 90, turning the hand palm up or down; the
  shin ±35), shared along the forearm's and shin's two bones so the skin
  twists rather than pinching. A straight knee hardly twists (up to 35°
  only at 90° of bend), and the hip's and knee's twists together stay
  within ±60°. Older poses' one-number elbows and knees read as untwisted.
- **No hips to tap**: the whole body's sliders (Tip body, Turn body, Roll
  body, its height and moving it) are under the head's, with a Reset of
  their own. The waist's area is its own and the hips' together, which
  makes it easy to tap; the chest keeps all of its own (taking the lower
  chest too was tried, and left the chest only around the neck). Ropes put
  on the hips are still on the hips (`POSED_AS` beside `TAPPED_AS`).
- **Body shape's row**: "Save as my default" in its middle, and Reset at
  its end, back to the app's own body without touching my saved default.
- **A new hashira goes 3 cm behind the body**, square to its back,
  wherever it stands and whichever way it faces, behind the arms too (a
  box tie's hands). A body lying face up or down has no "behind" on the
  floor, so it goes where it always did.
- **The screen stays on** while the poser is open (a screen wake lock,
  asked for again on coming back to the page); where it's not offered or
  refused, the screen sleeps as usual.
- **Pickers of our own** in place of the `<select>` menus for Body…,
  Arms… and Turn body…: a dialog with its title, Save as preset and ✕;
  a search box, not focused when it opens so no keyboard; the built-in
  presets in their order, a line labelled "My presets", then mine
  alphabetically, each with save over (floppy), rename (pencil) and delete
  (red) icons, save over and delete asking first. Tapping a row anywhere
  chooses it and closes the picker. The one the figure's in is tinted, not
  moved to the top (first with a ✓ was offered and changed); Save as preset
  is greyed out while the figure's in any of them. "Manage my presets" is
  gone: its renaming and deleting are on the rows. Saving over is `PUT`
  with `{ data }`, checked as the preset's own kind.
- **The Body and Arms pickers keep one height at the top of the screen**,
  only their list scrolling, so searching doesn't shrink the window
  downwards, and the rows stay above a phone's keyboard. Turn body, with
  no search, keeps its own height.
- **Saving a preset can save the other half too**: an unticked "Save arms
  as a preset too?" (or body) under the name saves both with the same
  name; with room for only one more, neither is saved, and it says so.
- **Arms against the trunk are forgiven more**: 3 cm of overlap before it
  counts (other pairs 1.5 cm), 5 cm against the back (which side, from the
  trunk's facing at the nearest point), where a box tie's forearms lie.
- Considered and left for now: settling a clash by going back along the
  move to the furthest clear spot (exactly as far as it could go), in place
  of stepping the moved joint back in 6°, 3°, 1° steps (which can stop a
  few degrees short of the limit, or past where the move started).
- **Body presets on any body's height**: a body preset's height (built-in
  or saved) is for the default body. Choosing one puts the body in it on
  the default body, then gives it its own shape, keeping its lowest point
  where it was (`withBodyPresetOn`), so Standing stands on the floor and
  Kneeling kneels on it on a 150 or 200 cm body alike. Saving one, and
  checking whether the figure's in one, turn the body into the default
  first (`onDefaultBody`), the heights matching within a centimetre.
  Scaling each preset's height by the body's standing height was offered;
  keeping the lowest point is exact for kneeling and lying too. Presets
  saved before this kept the height of the body they were saved on.

## Poser: toes, a flexible back, the pelvis, and the trunk following a drag (October 2026)

**Status:** built (2026-10-31)

- **Toes**: each foot has a Toes joint (Up, −30 curled to 80 up), bending
  the first bone of all five toes at the ball of the foot (Anny's own toe
  bones), for a "Barbie foot" with the ankle pointed, which now goes to
  65° (a dancer's), from 50°. Tapping the toes selects them; dragging them
  moves the leg as the foot does.
- **A flexible back**: the waist bends back 50° (from 30°) over the lower
  back's three vertebrae (the lowest, spine05, unused before, now shares
  it), and the chest 40° (from 25°), so a deep backbend curves.
- **The pelvis (Hips)**: Tilt (±30), Hike (±20) and Turn (±30) turn the
  pelvis and all on it about the point between the hip joints, stored as
  the `hips` joint; the hips' angles stay the pelvis's to the thigh, so
  their limits stay a real hip's. Its sliders keep both legs pointing
  where they were (the hips' angles making up for it, `withHips`) and the
  body's lowest point where it was: tilting keeps both feet exactly,
  hiking lifts the other leg, turning slides the feet a few centimetres.
  The hips are their own tap area again, the top 30% of it (by height)
  the waist's, so the waist isn't small (`WAIST_SHARE_OF_HIPS`).
- **The trunk following a drag**: once a dragged limb alone can't reach,
  a leg tilts, turns and hikes the pelvis (the other leg kept, the body
  kept on the floor), an arm bends, leans and turns the chest. The trunk's
  angles are weighted to move less, a hike least (it lifts the other
  foot). The waist was planned for legs too, but it bends the trunk above
  the pelvis, which the legs hang from, so it can't move a leg; leaning the
  whole body back over a planted foot was left for later.
  The other arm turns with the chest (not kept, as the other leg is).

## Poser: more cinches, added ropes, slack (October 2026)

**Status:** built (2026-10-31)

- **Cinches**: any number on a rope, on the same upline twice, and
  through more than two points: after Add cinch, each tap on a rope or the
  body adds a point (a bridge back and forth between uplines), and Finish
  rope ties it, taut, to be shortened. Only a hardpoint (tied to directly)
  and another cinch are refused, and it needs one point on a hanging
  stretch. Shortened, each point on a hanging stretch moves toward those
  beside it on the cinch, all the same share of the way, until the line
  is the cinch's length (with two moving ends, they meet halfway at most);
  the uplines bend at each point, in order along them. An approximation:
  each cinch is worked out as if the others weren't pulling the same
  uplines. Checking when a cinch on the same upline makes sense was offered
  and not wanted: it's allowed.
- **Add rope**: a new rope starting at the dot on any rope (not a cinch),
  laid as any rope, its first point `["rope", …]` on a rope before it. It
  follows that spot as drawn (through bends and sag), doesn't pull it, and
  goes when that rope goes or its points change (as cinches do). Not a
  see-saw.
- **Slack** (0–100 cm, `k`): an upline's hanging stretches sag in a
  parabola (down, as far as the run is across; one hanging straight down
  bows forward), the slack shared by length. Drawn only: nothing moves,
  and a cinch still pulls as if taut ("Move the body" ignores it).
- **The rope panel**: the see-saw box above the help, messages about the
  ropes under it (not under the buttons), Add cinch left, Move on bamboo
  in the middle (when tied on the bamboo), Add rope right, fixed in place,
  Move on bamboo's slider under them (the hardpoint's stay put), a black
  dot where the rope was tapped (and where a cinch or added rope starts,
  until it's finished), Cancel rope beside Finish rope (the two kept
  together, on the next row if there isn't room), the hardpoint's sliders
  folded under Hardpoint Settings. Body shape's buttons are as tall as its
  heading.

## Poser: flexibility turned down, and drags that move the body less (November 2026)

**Status:** built (2026-11-01)

Tried in the app, "a flexible body" and "the trunk following a drag" went
too far: horrific poses, and a leg pulled the whole body round.

- **"Allow collisions" only lets body parts overlap.** Ticking it used to
  turn off the limits that depend on several movements too
  (`joint-limits.js`: a raised arm twisting less, a leg out less behind
  the body), so with it ticked by default the joints stacked up into
  poses no body makes. They're always kept now; the toggle
  (`setReachRules`) is gone. "Fix them now" still fixes both.
- **Ranges about halfway back** between the typical body's and the very
  flexible one's (e.g. the waist back 55° and forward 70°, a hip forward
  150° and out 100°, a shoulder's twist ±95°, the pelvis ±35°), keeping a
  75° pointed foot and elbows and knees 5° past straight; the limits that
  depend on several movements likewise (a foot turning 70° all told, a
  leg out 100° in front and 50° behind). The server's ranges match.
  Poses saved with the wider ranges open within the new ones, and
  Duplicate and Copy to… bring them within before sending (`savePose`),
  as the server would refuse them.
- **A drag moves the trunk only as a last resort, and only a little.** It
  joins in once the limb is 8 cm short (it was 1 cm), a drag takes the
  pelvis at most 15° tilt and 10° turn from where it was when the drag
  began (and the chest 15° bend, 10° lean and turn), never hikes the
  pelvis (which lifted the other foot), and the other leg's hip stays
  within its own limits: if keeping that leg would take more, the pelvis
  stops. The Hips and Chest sliders keep their full ranges.
- **Considered, not now**: a "Flexible body" checkbox to turn the wider
  ranges back on.

## Poser: "Add pose to…", from the nav's poser (October 2026)

**Status:** built (2026-10-31)

- **Opened from the nav**, Save pose and Add to visuals ask where the pose
  (or a picture of it, as a photo) goes: one sheet, "Add pose to…"
  (`add-to-picker.js`), with the poser's icon by the heading. Opened from
  a tie, plan or workshop's "Add a visual from…", nothing changes: it
  adds to that one.
- **One search over ties, plans and workshops**, rather than choosing
  the kind first: people remember a name more than which list it's in.
  Chips (All, Ties, Plans, Workshops) narrow it, All to start; the chip
  chosen is kept until the journal locks. Each row has its tab's icon and
  its kind. Without a search, Recent: the most recently changed first
  (ties' search now returns `updated_at` for this), and the one added to
  last always at the top, so adding several poses to the same one is a
  tap each. Kept in memory only, forgotten on lock (`add-to-choices.js`
  is the pure part).
- **Making a new one** is at the bottom: + Tie, + Plan, + Workshop, each
  with its icon. When what's typed matches no title exactly, it reads
  "Create "…" as a new…" and the new one is called that.
- **On one already there**, the pose or picture is saved at once and the
  poser stays open, saying where it went; Close only asks if the pose has
  changed since it was last saved or added.
- **A new one opens its own form** (`new-entry-start.js`), the name
  filled in and the pose waiting in its Visuals like any visual added to a
  new item, with "Not saved yet. Save this … to keep the pose." at the top,
  and closing it asks "Discard this new …?" even with nothing else changed
  (`unsaved` in `form-changes.js`). It opens over the poser, which is
  still there after. (At first a new plan went to the Plans view, where
  its form lived, closing the poser; see "The plan form, a dialog of its
  own" below.)
- **Drafts saved in the database were weighed and not built**: a tie needs
  a type and a workshop a start date (the API, and for ties triggers,
  refuse one without), so a draft would mean loosening those, then
  keeping drafts out of the lists, Calendar, Analytics, search, export,
  import and shares. The form holding the pose until it's saved, and
  asking before it's closed, covers the same worry, except the app being
  closed part-way.
- **Considered**: three new-item forms inside the sheet (three forms to
  keep in step with the real ones), and choosing the kind first (an extra
  step, and the wrong list when you're not sure).

## The plan form, a dialog of its own (October 2026)

**Status:** built (2026-10-31)

- **Why**: the plan form's markup was in the Plans view's template, wired
  to the list by `resource-page.js`, so it only existed on that view, and
  opening it from the poser meant going to Plans, which closes every
  dialog, the poser too. The tie and workshop forms were already dialogs
  built in code, opened from anywhere.
- **`plan-form.js`**, like `tie-form.js`: `openPlanForm(plan, { start })`
  builds the whole dialog (ids still `plan-…`, the form `#plan-form`
  rather than `#form`, so it can't clash with People's or Locations'
  form when it opens over them), with Delete (asking about linked ties),
  Archive or Restore, Share and ✕ on its heading's row; Variation of
  loads the active plans itself; a linked tie opens in the tie form over
  it, and the linked ties are loaded again after. It resolves true when
  something a list of plans shows changed (saved, archived, restored,
  deleted, or a linked tie edited), so the Plans view reloads.
- **The Plans view** keeps the Add a Plan card, the search and the list,
  now its own (loading, Show archived, cards that open when tapped)
  rather than `resource-page.js`'s, which serves People and Locations
  only, unchanged for them. Nothing looks different on the page.
- **Not done (yet)**: a tie's linked plan opening in the plan form, as a
  plan's linked ties open in the tie form. Easy now, left out to keep the
  change to the refactor.

## Sharing between accounts (October 2026)

**Status:** planned (2026-10-24). Phases 1 to 6 built 2026-10-24 to
2026-10-27 and released in 2026.10.28.001: phase 1 (two notes fields on
people, migration 0021, deployed 2026-10-24), phase 2 (shares on the
server, migration 0022), phase 3 (profile invites, migrations 0023 and
0024), phase 4 (connecting accounts, migration 0026), phase 5 (sharing
ties, plans and workshops, no migration) and phase 6 (photos and videos
in shares, migration 0027). Phase 7 (passphrase and verification code)
planned in detail 2026-10-27 and put on hold (see the build plan); phase
8 (view-only) isn't built.
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
   Migration 0023 (became 0026): `connections`,
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
   *Planned in detail 2026-10-27, then put on hold; not built.* Both change
   only creating and opening a share: the passphrase proof and key, claims
   and codes, the sender's waiting screen, wrong-try limits. Tests: unit
   for deriving the keys and proof; API for wrong tries, cancelling, a
   claim used twice; the walkthrough with two accounts and a code.

   **It needs a migration after all** (0029 or whatever's next): phase 2
   left `share_claims` out. Only additions: `shares.pass_hash` (SHA-256 of
   the passphrase proof; NULL for none), `needs_code`, `pass_tries` and
   `code_tries` (wrong ones so far), and `share_claims` (a server-made
   `id` the sender's screen refers to, `share_id` cascading from
   `shares`, `secret_hash` of the recipient's random claim secret,
   `code_hash` once the sender's screen asks for one, `created_at`).

   The plan as it stood:
   - **Passphrase keys** (`crypto/share.js`, pure). Normalized first
     (NFKC, trimmed, spaces collapsed, lowercase: it's said out loud),
     at least 8 characters. `P = PBKDF2-SHA256(passphrase, "notonawa share
     pass|<id>", 600,000 rounds)`, as the recovery email. The sealing key
     is `HKDF(linkKey, salt P, "notonawa share v1 passphrase")`, and the
     snapshot and file keys come from it as they come from the link key
     now, so a share without a passphrase is sealed exactly as before.
     The proof is `HKDF(linkKey, salt P, "notonawa share v1 proof")`: with
     the link's key in it, the stored hash can't be used to guess
     passphrases offline. The page keeps the sealing key where it keeps
     the link's key now (`OpenedShare.key`), so the file operations don't
     change. Worker: `sealShare` takes the passphrase and also returns the
     sealing key and proof; a new `sharePass` for opening.
   - **Opening with a passphrase**: `POST /api/shares/open` without the
     right proof answers `{ locked: "passphrase" }` and counts no use; a
     wrong one counts a `pass_tries`, and the limit cancels the share
     (deleted with its files, as revoking). The owner needs it too, but
     their wrong tries don't count.
   - **Verification code**: the recipient's page sends a random claim
     secret (kept in memory only, forgotten on lock) with the open; the
     server keeps the claim and answers `{ locked: "code" }`, no use
     counted; at most 5 waiting a share, each lasting 10 minutes. The
     sender's code dialog (and Show code) polls `GET
     /api/shares/:id/claims` every few seconds while open, and for each new
     claim calls `POST /api/shares/:id/claims/:claimId/code`: the server
     makes a 6-digit code, keeps its hash and returns it once (asking
     again replaces it). The dialog lists each with its time, and says to
     revoke if there are more than people it's for. Right code: the claim
     is deleted, a use counted, the snapshot sent; wrong: `code_tries`,
     and 5 cancel the share; a claim used twice gets the same "ended". The
     owner skips the code. The daily clean-up deletes expired claims.
   - **Pages**: a shared Locks fieldset for both Share dialogs
     (`share-locks.js`), the passphrase and code forms on `/open`
     (`open-locks.js`), "Passphrase" and "Code" in Shared by me, both
     flags (never the hash) in the export, and a sentence in PRIVACY.md
     (a new version, not one to agree to again).
   - **Still to decide**: the wrong-try limits (5 codes as above; 10
     passphrases suggested, as a class shares one count), whether the
     passphrase ignores capitals, and whether Show code can show it again
     (suggested: not kept, so the sender revokes and makes a new one if
     forgotten; or sealed with the data key, as `link_key` is).
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


## Views slow to open the first time, and the menu's logo (October 2026)

After the sharing work and the new logos, each view was slow to open the
first time after a page load (and Unlock reloads the page after every
deploy), and the menu's logo appeared only after the menu had slid in.

- **Why views were slow:** every static file was `no-store`, so each page
  load fetched the app's code afresh, and with no build step a view's code
  is a chain of small modules (2 to 4 deep past what's already loaded),
  each waiting on the one that imports it. A view opened again was quick:
  its modules stay loaded while the page is open.
- **Code and styles are now `no-cache`, images `max-age` a week**
  (`public/_headers`, each block taking off the `/*` block's `no-store`
  first, as two values would be joined with a comma). They hold none of
  the journal. `no-cache` still asks the server each time, but an unchanged
  file is a 304 with no body, and a deploy is never missed. Images are
  kept without asking, so a changed image needs a new file name. The page
  itself, `privacy.html`, the manifest and the API stay `no-store` (the
  page out of the back/forward cache, as before). PRIVACY.md says so.
- **The journal views' code loads ahead** (`warmUp` in `app.js`), once the
  first journal view is drawn and the browser is idle, without showing
  them. Not `/open`, which only a link opens. If one fails to load (a
  dropped connection), opening that view tries again; some browsers may
  keep the failure until the page reloads, which Unlock does often enough.
- **Not adopted: a build step bundling each view into one file.** It would
  remove the chain of requests altogether, but the app has none by choice;
  loading ahead and caching got most of the way there.
- **The logos were large and both versions downloaded.** A hidden `<img>`
  is still fetched, so Unlock fetched the light and the dark logo (164 KB
  each, shown at 220px) every time, alongside the first view's requests.
  The menu's banner was a file nothing else used, fetched only when the
  menu opened. Now each logo is one element whose background is the
  mode's version (`.logo` in `app.css`; only a matching background is
  fetched), AVIF at twice the shown size (30 KB, and 14 KB for the menu's),
  and the menu's is fetched ahead once unlocked (`preloadMenuLogo` in
  `nav.js`). `forced-color-adjust: none` keeps it in high-contrast modes,
  which drop backgrounds. AVIF, as macOS's `sips` writes it and every
  current browser shows it (WebP it can't write); there's no fallback for
  browsers older than about 2023.

## Edit dialogs: heading icons and unsaved changes (October 2026)

**Status:** built (released 2026.10.28.001)

- **The actions are icons on the heading's row** (`dialog-icons.js`):
  delete (in the danger color), archive or restore, share and ✕, in that
  order from the left, on ties, plans, people, locations and workshops.
  This replaced the buttons under Save. Each icon is named for screen
  readers and the tooltip. Ties and workshops have no archive, and people
  show Share only on "Me", which can't be archived or deleted.
- **A saved item's dialog opens focused on its heading**, not on a text
  box, so a phone doesn't open its keyboard over the form. A new item
  still opens on its first field.
- **Save changes is muted until something has changed** (`form-changes.js`),
  when editing a saved item; a new item's Save stays on. It's muted with
  `aria-disabled`, not disabled, so the form's submit still runs and checks
  for itself: a tap straight after typing can't beat the update.
- **Closing with changes asks first**: ✕ and Esc ask "Discard your
  changes?" (Discard changes / Keep editing; `guardClose`). A tap outside
  still doesn't close a form.
- **Changes are the form as a whole, compared with how it opened**, not
  each edit tracked, so typing a word and deleting it, or adding a row and
  removing it, counts as no change. The Visuals section is left out: on a
  saved item, a visual is saved as soon as it's added. A new item from the
  nav's poser counts as changed until it's saved (`unsaved`) and asks its
  own question ("Discard this new …?").

## The searches' "More options" (October 2026)

**Status:** built (released 2026.10.28.001)

- **The Ties, Plans and Education searches show only the keyword box**,
  with the other filters folded under "More options" (a `details.fold`,
  as a plan's Linked ties is).
- **Ties opens the fold when the address brings a filter** (Back, or a
  link from elsewhere), so a filter that's on is never hidden. Plans and
  Education keep their searches in memory only, so they start empty and
  folded.

## A version for every deploy (October 2026)

A deploy without a new RELEASES.md heading kept the old version, so pages
left open over it, installed apps above all (phones resume them rather
than reloading), never reloaded: the update check only reloads into a
newer version. That deploy also removed the PNG logos the old page's
Unlock asked for, so installed apps showed broken images until closed.

- **Every deploy gets a version: its UTC date and time to the minute**
  (`2026.10.28.2104`), from `npm run deploy:prod` (`scripts/deploy.mjs`), with
  or without release notes. It's written to `VERSION` and built into both
  files that hold `APP_VERSION`, so the menu shows it and `/api/version`
  serves it, and the Worker is deployed with `--tag` so Cloudflare's list
  of deployments shows it too. Notes are written under `## Next` and
  given the version by the deploy; What's new only lists releases with
  notes. UTC because it only ever goes up (a local clock goes back an
  hour in the autumn); an evening deploy in California is dated the next
  day.
- **Twice in one minute is refused**, not given a suffix: the second
  would have the same version, and open pages wouldn't reload into it.
  The script asks the server it's deploying to for its version first.
- **No default target: `deploy:prod` or `deploy:dev`.** At first plain
  `npm run deploy` was production and `-- --dev` dev, and `npm run deploy
  --dev` (no `--`) deployed to production: npm takes the flag itself and
  drops it without a trace, so the script can't tell. Now plain `npm run
  deploy` refuses.
- **Dev deploys stamp the files for the deploy and put them back**, so
  only production's versions are committed; dev's are just as new, from
  the same clock.
- **The older versions end in a release's number that day** (`.001`),
  three digits to the times' four. They compare as text with the times,
  except a time before 00:10 on Oct 28 2026, the one day with both, which
  had passed.
- **Not adopted: Cloudflare's version metadata.** The Worker can read
  each upload's id (a random UUID), a tag and a timestamp, but the page,
  a static file, can't, and a random id doesn't say which is newer.
- **Not adopted: counting deploys** (`.001`, `.002` asking production for
  the last one). The time needs nothing remembered or asked, and says
  when a build went out, which helps matching a bug report to a deploy.
- **Not adopted (for now): keeping removed files for a release.** Old
  pages reload at their next lock, so a missing file only shows until
  then.

## Poser: feet under gravity (November 2026)

**Status:** built (2026-11-01, released 2026.11.01.2141)

- **A foot a change moves follows the floor** (`grounded` in
  `pose-gravity.js`): when the body is lifted, a leg bent, or the hips or
  whole body turned, a foot whose shin points down lands flat, rises onto
  its ball as the heel leaves the floor (the ankle pointing, the toes bent
  up to stay down: the "Barbie foot"), and goes en pointe, as far as it
  points with the toes in line, once the change takes it out of reach.
- **Only feet the change moved**: a foot it didn't move is left as set, so
  its ankle and toes sliders are mine. So is one already in the air before
  the change, until it comes back down.
- **Only when the shin points down**: a body lying, kneeling or upside
  down has no foot standing on the floor, so it's left alone.
- **Not physics**: like the rope solver, it finds angles that fit
  (searching each one by halving) and weighs nothing.

## Poser: tabs, the view's own tools, a panel for the chosen rope (November 2026)

**Status:** built (2026-11-04, released 2026.11.05.0231)

The poser had grown a crowded top row (Pose, Rope, pencil, undo, redo,
download and Add to visuals), the Rope mode was easy to miss, and the
body's shape sat folded in the Pose panel among the sliders used all the
time. Mocked up first, then built (`pose-editor.js`, with
`pose-scene-panel.js`, `pose-rope-panel.js` and `pose-hints.js`).

- **Three tabs: Pose, Rope and Scene**, filling the top row as one
  switch, so Rope reads as a mode. Scene holds what's set once before
  posing: the hardpoint and the body's shape, swapped with a smaller
  switch of their own (Hardpoint | Body shape). "Scene" over Setup,
  Space, Model or Rig: it covers both the rig and the figure in it, and
  "model" is a role's old name.
- **Undo, redo and the pencil float on the view's top left; a cube on its
  top right** opens the quick views, in place of a select (a select can't
  show an icon). They act on the view, so they sit on it.
- **The pencil is a switch over any tab**, not a mode: drawing is the
  same whichever tab is showing, and its colors, widths, eraser and Done
  go in a bar over the view's foot, leaving the panel where it was.
- **Download and Add to visuals moved to the foot** beside Save pose, as
  icons (an arrow into a tray, a picture with a plus): all three get the
  pose out. The foot's left button is always Close.
- **Positions and Facing.** Body and Arms (presets) sit together under
  "Positions" with figure icons (a futomomo, bunny ears) drawn like the
  poser's high-kicking icon; Turn stands apart under "Facing", as it sets
  which way the body faces rather than applying a stored position.
  "Positions" over Presets: the word riggers use.
- **Body shape: Save as my model, Load default, Reset.** Reset goes back
  to my saved model (the app's body when there's none); Load default puts
  the app's own body on. Before, the one Reset went to the app's body.
- **Taking a hardpoint away, or swapping it, asks nothing**: the rope
  points that can't move go with it, a line says how many, and Undo
  brings them back. Tapping the one there takes it away; tapping it again
  puts it back where a new one starts. Swapping a ring and a bamboo moves
  uplines across, so it rarely loses any.
- **The chosen rope has its own panel** in place of the thickness and
  color tools: its color, "Rope selected" and ✕; Cinch, Slide (when it's
  tied to the bamboo) and Add rope side by side as icons over names; and
  one box for the setting in play: slack, its position along the bamboo
  while sliding, or a cinch's length. The action in use is pressed and
  tapping it again ends it, so Slide's Done went. A cinch shows Cinch
  pressed, the other two dimmed, and Move the body in its heading.
  Before, Add cinch, Move on bamboo and Add rope were spread across a row
  and the sliders came and went in different places.
- **Cancel and Finish show only while a rope is laid**, in a bar over the
  view with its count, instead of sitting disabled most of the time.
- **Jute, a ninth color, in grey's place.** `COLORS` (the page's
  `drawing-format.js` and the server's `src/drawings/parse.js`) gained
  "jute" at the end, so every older line and rope keeps its color. What
  can be chosen is `PICK_COLORS`, one list for the drawing pad, ropes and
  the pencil: jute in grey's spot. Grey stays saveable, so saved grey
  lines and ropes still show grey. First tried: the poser drawing "grey"
  as jute, stored as grey, but then one color had two names depending on
  where it was looked at; then separate lists for the pad and the poser,
  which there was no need for.
- **The pencil reuses the Rope tab's rows.** At first its colors and
  widths were a bar over the view, the same as Rope's below it; now,
  while it's on, a Pencil panel takes the tab's place with those same
  rows (one builder), under a heading with Done, outlined in the accent.
  Tapping a tab puts it away too.
- **The hardpoint as a chip on the thickness row**, in place of a
  "Hardpoint: none · Change in Scene" row of its own: its icon (a ring on
  a line, a bamboo with nodes, a hashira post, the same on Scene's
  buttons), its name and ›, or a dashed "+ Hardpoint" when there's none,
  which lets the help drop to one line. The pencil's Done takes the
  chip's place, and both helps keep two lines' room, so turning the
  pencil on moves nothing. Ropes and the pencil each keep their own color
  (ropes start jute, the pencil red, so marks stand out).
- **See-saw is "Runs free"**, in the chosen rope's heading (where a cinch
  has Move the body): it says what happens, the rope running over the
  ring or bamboo so pulling one end moves the other. "Pulley" was clear
  but mechanical; "Through the ring" didn't fit the bamboo.
- **The heading takes focus when the poser opens**, as other dialogs'
  do: before, the browser gave it to the Pose tab, which showed a ring.

## Audit on workshops, and roles kept on pick (November 2026)

**Status:** built (2026-11-07)

- **Audit is a workshop role only** (`WORKSHOP_ROLES` in
  `src/ties/parse.js` and `public/js/ties-view.js`; migration 0029
  rebuilds `workshop_people` for its CHECK). It's offered for educators and
  participants alike. Ties and a person's default role keep the five tie
  roles: auditing is sitting in on a class, not a side of a tie. Top and
  bottom can't be named "audit" either.
- **Picking a person keeps a chosen role** when they have no default
  (`roleAfterPick` in `roles.js`): before, picking anyone replaced the
  role with theirs, blank when they had none. Someone with a default role
  still sets it, as that's usually what's meant.


## Workshops: links, cost, more ratings; the visual viewer (November 2026)

**Status:** built (2026-11-08)

- **Education is the third tab**, between Plans and People: workshops sit
  with the ties and plans they now link to.
- **A tie or plan has one workshop** (`workshop_id` on each, migration
  0030), not a link table: a tie happens at one workshop, and a plan is
  learned at one. Deleting the workshop unlinks them (`ON DELETE SET
  NULL`) rather than asking, as nothing is lost but the link. The link is
  set from either side: the workshop's "Ties and plans" (the poser's
  "Add pose to…" sheet with `what: "link"`, narrowed to ties and plans,
  so picking or starting one works as it does there), or a tie's or
  plan's Workshop row. A new workshop links nothing until it's saved (it
  has no id yet); the form says so.
- **A new tie from a workshop** starts linked, at its location (not one
  since deleted), with its People but not its Educators (who teach), and
  dated today while the workshop's on, else its start date (for logging
  a weekend afterwards). Audit isn't a tie role, so someone auditing comes
  over without one, and their usual role fills in as picking them would.
- **The linked list is icon and title only**: its date and people would
  repeat the workshop's, and we tried ratings and difficulty there but
  dropped them; ties have no difficulty of their own (weighed: borrowing
  the linked plan's, or a new column), and none is needed now.
- **Cost is encrypted** (`workshops.cost`, the amount and currency sealed
  as one field, "USD 180.00"), like the notes: it's money spent. Totals
  are added up on the device, as Education and Analytics already open
  every workshop. **Spend or earnings isn't stored**: it's earnings on a
  workshop I teach (I'm one of its educators), as attended or taught is
  worked out. The form's label says Cost or Earned as the educators
  change. One amount is kept, so changing the educators moves it between
  the two totals.
- **Currencies are never converted**: each is added up on its own, the
  most used (on the most workshops; the larger total breaks a tie) shown
  as the number and the others in small type under it. Conversion would
  need rates from somewhere, and a rate on which day. Nine currencies, US
  dollars first; a new workshop starts on the one used last (worked out
  from the workshops, as the currency is sealed: nothing new is stored).
- **More ratings: content, teaching and value** under a fold, with
  difficulty beside the overall rating (as a plan's). Weighed and dropped:
  "space and vibe", and a workshop level field (listings often don't give
  one; difficulty says how hard it was, and a tag can hold the advertised
  level).
- **Size, not Attendees**, so it fits beside the dates as a tie's Mins
  does; its tooltip says "How many attended". **Location is open from the
  start** on workshops (most have one); ties keep theirs behind + to stay
  light.
- **Analytics: workshops follow the period only.** Its role and More
  filters are about ties, and the card says so. **A follow-up tie is one
  on a plan linked to a workshop**: what was learned, tied again. Ties
  linked straight to a workshop happened at it, so they don't count as
  its follow-ups, and Practised most ranks by follow-ups (of any date).
  Workshops on the map are teal diamonds, apart from the ties' pins by
  shape as well as color, and not grouped (there are few). The cards are
  hidden until there are workshops at all.
- **The visual viewer: a big caption box and one row of icons.** The
  caption grows as it's typed in (CSS `field-sizing`, and drags taller),
  up to 1,000 characters (was 200; the server's sealed limit rose to fit
  3-byte characters); its label moved into the placeholder, Save caption
  became a ✓ in its corner shown once it's changed, and Close a ✕ at the
  top as on other dialogs. Each action keeps its place in the row across
  kinds (a photo leaves Edit's and Duplicate's empty), so swiping between
  them doesn't move Copy to… or Delete. The icons narrow to fit a 320px
  phone rather than wrap.
- **Copy to… for photos and videos makes a new file**: each is sealed
  bound to its own id, so the crypto Worker opens it and seals it again
  for the new one (`copyMedia`), and the copy counts in the 1 GB. Weighed:
  pointing two items at one file, which would need shared files and
  reference counts when deleting.

## Workshop event links, card wording, Tutorial (November 2026)

**Status:** built (2026-11-08)

- **A workshop's event link is encrypted** (`workshops.event_url`,
  migration 0031), as its album link is: it can show what I went to.
  It's checked as an http or https link before sealing and again before
  "Open link" makes it clickable, before "Open album" on the card.
- **Paid, not Cost**: the field says what it is from my side (Earned on
  one I teach). The ratings moved after the description, so the facts
  (where, who, the link and the money) come first.
- **Card dates use the browser's own range format** (`formatRange`):
  "Nov 6 – 8, 2026", "Oct 30 – Nov 2, 2026", and across years two lines,
  as the card's corner is narrow. Other languages get their own order.
  The attendee count left the card (it's in the form and the Summary).
- **"Floor tie at …"**: "Floor at Studio" read oddly. The other types
  read fine as they are. **Plan cards** say "Hashira sequence" on their
  second line, so the corner no longer repeats the plan type.
- **Sharing a workshop offers its cost and event link**, both ticked to
  start, as everything else is (we weighed leaving the cost unticked, as
  it's money, but chose to match the rest). The recipient's copy reads as their Paid (unless they're one of
  its educators). Its new ratings aren't offered yet.
- **Tutorial in the menu reopens the welcome** until a click-through tour
  replaces it (roadmap.md).


## Card counts and lines, a pinned nav (November 2026)

**Status:** built (2026-11-08)

- **Cards count everything attached** at the bottom left: "4 visuals, 2
  plans, 6 ties", leaving out what's none, with Open album after it. A
  visual is any photo, video, drawing or pose (`visual_count` in each
  list's query, beside the older `photo_count`, kept for imports and
  tests). A tie counts its plans (not deleted ones), a plan its ties, a
  workshop both. A form that added or deleted a visual (or a workshop
  that linked or unlinked one) resolves true on closing, so the list
  redraws its counts; before, a photo added without saving left the count
  as it was.
- **Workshop cards** say who taught it where ("Alex & Lily at Studio"):
  the names without roles, joined with &, the clearest way to read two
  teachers. The location links to the event link, which saves a separate
  "Open link"; that stays at the bottom only with no location to link.
  The rating hanks left the card (they're in the form and the Summary).
  A taught one shows "Attendees: 12" at the bottom right: it's what a
  teacher wants to see, and an attendee's would just be a guess.
- **Workshop dates replace the earlier range format**: the days beside
  the title ("Nov 6–8", no spaces round the dash) and the year on the
  next line, beside the teachers, small and muted, so the title and the
  people have the room; across years, "Dec 30 2026–" and "Jan 2 2027".
  We weighed three options in a mock-up (one line, two lines, a smaller
  muted pair) and chose the last. Dates on every card drop their commas
  (`cardDate`); `dateRangeText`, used outside cards, keeps them.
- **A plan's card names its workshop** under its type, with the
  Education cap (`capMark`, shared with Analytics' marks).
- **Lists**: "My plans", with "Showing 3 of 5" as Ties and Education have
  (none of the three repeat the noun any more). Plans' Show archived is
  under More options, at the right of the Has Tags row, as it's a filter
  like the rest. The hints under the People and Educator(s) filters went:
  the boxes say enough.
- **The nav is pinned to the top** (`position: sticky`, on the page's
  background with a line under it), so the tabs are always in reach in
  long lists; `scroll-padding-top` keeps what's scrolled to below it.
- **Analytics' workshops come last**: the Workshops card (Spent heading
  the second column, above Earned; what it counts behind a ? in its
  corner), then Practiced most (US spelling, as elsewhere in the app). The
  tie count's cap sits under the month's or day's label on the axis,
  drawn in the chart, and the label's band under that bar is its button,
  listing that month's or day's workshops; over the bars it crowded the
  counts.
- **A workshop card's dates float as one block** in the top right,
  spanning the title's and the teachers' rows, rather than a line in
  each: a title wrapping to two lines pushed the year away from its days.

## Encrypt everything: the post-quantum library (November 2026)

The first step of the encrypt-everything migration (one sealed record per
item, item keys, a sealed cache on the device, contacts on post-quantum
identity keys). The plan, the brief and the architecture's decisions are
in Claude Docs; this file records each part as it's built.

- **hpke 1.1.8 and @panva/hpke-noble 1.1.8** (both MIT, by Filip Skokan),
  pinned dev dependencies vendored like three.js: `scripts/vendor.mjs`
  bundles only what `scripts/vendor/hpke-entry.mjs` names into
  `public/js/vendor/hpke.js`, typed by our own `scripts/vendor/hpke.d.ts`.
  They bring `@noble/hashes`, `@noble/ciphers`, `@noble/curves` (2.4.0) and
  `@noble/post-quantum` (0.7.1), all MIT, by Paul Miller. hpke follows
  draft-ietf-hpke-hpke-06 and draft-ietf-hpke-pq-05, has no dependencies
  of its own, and lets the KEM, KDF and AEAD be swapped one at a time.
- **The suite**: MLKEM768-X25519 (X-Wing, KEM id 0x647a) from
  @panva/hpke-noble, pure JavaScript, in every browser; HKDF-SHA256 and
  AES-256-GCM from hpke, on Web Crypto. Chrome 154+ has X-Wing natively
  (hpke has a Web Crypto version too), but one path everywhere is simpler
  to trust and test; we switch once every major browser ships it, behind
  one module, so no format changes. Not independently audited, and
  noble's code doesn't claim constant time: pending the security
  reviewer's sign-off (decapsulation only runs on the user's own device).
- **Size**: 61 KB minified, 22 KB gzipped, loaded only by what needs it
  (the crypto Worker, from the contacts work on).
- **Licences in the bundle**: hpke's and two of the @noble libraries'
  files carry no notice of their own, so `vendor.mjs` starts the bundle
  with one naming them all and their versions (noble-curves and
  noble-post-quantum keep their own too).
- **Tested** (`test/unit/hpke.test.js`): the pinned packages derive the
  published key pair and open the published message of draft-ietf-hpke-pq-05's
  X-Wing vector (`hpke-xwing-vector.js`; its only HKDF-SHA256 vector uses
  ChaCha20Poly1305, so it checks the KEM rather than our exact suite), and
  our suite, through the vendored bundle, round trips, rebuilds a key pair
  from its 32-byte seed, and refuses the wrong key, a changed ciphertext or
  either half of the encapsulated secret, and other additional data or info.
- **IndexedDB in the crypto Worker works everywhere** (a spike, not kept,
  Nov 13 on macOS: Safari 27.2, Chrome 157, Firefox 160). From a module
  Worker each opened IndexedDB, stored a non-extractable `CryptoKey` that
  still opened what it sealed after a reload, wrote 2,000 sealed records
  in one transaction (47–66 ms; all read back in 5–11 ms) and 25 MB of
  files as Blobs (19–29 ms) or ArrayBuffers (25–69 ms), all read back
  intact after a reload; `storage.estimate()` and `BroadcastChannel` work
  there, `persist()` is the page's only (granted on localhost by Firefox
  alone, so the cache must cope with being cleared). X-Wing from the
  vendored bundle: a key pair from its seed in 7–11 ms, sealing and
  opening 4 KB in 2–5 ms.
- **Never await anything but a transaction's own requests inside it.**
  The spike's first version hashed a file between puts: Safari and Firefox
  ended the transaction there (`TransactionInactiveError`), as the spec
  says; Chrome let it pass. The cache seals and hashes everything first,
  then opens the transaction and puts without awaiting.

## Encrypt everything: the store (November 2026)

Phase 1 of the migration: every read and write of journal data goes
through one facade, `public/js/store/index.js`, so the encrypted version
can be put underneath it without touching the pages. It changes nothing
anyone sees.

- **Plain text in, opened rows out.** The store seals before sending,
  opens what it returns, and searches a keyword on the device itself
  (`findTies({ q })`); pages no longer call `seal`, `sealOne` or `open`
  for journal rows. The encrypted version does all three differently
  (whole records from the cache), so this is the line it slots in behind.
- **One file per feature under `v1/`**, today's API calls moved as they
  were, each in its feature's area so `check:changed` runs only the
  chunks that matter; `index.js` is shared. Some functions take a kind
  where the routes do (`listItems("people", "all")`); drawings and poses
  share one set.
- **Export and import pass today's sealed shapes through** for now
  (`exportSealed`, `importTies` and so on): they mix sealed and plain data
  throughout `views/data.js`, `open-item.js` and `journal-fields.js`, and
  are rebuilt over the cache in phase 4 rather than reshaped twice.
- **Types**: rows are `any` as `api()` gave them; per-kind types come with
  the record schema (phase 2).
- **The guard is an ESLint rule**, not a unit test: lint catches it as
  the code is written, before any test runs. (A unit test could read the
  files through Vite's `import.meta.glob`, as `areas.test.js` does.) It refuses
  `api()` with a journal path, or `/api/` followed by a variable, outside
  `public/js/store/`. Left outside on purpose: sign-in, keys, the account
  (but its settings), consent, notices, feedback, shares, the version,
  and `seal-leftovers.js` (retired with the migration). The crypto
  Worker's own fetches (the search index, photos) are rewritten in phase 4.
- **Small changes on the way**: lists that came sealed to a few views
  (Analytics, the share dialogs, the workshop picker) now come opened; a
  delete choice is `{ delete: true }` rather than an empty URL fragment.

## Encrypt everything: the formats (November 2026)

Phase 2: the formats records, files and contacts use, and the crypto
Worker's operations on them. Built and tested, not used yet (the pages
reach them from phase 4); the Worker loads them, and the 61 KB HPKE
bundle with them, at unlock. Everything is AES-256-GCM with a random
12-byte IV unless it says otherwise, bound by its additional data.

- **Records** (`crypto/records.js`): a random 32-byte item key per record,
  sealed under the data key as `k2.<iv>.<ct>` (bound to
  `notonawa|itemkey|v2|<user>|<kind>|<id>`), opened straight into a
  non-extractable key. The body is `{ v: 2, … }` as JSON, padded with
  spaces to a multiple of 256 bytes (JSON ignores them, so nothing comes
  off; the reviewer may prefer ISO 7816-4, a one-line change), sealed as
  `e2.<iv>.<ct>` and bound to `notonawa|record|v2|<user>|<kind>|<id>|<version>`.
  The page gives the version being written (1 more than it read); the
  server only checks it. A body over 1 MiB padded is refused (`TooBig`):
  sealed and in base64url that's about 1.4 MB, under the server's cap.
- **Ids** (`records/ids.js`): conversion and "this is me" ids are
  HMAC-SHA256 under an id key, as version 8 UUIDs. The id key is HKDF-SHA256
  (salt 32 zero bytes, info `notonawa ids v1|<user>`) of the data key's
  bytes: the Worker unwraps the same wrap a second time as an HKDF key
  (`unwrapKeyMaterial`), since the data key itself never exists as bytes
  in JavaScript. Weighed: a separate random id key, sealed and stored, is
  cleaner (no key used both as AES and as HKDF input) but needs storage
  and a rule for two devices making one at once; a fixed-IV encryption of
  a label works but is a misuse pattern. Chosen: the HKDF unwrap, pending
  the reviewer. The vectors were worked out again with Python's `hmac`
  and `hashlib`.
- **Files** (`crypto/files.js`, v3): a random 32-byte key per file, kept in
  its item's record. Thumbnail, full size and a reserved cover part, every
  part of photos and videos alike in 1 MB pieces bound to
  `notonawa|file|v3|<user>|<file>|<part>|<n>|last|more`, so the server
  can't reorder, swap or cut short a part.
- **Identity keys** (`crypto/identity.js`): X-Wing through hpke and
  @panva/hpke-noble; HPKE base mode, info `notonawa msg v1`; a sealed
  message is the 1,120-byte encapsulated secret then the ciphertext. The
  32-byte seed is sealed under the data key as `i1.<iv>.<ct>`, bound to
  the user and the SHA-256 of its public key, so the server can't pair the
  seed with a public key of its own.
- **The acceptance and messages** (`crypto/pair.js`): the acceptance is
  HPKE-sealed to the inviter (bound to `notonawa|accept|v1|<share>`) and
  carries an HMAC-SHA256 under a key from the link's key (HKDF, info
  `notonawa accept v1 <share>`), so the server, which has the inviter's
  public key but not the link, can't forge one. Later messages are
  `m1.<counter>.<iv>.<ct>` under the pair key, bound to
  `notonawa|msg|v1|<mailbox>|<counter>`; a counter must be above the last
  taken (`acceptCounter`).
- **Safety numbers** (`crypto/safety-number.js`): Signal's numeric
  fingerprint exactly (libsignal's `fingerprint.rs`): it reproduces their
  published vector, and Python's `hashlib` gives the same on X-Wing-sized
  keys.
- **Schema** (`records/schema.js`): each kind's fields and the checks on
  one record, the server's and the database's rules today (kept in step
  with `src/` by a unit test). Fields a record has that its kind doesn't
  list are kept, so a device on an older version doesn't drop them. Rules
  across records (one "this is me", one default location, deleted links)
  wait for the cache (phase 4), where the whole journal is to hand; so do
  a drawing's and pose's own checks, which today are only the server's.
- **The Worker** (`vault-core.js`): `recordIds`, `sealRecords` (checked
  first), `openRecords` (one that won't open comes back unreadable, not
  failing the rest), `sealFile`, `openFile`, `copyFile`, `makeIdentity`,
  `openIdentity`, `sealAcceptance`, `openAcceptance`, `sealMessage`,
  `openMessage`. Item keys leave only sealed; file and pair keys only
  inside records; the seed only sealed, and it's forgotten on lock.

## Encrypt everything: server v2 as built (November 2026)

Phase 3: the server's side of format 2, in migration 0032 and `src/records/`,
`src/files/`, `src/identity/`, `src/mailboxes/`, `src/convert/` and
`src/format.js`. Built and tested; no account uses it yet
(`NEW_ACCOUNT_FORMAT` is 1 in both environments until phase 4's store).

- **Records**: one D1 batch per `POST /api/records`, all or nothing. A
  stale write, a reused or deleted id, or going over the 1 GB is caught by
  an INSERT into an always-empty table (`version_checks`, `quota_checks`)
  whose NOT NULL column fails the batch, as D1 has no way to abort a batch
  on a condition otherwise. The page seals the version it writes (one more
  than it read) and the server only checks it, with triggers so the version
  only rises by one and a deleted id never comes back. Sequence numbers come
  from raising `users.sync_seq` by the batch's size, each op taking its
  place below the new value. Deletion markers are kept for good, so a
  device away for months still syncs.
- **Files**: `<owner>/files/<id>` in the photos bucket; the row has sizes
  only. The quota is checked in the insert. While converting, format 1
  media doesn't count against the 1 GB (`roomLeft`), since the conversion
  holds two copies for a while.
- **Mailboxes**: the plan had a daily cap per mailbox; built instead as at
  most 100 messages waiting in a mailbox (the next send gets 429). Read
  messages are deleted, so this stops a flood just as well, and nothing has
  to count per day. Only the token's hash is stored; a wrong token and no
  such mailbox are the same 404. D1's `meta.changes` on a DELETE counts
  rows removed by cascade, so a delete checks `> 0`, not `=== 1`.
- **The gate** (`src/format.js`): one pure function for every signed-in
  request, rather than a check in each route, so a route can't forget it.
  410 with `reload: true` is "this page is the wrong version for your
  account". While converting, the format 1 journal answers reads (the
  conversion reads everything through the export) but refuses changes with
  409, so an old open page can't write after the conversion has read. Two
  POSTs only read (the tie search and the stats) and stay open. Mailboxes
  wait for format 2: nothing during the conversion needs them.
- **Conversion** (`src/convert/`): start marks the account converting once
  (starting again keeps the first time, which another device reads as when
  it began). Finish is one batch: refused unless converting and with at
  least one record (a conversion always writes "Me", so a page gone wrong
  can't delete a journal that has no copy), the format 1 photos' ids read,
  the account made format 2, and every format 1 journal table's rows of
  mine deleted, items that link to others first, children by cascade; the
  old R2 objects after it (the daily sweep catches any missed). A second
  finish is refused. Connections and shares stay: a connection has another
  account's side (phase 6 decides), and a share is sealed with its link's
  key. The settings columns on `users` stay too, until the settings record
  replaces them.
- **Sign-up**: `NEW_ACCOUNT_FORMAT` (`"1"` or `"2"`) picks a new account's
  format; a format 2 account gets no plain "Me" row, as its device writes
  "Me" as a record.

## Encrypt everything: the cache as built (November 2026)

Phase 4, slice 1: the cache, syncing and the journal in memory, for
format 2 accounts (none yet: `NEW_ACCOUNT_FORMAT` is still 1). Format 1
is untouched, and opens no IndexedDB (the lock walkthrough checks).

- **Where things live**: the crypto Worker opens the cache, syncs it and
  saves records itself (fetching `/api/sync` and posting `/api/records`,
  as it already fetches photos), so the cache and the server stay in step
  in one place. The page gets records opened, whole, and holds them in
  memory (`store/v2/journal.js`) while unlocked; the queries run there.
- **Saving needs a connection**, as before: the cache is for reading
  and searching. Weighed: a queue of offline saves; left for later
  (roadmap.md, "Saving while offline"), as it brings its own conflicts.
- **A save another device beat** (409 stale): the store syncs, carries
  each edit onto the newer version field by field (`mergeEdit`: the
  fields I changed take mine, the rest theirs; mine wins a clash, as I'm
  the one saving and can see what I typed), and tries once more. A new
  record whose id another device took first (both making "Me") is left
  as theirs. Weighed: refusing ("changed on another device", the edit
  lost) and last write wins (the other device's change silently lost).
- **Tabs**: one syncs or saves at a time per account, with the browser's
  Web Locks (simpler than choosing a leader tab, and nothing to hand over
  when a tab closes); a BroadcastChannel tells the others which ids
  changed, so each reads them again from the shared cache, and locking
  one locks all.
- **The settings record has a worked-out id**, like "Me"'s (`settingsId`:
  HMAC of `notonawa settings v1|<user>` under the id key), so two devices
  making it at once write the same record. Every unlock makes "Me", the
  settings record and the identity key if they're missing, so an account
  whose sign-up stopped half-way catches up.
- **Wiping**: signing out and deleting the account delete every
  `notonawa-*` database on the device. A session that just ends (a 401)
  doesn't: the cache is sealed, and named for its account.

## Encrypt everything: people and locations as built (November 2026)

Phase 4, slice 2: people and locations in format 2 (`store/v2/resources.js`).

- **The pages don't change**: the v2 store gives the same rows as format
  1's API (`store/queries/resources.js`; a unit test compares the columns
  with `src/resources/config.js`), in the same order, and takes the same
  fields. `store/index.js` picks v1 or v2 when each function is called.
- **The rules the database kept** are `records/edits.js`'s, given the
  whole journal: one default location (making one clears the other in the
  same batch), "Me" never archived or deleted, a deleted person or
  location left on its ties and workshops. A form's fields keep what the
  form hasn't (profile notes, fields a newer version added). The server's
  parsers are copied with their messages (`records/parse.js`), so the
  same mistake reads the same in both formats.
- **Big edits**: the server takes 50 changes a batch. Deleting someone
  who's on more ties than that goes in several batches, the ties first and
  the delete last, so one that fails leaves nothing pointing at a record
  that's gone (the person is just still there).
- **Maps links, both formats**: a full Google Maps link is read on the
  device now, never sent; only a short link, which has to be followed, goes
  to `POST /api/locations/coords`. PRIVACY.md still says full links are
  read on our server, which now overstates what's sent; it's corrected in
  phase 7's rewrite rather than with a policy version of its own.

## Encrypt everything: plans and tags as built (November 2026)

Phase 4, slice 3: plans and tags in format 2.

- **Tags are records** (`{ name }`), and a tie, plan or workshop lists its
  tags' ids. Saving an item with tag names matches them to my tags
  ignoring capitals and makes records for new ones in the same batch;
  deleting a tag takes it off everything, then deletes it.
- **Two devices can make the same new tag at once** (random ids, so
  neither save is stale), leaving two tags of one name. Weighed: ids worked
  out from the name, as "Me"'s are; refused, as a deleted id can never
  come back, so a tag once deleted could never be made again. Rare, and
  visible (both show in the tag list, each deletable); merging them can
  come later if it happens.
- **Deleting a plan** changes its ties as the person chose (off them, or
  "(plan deleted)"), stops other plans being variations of it, deletes its
  drawings and poses, and frees its photos' and videos' files, in one
  save (several batches if over 50, the plan's delete last).
- **A plan's `version`** stays 1, as format 1's never rose either; ties
  keep the version they were logged against.

## Encrypt everything: ties and Analytics as built (November 2026)

Phase 4, slice 4: ties, the Ties search, the recent pickers and Analytics'
ties in format 2.

- **The search runs in memory** (`store/queries/ties.js`), with format 1's
  filters (people: all of them; locations: any; tags: any or all; dates
  inclusive), order (date, then when logged, then id, so pages never
  shift; oldest first exactly reversed) and paging. The keyword is matched
  in memory too, over titles, notes and linked plans' titles, the same
  `search-match.js` the crypto Worker uses for format 1: format 2's notes
  are already open in the page, so nothing more is exposed.
- **Rows match format 1's**: `src/ties/db.js` exports `TIE_COLUMNS` so a
  unit test can check the columns. People and plans with no name (deleted)
  sort first, as SQLite sorts NULL.
- **Link ids**: format 1's link rows had ids, which the edit form sends
  back to keep a deleted person or plan. Format 2's entries have none, so
  a row's link id is its place in the record's list (`p0`, `l1`), stable
  for as long as the form is open; a conflicting edit from another device
  is carried over field by field (the whole list as one field).
- **A person kept in the same role keeps their entry** (an import's ratings
  and notes on it), and a plan kept its recorded version, as in format 1.

## Encrypt everything: workshops as built (November 2026)

Phase 4, slice 5: workshops and the Education view in format 2
(`store/v2/workshops.js`).

- **A workshop's record** holds its educators and participants as one
  list, each with its kind and role, a person once, as format 1's
  `workshop_people`; deleted people and a deleted location are kept on an
  edit only as the form says (link ids `w<n>`, as ties' `p<n>`).
- **Links stay on the tie or plan** (`workshop_id`), as format 1 has them:
  a tie or plan has one workshop, and the workshop's linked list is worked
  out from them (plans A–Z, then ties oldest first). Deleting a workshop
  unlinks them in the same save.
- **Rows match format 1's**: `src/workshops/db.js` exports
  `WORKSHOP_COLUMNS` for the unit test.
