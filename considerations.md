# Considerations

Design ideas we've weighed, planned features, and the reasons behind them, so
we can revisit them later.

## Planned: privacy and accounts roadmap

**Status:** planned, next up (2026-10-12)

Goal: open the app to other users, with notes and photos end-to-end encrypted
so that even we (and Cloudflare) can't read them. [PRIVACY.md](PRIVACY.md)
is the draft policy describing the finished result; keep it in step with
what's built, and don't publish it until every step below is live.

### Order

Each step leaves the app working and shippable on its own.

1. **Hardening baseline.** *Built 2026-10-12.* Security headers on every response (strict CSP
   with Trusted Types, `Cache-Control: no-store` on pages and API,
   `Referrer-Policy: no-referrer`, `nosniff`, `frame-ancestors 'none'`,
   COOP/CORP, `Permissions-Policy`, HSTS). The search keyword leaves the page
   URL and the API URL: the list is fetched with `POST /api/ties/search`, the
   keyword travels only in the body, and it never goes into history. Free-text
   fields get `autocomplete="off"` and `spellcheck="false"`. No stored request
   logs. *First because
   it's small, needs no packages or migrations, and closes leaks that exist
   today (search words in browser history and request logs).*
2. **Passkey sign-in and app sessions (replaces Cloudflare Access).**
   *Built 2026-10-13, not yet deployed; see "Step 2 as built" below.* WebAuthn
   registration and sign-in in the Worker; `__Host-` session cookie
   (`HttpOnly; Secure; SameSite=Strict`, 30 days max, 7 days idle) with only
   a SHA-256 hash of the token stored; Origin check on writes; rate-limited
   sign-in; several passkeys per account; recovery code; "your sessions" with
   sign out everywhere; 18+ confirmation and consent for sensitive data at
   sign-up. Registration asks for the PRF extension and records whether each
   passkey supports it, ready for step 4. Moves the existing account across.
   No email is collected; `users.email` is emptied (see below). *Before encryption
   because the keys hang off passkeys and the recovery code.*
3. **Account export and deletion**, plus the retention rules in PRIVACY.md:
   JSON export, delete-account (cascades through D1), encrypted operator
   backups with a fixed retention. Import was added too. *Built 2026-10-13,
   not yet deployed; see "Step 3 as built" below.* *Before encryption while
   it's simple; steps 4–6 each extend it.*
4. **Encryption foundation.** Per-user random data key (AES-256-GCM), wrapped
   by a key derived from each passkey's PRF output and by the recovery code;
   wrapped copies stored on the server. A dedicated Web Worker holds the
   non-extractable key and all decrypted data; pages ask it for results only.
   Lock (drop key and plaintext, clear rendered notes) after 15 min idle,
   5 min hidden, on sign-out and on `pagehide`; unlock with the passkey.
   Nothing decrypted goes to localStorage, sessionStorage, IndexedDB or a
   service-worker cache.
5. **Encrypted notes and on-device search.** Encrypt the free-text fields:
   `ties.notes`, `tie_participants.notes`, `people.notes`,
   `profile_notes.description`, `locations.notes`, `locations.hard_points`,
   `plans.description`, `plans.notes`. Existing plaintext is encrypted by
   the browser on first unlock and the plaintext columns cleared. Keyword
   search moves into the crypto Worker (matching with `toLocaleLowerCase`,
   which also fixes the "Ö"/"ö" limitation below); the server takes a list of
   matching tie ids instead of a keyword, and `q` leaves the API entirely.
   Export decrypts on the device. *Before photos because it removes plaintext
   that exists today, and it builds the crypto Worker plumbing photos reuse.*
