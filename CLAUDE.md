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
- **Lint, type check and test with every change**: run `npm run
  check:changed` after each change (add `-- --ui` when pages change), and
  the full `npm run check` plus `npm run test:ui` before a release. Report
  the results faithfully, failures included. New behavior gets new tests; a
  bug fix gets a test that would have caught it. A new file goes in an area
  in `scripts/areas.mjs` (a unit test fails until it is).
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
  `/api/auth/` routes per IP; `SHARE_RATE_LIMIT`, opening shares per
  account.
- **No stored request logs** (`observability` is off in `wrangler.jsonc`).
  Watch errors live with `npx wrangler tail`.
- **A dev environment for testing before production**: `env.dev` in
  `wrangler.jsonc`, the Worker `notonawa-dev` at dev.notonawa.app, with its
  own D1 (`notonawa-dev`), photos bucket (`notonawa-photos-dev`), `RP_ID`/
  `ORIGIN` (passkeys made there only work there) and rate-limit namespace
  (1002). No backups (`BACKUP_PUBLIC_KEY` is empty, so the daily job logs
  that it skipped one) and no feedback emails (no `FEEDBACK_EMAIL`).
  Bindings and vars aren't inherited from the top level, so a new one
  needs adding to both. Deploy with `npm run deploy:dev`; apply
  migrations with `npx wrangler d1 migrations apply DB --remote --env
  dev`. The scripts take `--dev` in place of `--remote` (below).
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
  Pages stay `no-store`; `/js/*` and `app.css` are `no-cache` and
  `/img/*` is cached a week, so **a changed image needs a new file name**.
  The logos are `.logo` backgrounds for the mode (`app.css`), AVIF.
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
  `import-db.js` (`json_each` inserts) for `POST /api/data/import/items`,
  `/api/data/import/ties` and `/api/data/import/workshops` (all take
  `preview`; workshops are found duplicates as ties are, comparing their
  description and notes on the device). A person, location or plan sent
  with `match: false` is always added, never matched by name (adding a
  shared tie, plan or workshop). Drawings are in the export as
  their lines (a zip with an SVG of each), and imported by the page
  through `POST /api/drawings`. See considerations.md,
  "Export, import and deletion as built".
- `src/media/`: photos and videos on ties, plans and workshops (migration
  0010, workshops since 0018; files in the R2 bucket `PHOTOS`). `parse.js` (pure: limits, including 5
  videos of the 30 an item and 40 MB a video, upload parameters, sealed
  captions), `db.js`, `storage.js` (R2: keys, deleting, the daily
  sweep of files without a row), `routes.js` (`GET /api/media?tie_id=|
  plan_id=|workshop_id=`, `PUT /api/media/:id` (the upload), `GET /api/media/:id/thumb|
  full`, `PATCH /api/media/:id` (caption), `DELETE /api/media/:id`).
- `src/drawings/`: drawings on ties, plans and workshops (migration 0019),
  kept as their lines, plain JSON in D1 (not encrypted, by choice; the
  caption is, as an encrypted column). `parse.js` (pure: the format
  `{ v: 1, strokes: [{ c, w, p }] }`, `COLORS`, a 900 × 1200 canvas, 20 an
  item; `public/js/drawing-format.js` has the same rules, kept in step by
  a unit test), `db.js`, `routes.js` (`GET /api/drawings?tie_id=|plan_id=|
  workshop_id=`, `POST /api/drawings` (adding, duplicating and copying
  alike), `PUT /api/drawings/:id` (lines and/or caption), `DELETE
  /api/drawings/:id`).
