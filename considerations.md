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

1. **Hardening baseline.** *Built 2026-10-12, not yet deployed.* Security headers on every response (strict CSP
   with Trusted Types, `Cache-Control: no-store` on pages and API,
   `Referrer-Policy: no-referrer`, `nosniff`, `frame-ancestors 'none'`,
   COOP/CORP, `Permissions-Policy`, HSTS). The search keyword leaves the page
   URL and the API URL: the list is fetched with `POST /api/ties/search`, the
   keyword travels only in the body, and it never goes into history. Free-text
   fields get `autocomplete="off"` and `spellcheck="false"`. No stored request
   logs. *First because
   it's small, needs no packages or migrations, and closes leaks that exist
   today (search words in browser history and request logs).*
2. **Passkey sign-in and app sessions (replaces Cloudflare Access).** WebAuthn
   registration and sign-in in the Worker; `__Host-` session cookie
   (`HttpOnly; Secure; SameSite=Strict`, 30 days max, 7 days idle) with only
   a SHA-256 hash of the token stored; Origin check on writes; rate-limited
   sign-in; several passkeys per account; recovery code; "your sessions" with
   sign out everywhere; 18+ confirmation and consent for sensitive data at
   sign-up. Registration asks for the PRF extension and records whether each
   passkey supports it, ready for step 4. Moves the existing account across.
   No email is collected; `users.email` is dropped. *Before encryption
   because the keys hang off passkeys and the recovery code.*
3. **Account export and deletion**, plus the retention rules in PRIVACY.md:
   JSON export, delete-account (cascades through D1), encrypted operator
   backups with a fixed retention. *Before encryption while it's simple; steps
   4–6 each extend it.*
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
  - Steps 3–5: none (WebCrypto does AES-GCM, HKDF and PBKDF2).
  - Step 6: none for JPEG, PNG and WebP: redrawing on a canvas and re-encoding
    writes a new file that has no metadata. HEIC is the exception: only Safari
    decodes it. iPhones usually convert to JPEG when the file input
    `accept`s only JPEG/PNG/WebP, so try that first; a HEIC decoder (WASM) is
    the fallback if needed.

### Weighed and not adopted

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

The + button at the end of the nav (every page) opens the "Log a tie"
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