6. **Encrypted photos.** Private R2 bucket (no public access, no `r2.dev`
   URL); the browser strips metadata by redrawing the image on a canvas
   (`createImageBitmap` applies the EXIF rotation first), makes a thumbnail,
   encrypts both and uploads through an owner-checked Worker route. Shown
   from `blob:` URLs that are revoked on lock. Deleting a tie or the account
   deletes its R2 objects; export includes decrypted photos. Size limits and
   HEIC handling (Chrome can't decode it) to be decided.

### Decided along the way

- **Passkeys only; no passwords, email, or Google/Apple sign-in.** Third-party
  sign-in tells that company the user has an account here, and email would
  be another identifier to protect. Recovery is via a second passkey or the
  recovery code.
- **Titles, names, dates, ratings, links, tags, location coordinates and map
  links stay readable by the server** so filtering, sorting and paging keep
  working server-side. PRIVACY.md says so plainly. **Revisit** encrypting
  people's names and location coordinates/map links once step 5 is done.
- **Passkeys without PRF** unlock with the recovery code. **Revisit** if that
  turns out to be common enough to need a passphrase option.
- **Spellcheck is off** (`spellcheck="false"`) on free-text fields, along
  with `autocomplete="off"`. Basic spellcheck is local, but Chrome's opt-in
  "enhanced" spellcheck sends the text to Google, and we can't tell which one
  a user has on.
- **HSTS without `includeSubDomains`** for now (2026-10-12): the app is on
  `workers.dev`, whose other subdomains aren't ours. **Revisit** when the app
  moves to a custom domain: add `includeSubDomains` if every subdomain there
  serves HTTPS, and consider preload.
- **No stored request logs** (`observability.enabled: false`). Errors are
  only visible live with `wrangler tail`. Accepted (2026-10-12).
- **Packages per step** (each still needs approval when its step starts):
  - Step 1: none.
  - Step 2: verifying WebAuthn responses needs CBOR and COSE-key parsing and
    signature checks for several algorithms. Possible by hand with WebCrypto,
    but it's security-critical and easy to get subtly wrong, so the plan is
    `@simplewebauthn/server` in the Worker. The browser side needs nothing:
    `navigator.credentials` plus `PublicKeyCredential.parseCreationOptionsFromJSON`
    / `parseRequestOptionsFromJSON`, with a small hand-written fallback for
    browsers without them.
  - Steps 3–5: none (WebCrypto does AES-GCM, HKDF and PBKDF2). Step 3 was
    built without any: CSV parsing and backup encryption are hand-written.
  - Step 6: none for JPEG, PNG and WebP: redrawing on a canvas and re-encoding
    writes a new file that has no metadata. HEIC is the exception: only Safari
    decodes it. iPhones usually convert to JPEG when the file input
    `accept`s only JPEG/PNG/WebP, so try that first; a HEIC decoder (WASM) is
    the fallback if needed.

### Step 2 as built

- **`users.email` couldn't be dropped.** SQLite won't drop a UNIQUE column,
  and rebuilding `users` would cascade-delete every journal row (DROP TABLE
  runs an implicit DELETE). Migration 0003 overwrites each email with the
  user's id instead, and new users get email = id. **Drop the column** at the
  next full table rebuild (children-first, like migration 0002).
- **Moving the existing account:** no Access-and-passkeys overlap. After
  deploying, `node scripts/recovery-code.mjs <id> --remote` gives the account
  a recovery code; sign in with it and add a passkey. Then remove the Access
  application in Zero Trust.
- **Recovery code → login secret.** The browser derives a login secret
  (HKDF-SHA256, info "login") from the code and sends only that; the server
  keeps its SHA-256. The code is 160 random bits, so a fast hash is enough.
  Step 4 must derive the key-wrapping key with a different `info`.
- **A recovery session** lasts 15 minutes and can only see the account and
  add a passkey; adding one turns it into a full session. The old code keeps
  working until a new one is set (the page does that straight after), so a
  crash mid-way can't lock anyone out.
- **"Confirm it's you"** (fresh session, 10 minutes) for adding or removing a
  passkey and replacing the recovery code, so a stolen session can't quietly
  take over the account. Renaming and ending sessions don't need it.
- **Removing a passkey ends the sessions it started** (`ON DELETE CASCADE`).
- **Invites:** 80-bit codes, single use, 14 days by default; the trigger on
  `invites` makes two sign-ups racing for one invite fail cleanly.
- **`prf_capable`** comes from the browser's `prf.enabled` at registration;
  NULL when it doesn't say (some only report PRF at sign-in). Step 4 should
  fill unknowns in at sign-in.
- **Rate limit:** 20 requests a minute per IP across `/api/auth/` (Cloudflare's
  rate-limit binding, counted in memory).
- **Not yet:** account deletion and export (step 3; since built).

### Step 3 as built

- **Export** (`GET /api/data/export`, the "Your data" page): one JSON file,
  `format: "rope-journal-export"`, `version: 1`. Items keep their ids so the
  file's links can be followed and rebuilt; deleted links stay as null ids
  and `location_deleted`. Account details are only dates, the terms version
  and passkey names: no hashes, public keys or sessions. The page fetches it
  and saves it from a `blob:` URL (revoked after 10 s) rather than linking to
  the route, so step 5 can decrypt on the device first.
- **Photos in exports (step 6), decided now:** the export becomes a `.zip`
  holding `rope-journal.json` and a `photos/` folder, files named by photo
  id. Each tie and plan lists its photos in `photos: [{ id, file, caption,
  position, created_at }]`, `file` being the path inside the zip, so the
  JSON stays the record of what's attached where (titles repeat and change;
  ids don't). The browser builds the zip, because only it can decrypt the
  photos: a store-only zip (JPEGs are already compressed) is ~100 lines with
  a CRC32, no package. Import then saves the journal first and uploads each
  photo afterwards, one by one, to the new tie or plan id (R2 uploads can't be
  in a D1 transaction). `photos` is already in version 1, always empty, so
  step 6 needs no new version; import will accept both `.json` and `.zip`.
  Not chosen: base64 inside the JSON (a third bigger, one huge file, photos
  not viewable) or a separate photo download (the link depends on keeping
  two files together).
- **Delete account** (`DELETE /api/account`): needs a fresh session and
  typing "delete". One `DELETE FROM users` cascades through everything
  (tested table by table, and that other users are untouched). Then the page
  calls `PublicKeyCredential.signalUnknownCredential` where the browser has
  it, so the passkey can disappear from the user's password manager.
- **Daily cleanup:** a cron trigger (`src/cleanup.js`) deletes ended
  sessions and expired challenges, as PRIVACY.md promises.
- **Backups:** `scripts/backup.mjs --remote` exports D1, encrypts it
  (PBKDF2-SHA256 600k + AES-256-GCM via WebCrypto, header authenticated) and
  deletes backups older than 7 days, matching D1's own rolling history on
  the Free plan. **Old backups are only deleted when the script runs**, so
  it must run at least weekly (or `--prune-only`) for PRIVACY.md's "no more
  than 7 days" to hold. **Revisit** with a scheduled job on the operator's
  machine if that's easy to forget. The plaintext backups from earlier
  migrations were deleted (2026-10-13).
- **Import**: from an export, or a CSV of ties (one per row:
  date, title, type, duration, rating, location, people as `Sam (model); Alex
  (rigger)`, plans, tags, notes; `/import-template.csv`). Decided:
  - **CSV is ties only.** People, locations and plans named in it that the
    journal doesn't have are created.
  - **Matched by name**, ignoring capitals (exact spelling first, active
    before archived); the file's "this is me" matches the user's own. A
    matched item is used as it is, never changed, so its details in the file
    (notes, profile notes, tags) aren't imported.
  - **Exact duplicate ties are skipped:** same date, title and notes as one
    already in the journal. Two identical ties within one file are both kept.
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
  - **Step 5:** once notes are encrypted, the page must encrypt them before
    sending; it already builds every request, so only that step is new.
- **Ties import keeps more than the tie form does:** participants' ratings
  and notes, plan versions, deleted links and timestamps, so an export
  round-trips exactly (tested).

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

## Planned: "Archive now" when adding a location

**Status:** planned (2026-10-12)

We dropped `locations.is_one_off`: a one-off spot is just a location that's
archived straight away. The "Add location" screen should have an "Archive now"
option that sets `archived_at` when the location is created (in the same
INSERT, `archived_at = ${NOW}`), so it's saved for the tie's record but never
clutters the location picker. Existing one-off locations were migrated to
archived as of their creation date.

## Planned: the + button asks what to add

**Status:** planned (2026-10-12)

The + button in the nav (every page) opens the "Log a tie"
dialog for now. Later it should first ask what to add (tie, person, location,
and maybe plan) and open that dialog. `renderNav` in `public/js/nav.js` is
where the choice goes; the person and location forms would need to move into
dialogs the way the tie form did (`public/js/tie-form.js`).

## Planned: adjustable ties per page

**Status:** planned (2026-10-12)

The Ties list shows 20 per page (`PAGE_SIZE` in `src/ties/parse.js`; the API
returns it as `page_size` and the page uses that). To let the user change it,
accept a `page_size` query parameter (with a sensible cap, e.g. 100) and add a
picker under the list.

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

**Status:** known limitation (2026-10-12)

Tie keyword search uses SQLite `LIKE`, which ignores case only for ASCII
letters: "Ö" won't match "ö". Fine for now. **Revisit if** this comes up; the
options are a lowercased search column kept up to date on write, or FTS5.

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

## Planned: tags on the ties list

**Status:** planned (2026-10-12)

Ties can be tagged, but the list doesn't show tags or filter by them yet.
`listTies` would fetch `tie_tags` for the page the way it does participants and
plans; a tag filter would fit next to the people and location filters.