- `src/poses/`: poses on ties, plans and workshops (migration 0020): a 3D
  figure kept as numbers, plain JSON in D1 (not encrypted, by choice; the
  caption is). `parse.js` (pure: the format `{ v: 1, joints, body, lift,
  camera, ring, bamboo, hashira, ropes }`: a camera of six numbers (four
  in older poses, read as not panned sideways), at most one hardpoint
  (ring, bamboo or hashira; older poses have no bamboo or hashira; a
  bamboo is `[x, y, z, turn, length, inset]`, four numbers in older
  poses), ropes with `l` (cinches: tied to spots on other ropes,
  `["rope", index, segment, along]`) or `s` (see-saws),
  `JOINTS` and their limits, the same as `public/js/figure-rig.js`'s and
  `pose-format.js`'s, kept in step by a unit test; 20 an item), `db.js`,
  `routes.js` (the same routes as drawings, under `/api/poses`).
- `src/pose-presets/`: saved poser presets, each account's own body and
  arms positions for any pose (migration 0025). `parse.js` (pure: kind
  `body` (every joint but the arms', the body's turn and lift) or `arms`
  (the shoulders, elbows and wrists, `ARM_JOINTS`), checked against
  `src/poses/parse.js`'s `JOINTS`; a sealed name; 50 an account), `db.js`,
  `routes.js` (`GET`/`POST /api/pose-presets`, `PUT
  /api/pose-presets/:id` with `{ name }`, `DELETE
  /api/pose-presets/:id`). The name is an encrypted column (NULL after a
  new key, shown unnamed); the angles are plain JSON, as poses' are.
- `src/visuals/`: an item's photos and videos, drawings and poses share
  one order (no migration: each table's `position` counts across all
  three). `db.js` (`nextPosition`: the SQL each insert uses to go last
  among them all; `setVisualOrder`), `parse.js` (pure), `routes.js` (`PUT
  /api/visuals/order` with `{ tie_id | plan_id | workshop_id, order: [{
  kind: "media" | "drawing" | "pose", id }] }`: every visual, or it's
  refused). The kinds have no order routes of their own.
- `src/cleanup.js`: the daily cron trigger (ended sessions, expired
  challenges; `index.js` also runs the share clean-up, the photo sweep
  (which checks share files too) and the backup, each carrying on if one
  before it fails).
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
- `src/shares/`: shares, sealed copies of a profile, tie, plan or workshop
  that someone else opens with a link (migrations 0022, 0023 and 0027; see
  considerations.md, "Sharing between accounts" and "Photos and videos in
  shares as built"). `parse.js` (pure: kinds,
  expiries, limits (50 an account, live or being uploaded, a 2 MB
  snapshot, up to 30 photos and videos (5 videos) sized as mine, counted
  in the 1 GB with photos: `accountBytes` in `src/sql.js`), R2 keys
  `<owner id>/shares/<share id>/snapshot` and `…/<file id>` in the photos
  bucket, `FILES_GRACE`), `db.js`,
  `storage.js`, `cleanup.js` (the daily job: ended ones; with files, an
  hour after; never made ready, after a day), `routes.js`
  (`GET`/`POST /api/shares` (`files`: how many photos and videos follow;
  until then it's not `ready`), `PUT /api/shares/:id/files/:fileId?kind=&
  thumb_bytes=`, `POST /api/shares/:id/ready` (openable, its expiry
  counted from now), `POST /api/shares/files` with `{ id, file, part }`
  (a sealed thumbnail or full size, while it's live or for an hour after
  it ends), `DELETE /api/shares/:id` (revoking deletes it, files too,
  at once), `POST /api/shares/open` with `{ id }`: someone else's counts a
  use, and the last allowed one deletes it (or, with files, ends it); ended
  or unknown is the same 404; it also says `connection_id`, my side of a connection with the
  owner if there is one, and, for an invite with `connect` (migration
  0026, profile invites only) from someone I'm not connected to, an
  `offer` token for `POST /api/connections`). The label and `link_key` (the link's key, kept so its owner can
  show the code again; never exported) are encrypted columns; the snapshot
  is sealed with the link's own key, which the server only ever has sealed
  with the owner's.
- `src/connections/`: connections between accounts, made by accepting a
  profile invite that offers one (migration 0026; see considerations.md,
  "Connecting accounts as built"). Each account has its own row of a
  connection (`owner_id`, `peer_id`, `invited`, its own sealed `label`,
  `answered`), so pages only ever see their own row's id; deleting one
  deletes the other (a trigger). `connection_offers` (a token's hash, the
  inviter, the invite's sealed label, a day's expiry; deleted by the share
  clean-up). `parse.js` (pure), `db.js`, `routes.js` (`GET
  /api/connections`; `POST /api/connections` with `{ offer, person_id,
  label }`; `PUT /api/connections/:id/person`; `POST
  /api/connections/:id/answered`, the inviter's Not now; `DELETE
  /api/connections/:id?about=remove|keep`, required, the first clearing my
  About from their card for me; allowed before agreeing to a changed
  policy).
- `src/notices/`: messages from us (migration 0012), written only with
  `scripts/notice.mjs`. `GET /api/notices` (for everyone or just me, on
  now, not dismissed), `POST /api/notices/:id/dismiss`.
- `src/resources/`: plans, people and locations, all described in one
  `RESOURCES` table (`config.js`) and handled by the same routes. Plans are
  `tagged`: their tags are sent and listed as names and saved in the same
  batch (`LinkStatements` in `db.js`). The plans list also has
  `linked_ties` (id, title, date and rating of each tie it's on, newest
  first); `jsonColumns` are parsed by `listRows`.
- `src/locations/`: location routes beyond the shared ones (a location's
  `city`, `state_province` and `country`, plain text, are ordinary
  resource fields since migration 0017). `maps.js`
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
- `src/workshops/`: workshops, the Education view's (migration 0018).
  `parse.js` (pure: a title and start date required, an end date not
  before it, `attendee_count`, educators and participants each with a
  role, sent as two lists and stored as one, `workshop_people`, with a
  `kind`; a person is on a workshop once), `db.js` (tags through
  `tags/db.js`, as `"workshop"`), `routes.js` (`GET /api/workshops`: all
  of mine at once, newest first, as the page searches them itself; `POST
  /api/workshops`; `GET`/`PUT`/`DELETE /api/workshops/:id`, with
  `keep_deleted` as on ties). Whether I taught one is whether my "this is
  me" profile is one of its educators: nothing stores it.
- `src/stats/`: the analytics' data (`parse.js`: pure, the filters and
  `ROLE_GROUPS`; `db.js`; `routes.js`: `POST /api/stats/ties`, the ties in a
  date range with only what the counting needs, filtered by my role and by
  any of the chosen people, locations and tags). See considerations.md,
  "Analytics".
- `src/tags/`: tags, shared by ties, plans and workshops (`parse.js` parses and
  matches names, ignoring capitals; `db.js`: `tagStatements` and
  `clearTagsStatement` save a tie's or plan's tags; `routes.js`: `GET
  /api/tags` most recently used on a tie first, with `tie_count`,
  `plan_count` and `workshop_count`, `DELETE /api/tags/:id`).
- `src/version/routes.js`: `GET /api/version` (`{ version }`, no
  session needed), for pages left open over a deploy (`version-check.js`).
- `src/app-version.js`: generated from `VERSION` by
  `scripts/releases.mjs` (never edit it): `APP_VERSION`, up to which new
  accounts start as having seen the release notes.
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
  `crypto/media.js` (pure: sealing and opening photos, videos (their full
  size in 1 MB pieces, format v2) and captions, bound to the photo's id),
  `crypto/share.js` (pure: a share's id and key, sealing and opening its
  snapshot, bound to its id and kind, its photos and videos (another key
  from the link's, each bound to the share and the file's id, in
  `media.js`'s format: `sealObject` takes a binding), and the link's
  `#<id>.<key>`),
  `share-options.js` (pure: a share's expiry and use choices, the warning
  for one anyone can use for good (and connect to me with), Shared by me's
  words, the link), `connection-text.js` (pure: the connecting
  disclosures, a connection's words in Shared by me, the inviter's banner),
  `connections.js` (loading mine, their names opened: an inviter's is
  sealed as a share's label, `convertConnections` in `journal-fields.js`;
  Add to a Person, removing one, the link icon, `CONNECTIONS_CHANGED`),
  `connection-banner.js` (the inviter's banner, after the notices: Add to a
  Person, New Person, Not now),
  `profile-share.js` (pure: a profile invite's contents, built from the
  ticked fields and the name typed in, and read strictly, as it comes from
  another account), `contact-merge.js` (pure: a shared profile as a new
  person, or merged field by field into one I have; their About, when they
  shared one, replaces the card's, dated in `people.about_shared_on`
  (migration 0024); my notes are never touched), `pending-share.js` (the link
  being opened, its key taken out of the address on load and kept in
  memory through sign-in and unlock; forgotten on lock), `qr.js` (pure: a
  link's QR code as one SVG path, from `vendor/uqr.js`), `share-code.js`
  (a share's code, link, Copy link and share sheet), `share-save.js`
  (sealing and saving a new share, for every Share dialog; its photos
  sealed again in the crypto Worker (`reshareMedia`) and uploaded, then
  ready, or revoked if a step fails),
  `share-profile-dialog.js` ("Share my profile", from my own profile in
  People), `share-item.js` (pure: a shared tie, plan or workshop, built
  from the ticked fields and read strictly; people as names and roles, the
  sender marked; Drawings and poses and Photos and videos ticked
  separately, in one order, each photo a new file id; `shareFiles`), `share-item-dialog.js` (Share in a saved tie's, plan's or
  workshop's dialog), `share-people.js` (pure: Who is this? suggestions for
  each person, and the location's and plans' choices; a person is on an
  item once), `share-to-import.js` (pure: a shared item and the choices as
  an import, new items with `match: false`, mine filled in by id),
  `shared-by-me.js`
  (Your data's list: Show code, Revoke; and Connections: Add to Person,
  Remove), `views/open.js` (`/open`: opening a share, then
  `open-profile.js` (adding a profile invite; Connect our accounts when it
  offers to) or `open-item.js` (a tie, plan or workshop: Who is this?,
  Add to my journal through the import, Add another copy when it looks
  like it's there already; its photos' thumbnails, and each photo sealed
  as mine in the crypto Worker (`adoptShareFile`) and uploaded with
  `photo-upload.js`'s `uploadSealed`)),
  `crypto/vault-core.js` (what the crypto Worker does), `crypto-worker.js`
  (the Worker itself), `vault.js` (the page's side of it: unlock, lock,
  `addWrap`), `key-flows.js` (unlocking, setup, adding a passkey or recovery
  code with proof, sign-up, recovery), `search-match.js` (pure: keyword
  matching), `journal-fields.js` (pure: a whole export or import, kind by
  kind), `import-dedupe.js` (pure: import duplicates from candidates),
  `seal-leftovers.js` (encrypting older plain text), `links.js` (pure: album
  links, checked before sealing and again before being made clickable),
  `releases.js` (generated from `VERSION` and RELEASES.md: `APP_VERSION`,
  `RELEASES`),
  `version-rules.js` (pure: whether to reload) and `version-check.js`
  (a page left open over a deploy: the sign-in and Unlock views ask
  `/api/version` on showing, on coming back into view and before signing
  in or unlocking, and reload into a newer version; not while a share
  link is waiting to be opened),
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
  `video-fit.js` (pure: which videos, up to 3 minutes, 480p and bitrates)
  and `video-prep.js` (re-encoding a video with `vendor/mediabunny.js`:
  nothing of the original copied, no tags or track names; loaded only once
  a video is chosen), `drag-order.js` (pure: dragging photos into order),
  `photo-urls.js` (every `blob:` URL for a decrypted photo, revoked on
  lock), `photo-upload.js` (sealing and uploading one prepared photo or
  video and its caption; used by the Visuals section and import),
  `visuals-ui.js` (a form's Visuals section, on ties, plans and workshops:
  photos and videos, drawings and poses in one grid and one order, each
  tile outlined in its kind's chart color with a key beside the label;
  + opens "Add a visual from…"; each kind's own part is in `photos-ui.js`,
  `drawings-ui.js` and `poses-ui.js`), `visual-viewer.js` (what their
  details dialogs share: the caption with Save caption beside its label,
  ← Move earlier and Move later →, swiping to the next, not focusing the
  caption), `visual-order.js` (pure: merging the kinds' lists into one
  order, reading a swipe), `visual-icons.js` (camera, play, pencil and
  high-kicking figure icons), `photos-ui.js` (photos and videos: adding them,
  and the viewer, which plays videos with speed buttons), `tile-drag.js`
  (dragging the Visuals section's tiles into order),
  `figure-rig.js` (pure: the poser's figure, its joints and limits, shapes,
  and the body and arms presets, each leaving the other's joints alone;
  `bodyPresetFrom`/`armsPresetFrom` make a saved one from the figure),
  `pose-format.js` (pure: a pose, changing it, the hardpoints, panning,
  cinches and see-saws, `relink` when ropes go, undo/redo, `typedNumber`:
  a number typed into a slider's box, `forSaving`: without the poser's
  own pencil marks and `still`),
  `pose-ik.js` (dragging an arm or leg: the joints above the part held
  turn so it follows the finger, on a flat surface facing the camera,
  within the joints' limits; damped least squares with three.js's math,
  tested like the presets), `pose-skeleton.js` (the bones posed, with three.js's math
  only: where a joint or rope point is; tested), `pose-cinch.js` (a
  cinch's ends and the upline's bend, ropes drawn in runs, hanging
  stretches straight; three.js's math only, tested), `pose-constraints.js`
  (moving the body to keep uplines' lengths: a cinch's "Move the body",
  see-saw ropes; the drag solver's method, tested), `pose-marks.js` (pure:
  the pencil's marks, in view units, never saved) and `pose-marks-ui.js`
  (their layer over the view, and drawing them onto a picture),
  `pose-scene.js` (the 3D view, with `vendor/three.js`, the jute hanging
  lines; pictures of poses), `pose-editor.js` (the poser: a full-screen
  dialog like the drawing pad, with Pose, Rope and pencil modes and ▲▼
  beside each slider; "Add to visuals" puts a picture of the pose, with
  any pencil marks showing, in the item's visuals as a photo), `poses-ui.js`
  (poses: the poser, their pictures, and the viewer), `import-poses.js`
  (pure: an import's poses), `pose-presets.js` (my saved presets: read
  once, names opened, dropped on lock; saving, renaming, deleting) and
  `pose-presets-ui.js` (naming one, and "Manage my presets"),
  `import-presets.js` (pure: an import's presets to add, by kind and name),
  `drawing-format.js` (pure: the drawing format, simplifying a line, SVG
  paths and the export's SVG file), `drawing-edit.js` (pure: undo/redo and
  which line the eraser touches), `drawing-svg.js` (a drawing as SVG on
  the page), `drawing-editor.js` (the drawing pad: a full-screen dialog
  over the form, not a view, so the form isn't closed), `drawings-ui.js`
  (drawings: the drawing pad, and the viewer's Edit, Duplicate, Copy to…;
  `saveDrawing`), `drawing-copy.js` (Copy to…'s
  picker of ties, plans and workshops), `import-drawings.js` (pure: an
  import's drawings, taken off and saved once the rest is),
  `vendor/` (libraries copied from node_modules by
  `scripts/vendor.mjs`, never edited; their `.d.ts` beside them; three.js
  is bundled there from only the parts in `scripts/vendor/three-entry.mjs`,
  with our own types, `scripts/vendor/three.d.ts`), `lock-rules.js` (pure) and `lock.js`
  (locking by itself), `api.js`, `dom.js` (`h`, `$`, `privateField`, `infoButton`, `infoTip` (a "?" and
  the explanation it shows), `removeX` (the small × on a chosen value's
  corner, like a tag's), `opensOnTap`: a list's
  card opens when tapped anywhere, its title still the button), `dialog.js` (`choose`),
  `dialog-icons.js` (an edit dialog's heading row: the heading, then
  delete (red), archive or restore, share and ✕ icons; ties and workshops
  have no archive, people share only "Me"; a saved item's dialog opens on
  its heading, not a text box, so no keyboard), `form-changes.js` (whether
  an edit form has changes since it opened: editing a saved tie, plan,
  person, location or workshop, Save changes is muted and does nothing until
  it has (a new one's Save stays on); ✕ and Esc ask "Discard your
  changes?" first, `guardClose`),
  `format.js`, `ties-view.js` and `tie-search.js` (pure; the Ties,
  Plans and Education searches show only the keyword, the rest folded
  under "More options", a `details.fold` like a plan's Linked ties; Ties
  opens it when the address brings a filter), `plans-view.js`
  (pure: the Plans search, done on the device over the loaded plans and
  kept only in memory, and a plan's tie count and average rating),
  `nav.js` (the tabs, as icons with their
  names in `aria-label` and `title`: Ties, Plans, People, Locations, Calendar,
  Analytics, Education (`CAP_PATHS`, the cap, also on People's educators),
  sized to fit one row down to 320px wide; the + button and the ☰ menu panel: Settings, Account, Your
  data, Bug and feedback, What's new, Privacy Policy, Sign Out and the version; drawn once,
  `setCurrent` marks the view), `tie-form.js` (the "Log a tie" dialog), `person-rows.js` (a form's
  person-and-role rows, with "(person deleted)" rows: the tie form's
  People, a workshop's Educators and Participants), `workshop-form.js`
  (the "Add a workshop" dialog; educators are only people marked
  Educator, the rest are the picker source's `elsewhere`, and one added
  there is saved as an educator), `workshop-card.js`, `workshops-view.js`
  (pure: the Education search, attended or taught, the Summary's
  numbers), `tag-picker.js`
  (its "Edit tags" dialog; the Ties and Plans searches' "Has Tags" open it
  with `forSearch`, for picking existing tags only, on ties or, with
  `noun: "plan"` or `"workshop"`, on plans or workshops) and `tags.js` (pure), `search-picker.js` (its
  search boxes for the location, people and plans, which can also add one),
  `search-choices.js` (pure: what those boxes list and offer to add),
  `rope-rating.js` (ratings drawn as rope hanks; `hankIcon`),
  `stats.js` and `stats-period.js` (pure: the analytics' numbers, and its
  periods and bars; `roleChartTies` and `withSegments` split the tie count
  and partner bars by my role), `charts.js` (bar, partner, location and pie
  charts as SVG; bars, rows and slices are buttons) and `chart-parts.js`
  (pure: their colors and what a bar says in words), `map-geo.js` (pure:
  the Analytics map's projection, view, zoom and pin grouping),
  `world-map.js` (the map, loaded when its card nears the screen) and
  `world-shapes.js` (generated by `scripts/world-map.mjs`: the country
  outlines), `tie-card.js` (a tie as a card, shared by the
  Ties list and Analytics; `editTie`), `tie-list-dialog.js` (Calendar and
  Analytics: the ties behind a day, bar or slice), `multi-select.js`,
  `resource-page.js` (list/edit pages; with `dialog`, the form is in a
  dialog that + and tapping a row open, as on Plans, People and Locations;
  with `actionsInDialog`, the rows have no buttons, tapping one anywhere
  opens it, archived ones too, and Delete and Archive (or Restore) are
  icons on the dialog's heading row, as on all three; `extraActions`:
  Share after them (a plan's; Share my profile on "Me"); `changeState`:
  what else counts as a change (a plan's tags); `itemClass`: Plans' rows are cards like ties'), `aliases.js` (pure: a person's social and scene
  names, sealed as one JSON field; `personMatch`, what a people search
  finds and shows), `list-tools.js` and `list-order.js`
  (People and Locations: the search box and sort buttons, and the pure
  filtering and sorting; `placeText`, a location's "City, State,
  Country"), `csv.js`, `import-csv.js` and
  `import-steps.js` (pure: reading CSVs, CSV rows to an import, and an
  import's requests), `import-photos.js` (pure: an import's photos, taken
  off its ties and plans before sending and uploaded once the rest is
  saved), `zip.js` (pure apart from `DecompressionStream`: zip files for
  exports with photos), `notices.js` (the banners between the nav and the
  view), `install-rules.js` (pure: whether and how to offer
  installing the app) and `install-banner.js` (that offer, under the
  notices: Chrome's and Edge's own Install, or where to find it in Safari
  and Firefox; "Not now" kept in localStorage), `consent-state.js` (whether I must agree to a changed policy;
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
  up with Chrome's virtual passkey. It runs the chunks in
  `scripts/ui/chunks/` (`UI_CHUNKS` in `scripts/areas.mjs`), each from a new
  account of its own (`freshAccount()`), seeded where it needs one with
  `scripts/ui/seed.mjs` (what the People, Locations, Plans and Ties chunks
  make, through the API), so any chunk runs alone. `scripts/ui/harness.mjs`
  starts wrangler and Chrome and has the helpers (`run`, `go`, `check`,
  `sql`). A check that relies on another chunk's data seeds it instead.
  Chunks run 3 at a time by default (`--jobs`): each batch (`batches()` in
  `scripts/areas.mjs`, sharing them out by `UI_SECONDS`) in its own copy of
  the script, with its own database, app and Chrome on its own ports
  (`UI_SLOT`). A step should wait for what it needs to show rather than a
  fixed time, as a busy machine is slower.
- `scripts/areas.mjs` (pure; `test/unit/areas.test.js`): the app as feature
  areas, each with its files, tests and walkthrough chunks, and the shared
  files that run everything. `scripts/check-changed.mjs` uses it.

### Commands

- `npm run check`: lint + type check + tests, and checks `public/privacy.html`
  matches PRIVACY.md, the release files match VERSION and RELEASES.md, the welcome
  matches WELCOME.md and `public/js/vendor/` matches node_modules. Run before a release.
- `npm run check:changed [-- <area>…] [-- --ui] [-- --jobs N] [-- --list]`: lint and type
  check, then only the tests (and with `--ui`, the walkthrough chunks) of
  the areas changed since the last commit, or of the areas named. A shared
  file, or one in no area, runs everything. `--list` shows what it would
  run. Run after every change.
- `npm run deploy:prod` / `npm run deploy:dev`: deploy (`scripts/deploy.mjs`), always
  this way rather than `npx wrangler deploy`. Every deploy gets a new
  version, the UTC date and time (`YYYY.MM.DD.HHMM`, e.g.
  2026.10.28.2104; older releases end in 001, 002… that day), shown on
  sign-in and in the menu, so open pages and installed apps reload into
  it (`version-check.js`). It's written to `VERSION`, `## Next` in
  RELEASES.md is renamed to it, the release files are rebuilt, and the
  Worker deployed with `--tag <version>`. Production's changed files are
  committed afterwards; dev puts them back. Plain `npm run deploy` refuses
  (npm drops a `--dev` given without `--`, so there's no default). It refuses a version not
  newer than the one being served (twice in a minute).
- `node scripts/releases.mjs`: rebuild `public/js/releases.js` and
  `src/app-version.js` after editing RELEASES.md. New notes go under a
  `## Next` heading at the top (`- ` bullets), left out of the app until
  a deploy names it; releases are newest first, none newer than `VERSION`.
  Never edit `VERSION` by hand.
- `node scripts/welcome.mjs`: rebuild `public/js/welcome-text.js` after
  editing WELCOME.md (the welcome dialog's text: a heading, paragraphs, a
  list, **bold**, *italics*; email addresses become links).
- `node scripts/world-map.mjs <ne_110m_admin_0_countries.geojson>`:
  rebuild `public/js/world-shapes.js`, the Analytics map's country
  outlines, from Natural Earth's 1:110m countries (downloaded; not kept).
- `node scripts/vendor.mjs`: copy `public/js/vendor/` again from
  node_modules after updating a vendored package (mediabunny, three, uqr), or
  after changing `scripts/vendor/three-entry.mjs` or `three.d.ts`; `--check`
  (in `npm run check`) fails if a copy differs.
- `node scripts/feedback.mjs [--since YYYY-MM-DD] [--kind bug|idea]
  [--remote | --dev]`: the bug reports and ideas sent from the app, newest first.
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
- **`--dev`**: the scripts that use the database (invite, recovery-code,
  notice, feedback, backup) take `--dev` in place of `--remote` for the
  dev environment's. `scripts/d1-target.mjs` turns it into `--remote --env
  dev` (refusing `--dev` with `--remote` or `--persist-to`), and the
  wrangler commands name the database by its binding, `DB`, so the same
  command works for every target. Dev backups are named `notonawa-dev-…`.
- `node scripts/invite.mjs [--remote]`: make an invite code.
  `node scripts/recovery-code.mjs [<user-id>] [--remote]`: list accounts, or
  give one a new recovery code (only when its owner asks, has a recovery
  email, and has proved the address is theirs). `--email <address>` finds
  the account with that recovery email.
- `node scripts/backup.mjs --remote`: an extra encrypted backup on this
  computer, in `backups/`; deletes ones older than 30 days when it runs.
  `node scripts/restore-backup.mjs <file>` decrypts one, or one of the
  daily backups (`.json.gz.enc`, with the backup private key).
- `npm run test:ui [-- --only people,plans] [-- --jobs N] [-- --list]`: UI
  walkthrough in headless Chrome on throwaway databases (with a generated
  copy of `wrangler.jsonc` whose sign-in rate limit is higher, as every
  page load there locks and unlocks): every chunk, or the ones named, 3 at
  a time (`--jobs 1`: one at a time, with output as it happens; use it to
  tell whether a failure only happens when the machine is busy).
- `npm run dev`: the app on localhost, with the dev environment's remote
  database and photos bucket (`--env dev`; apply new migrations there
  first; accounts made locally sign in only on localhost). `npm run types`: regenerate
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
  column (people, profile_notes, locations, plans, ties, workshops, drawings, poses, pose_presets) should normally include
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
- **Show deleted links on ties and workshops instead of hiding them:**
  - `tie_participants.person_id` or `workshop_people.person_id` NULL →
    "(person deleted)"
  - `tie_plans.plan_id` NULL → "(plan deleted)"
  - `ties.location_deleted = 1` or `workshops.location_deleted = 1` →
    "(location deleted)". Any code that sets a tie's or workshop's
    `location_id` must also set `location_deleted = 0` (a CHECK enforces it).
- **Deleting a plan needs the user's choice** of `linked_ties=remove` (also drop
  it from ties) or `linked_ties=keep` (ties show "(plan deleted)"). The UI asks
  with a confirmation dialog: remove from linked ties / just delete the plan /
  cancel. The API rejects a delete without the choice.
- **A person's `connection_id`** (migration 0026) is my side of a
  connection, and only the connections routes set it (it isn't a People
  field). Triggers allow it only for my own row of a live connection and
  never on "this is me"; a unique index puts each on one person; it's
  cleared when the connection goes. Import keeps it only for one of my
  connections not already on someone (`links_dropped` counts the rest).
- **Every journal has a "this is me" profile**, named "Me" when the account
  is made (`newUserStatements`; migration 0005 added one to older accounts).
  It can be renamed, but not archived or deleted (the API refuses: the tie
  form, Calendar, Analytics and Education rely on it), and edits can't change who it
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
  `people.based_in`, `people.aliases` (migration 0016),
  `profile_notes.description`, `locations.notes`, `plans.description`,
  `plans.notes`, `plans.album_url`, `workshops.description`,
  `workshops.notes`, `workshops.album_url` (migration 0018),
  `drawings.caption` (migration 0019; a drawing's lines aren't),
  `poses.caption` (migration 0020; a pose's numbers aren't),
  `pose_presets.name` (migration 0025; a preset's angles aren't),
  `connections.label` (migration 0026)): parse them with
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
  what a crash left behind. Shares' files are there too, in their owner's
  folder: deleting a share's row deletes its files (`shares/storage.js`),
  snapshot, photos and videos alike.
- **Photos and videos are prepared and sealed before they leave the
  device** (`preparePhoto`/`prepareVideo`, then `vault.sealPhoto`/
  `sealVideo`) and shown only from `photoUrl()` (`photo-urls.js`), whose
  URLs are all revoked on every lock (`onWipe`), emptying the images and
  videos showing them. The crypto Worker fetches photos itself (`openPhoto` takes an
  id), as it does the search index and shares' photos; a photo moving into
  or out of a share is opened and sealed again there, never on the page.
  Captions are sealed bound to their
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
