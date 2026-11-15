# Roadmap

Planned features and known gaps that still need building. Once something
is built, move what we decided into [considerations.md](considerations.md)
(with the reasons) and take it off this list. Decisions that need no code
change, and "revisit if…" notes, stay in considerations.md.

## Videos

**Status:** not started. Comes after encrypted photos, which were built
so videos need no new migration or export format: `media.kind` already
allows `video` (the API refuses it for now, `KINDS` in
`src/media/parse.js`).

What changes from photos (weighed 2026-10-14):

- **Metadata:** MP4/MOV files carry GPS, dates and the device model in their
  own boxes; a canvas can't strip them. Either rewrite the boxes by hand
  (fast, keeps full quality) or re-encode (WebCodecs plus a muxer package,
  e.g. mediabunny, which needs approval; slow on phones, but strips
  everything and shrinks the file a lot).
- **Size:** about 40 MB a minute for 1080p from an iPhone, about 170 MB for
  4K. A Worker takes at most 100 MB a request, so uploads need R2 multipart
  (parts of at least 5 MB).
- **Encryption** in fixed-size pieces (say 1 MB), each with its number and
  an "is last" flag in the additional data, so the server can't cut a
  video short or reorder it. A new sealed format with its own version
  (photos are one piece per part; `crypto/media.js`).
- **Playback:** download, decrypt into memory, play from a `blob:` URL
  (`media-src blob:`). Fine for short clips, heavy on phones for long ones.
  Streaming would need MediaSource (patchy on iPhone) or a service worker
  holding the key, which breaks "the key lives only in the crypto Worker".
- **Thumbnail:** a frame drawn from a `<video>` onto a canvas.
- **PRIVACY.md** will need updating (what's stripped, size limits, backups).
- To decide then: the longest clip, and rewriting boxes or re-encoding.

## Final logo and icon files

**Status:** planned; needs the artwork, then no code changes unless a
file's format or size changes.

For now every image in `public/img/` is the same placeholder (230×191, the
whole logo with its wording). Each spot has its own file so the final
versions can be swapped in one at a time, with no code changes.

| File | Where it shows | What it should be |
| --- | --- | --- |
| `logo.png` | Top centre of Sign in (and Create an account and Use a recovery code, the same page), Unlock, and the top of the menu. Shown 220px wide on Sign in and Unlock, 160px in the menu. | The full logo with wording, transparent background, at least 660px wide (3× the largest size, for sharp phone screens). Readable on the light background (`#faf8f5`) as well as the dark one (`#201f1d` in the menu): the white wording in the placeholder disappears in light mode. Or an SVG. |
| `favicon.png` | The browser tab (app and privacy policy). | The book and knot only, no wording (it can't be read at this size). Square, 32×32 or 48×48, transparent background. An SVG (`favicon.svg`, `type="image/svg+xml"`) would be sharper at every size. |
| `apple-touch-icon.png` | The icon for "Add to Home Screen" on iPhone and iPad. | Square, 180×180, solid background (iOS fills transparency with black), the book and knot with about 10% padding. iOS rounds the corners itself. |
| `icon-192.png` | The Android/Chrome home-screen icon (`manifest.webmanifest`). | Square, 192×192, the book and knot. |
| `icon-512.png` | The Android splash screen and app installs (`manifest.webmanifest`). | Square, 512×512, the book and knot. |

If a file's format or size changes, update its `<link>` in `index.html` and
`scripts/privacy-html.mjs` (then run `node scripts/privacy-html.mjs`), or the
`icons` list in `manifest.webmanifest`. The manifest's colours (`#161514`) are
the dark theme's background.

## Drop `users.email`

**Status:** planned, at the next full rebuild of `users`.

The column is a leftover from Cloudflare Access: migration 0003 overwrote each email with the user's id, and new users get email = id, because SQLite won't drop a UNIQUE column and rebuilding `users` would cascade-delete every journal row (DROP TABLE runs an implicit DELETE). Drop it the next time `users` has to be rebuilt anyway, children first, like migration 0002. See "Passkey sign-in as built" in considerations.md.

## Finishing a photo import that stopped part-way through a tie

**Status:** known gap (2026-10-14).

Re-running an import gives a tie that's skipped as a duplicate (or a plan matched by name) the file's photos only if it has none yet, so a failed import can be finished without making copies (`import-photos.js`). But if the import stopped part-way through one tie's photos, that tie already has some, so running it again skips the rest. A fix could compare photo ids, or how many photos the tie has with how many the file lists.

## UI walkthrough sometimes hangs

**Status:** to investigate (seen 2026-10-14).

`npm run test:ui` sometimes hung on a step ("took over a minute") or met an Internal Server Error while unlocking, about 1 run in 2 at the time, before any photo UI existed. First check whether it still happens; if it does, find the cause.

## Poses: what's next

**Status:** planned, after poses (built 2026-10-23; see considerations.md).

- **Stepping through a sequence**: a plan's poses one after another, with
  the one before shown faintly behind.
- **A second figure** (the top), and **props** such as bamboo.
- **Ropes along the body**: a rope now runs smoothly between the points
  tapped, and can cut through the body between two far-apart points; it
  could follow the surface instead.
- **Animated transitions** between a sequence's poses.
- **Hips that follow the legs**: a hip bent past about 100° rolling the
  pelvis back, and a leg spread wide hiking it, as on a real body (the
  Hips sliders already pivot the pelvis under a steady trunk).
- **Limbs with weight**: unsupported limbs and the head drooping, perhaps
  as part of "Let it hang" (the body hanging as one piece is built:
  considerations.md), and partial suspensions, where the floor carries
  part of the body.
- **Rope presets** (a chest harness, hip harness, futomomo, cuffs, and my
  own saved), a Wrap tool, and moving a placed point.
- **Nerves on the body** (6–10, for rope safety: radial, ulnar, median,
  axillary, brachial plexus, common fibular, lateral femoral cutaneous,
  femoral, sciatic, saphenous), taken from Z-Anatomy (CC BY-SA 4.0,
  credited), shown or hidden over the body and moving with it. They'd be
  fitted into Anny's body at each of the 36 corners as the skin is
  (`scripts/figure/`), so they follow every slider. They'd follow the bones
  rather than the skin, so a heavier body doesn't carry them outward.
  Labelled approximate.
- **Ropes on the skin as the shape changes**: a rope point is kept on its
  bone, so a much heavier or thinner body can leave a rope inside or off
  the skin. Points could be kept on the surface instead (a triangle and
  where on it).
- **A smaller body file**: fewer components, or a lighter mesh, if 2 MB is
  slow on phones.

## A click-through tutorial

The menu's Tutorial (nav.js) shows the welcome message for now. In its
place: a step-by-step tour of the app, opened from the same row.

## Saving while offline (format 2)

The format 2 cache lets the journal be read offline, but a save still goes
straight to the server (as before), and fails without a connection. A
queue of saves made offline, sent when back online, would need its own
rules for edits another device made meanwhile (cache/sync-rules.js's
mergeEdit is where they'd start) and for showing what isn't saved yet.

## Ideas, not yet committed

<!-- - Plans: “Type” becomes “Plan type”, and difficulty is picked with the rope-hank icons.
- Default location first: the default location stays at the top of the Locations list, the way “Me” does on People.
- Delete account wording: “THIS CAN’T BE UNDONE.” on its own line, in bold capitals.
- Contact info when signed out: a “Trouble signing in? Email …” line at the bottom of the sign-in and Unlock screens. -->


<!-- - Welcome on new accounts: add an 'intro' dialog after sign-up with a “Don’t show this again” checkbox that’s remembered on your account. the message should be what is saved on WELCOME.md. I also want to force the welcome dialog to prompt all currently existing accounts so they will see it at their next login after release.
- Bug and feedback button: a menu item that opens a short form for sending a bug report or idea, with a warning not to include journal details. add it above 'what's new' with an icon that looks like a message bubble with a little bug badge overlaying the bottom left corner
- at the top of the plans view, replace the current 'add a plan' form with a button that opens a dialog with a form to add a new plan (similar to how the tie form works now) There should be a small card with the label "Add a Plan" and a yellow + button just like the add a tie button in the top nav. 
- below that, add a search form that filters the plans list below it. The search form should look exactly like the Ties one, except it should have a Plan Type drop down instead of People, a Tie Type drop down instead of Locations, and no date filter, keeping the Tags filter. -->

<!-- - Tie type required: the blank type shows “–”, existing ties without one get filled in with 'hashira', and new ties must have a type selected.
- on the plans table and form, add 'Tie Type', using the same values as the tie type used for Ties,
- rename the 'type' column in the plans table to 'Plan Type'
- Photo album link: an optional link to a Google or Apple Photos album on ties and plans.
- add tags to plans, same functionality as on Ties
- add an app version number, track release notes that can be displayed to users. put version number on the app at the bottom of sign in screen and the bottom of menu sidebar -->


- **Thumbnails on tie cards.** The Ties list shows a photo count only, because thumbnails would mean up to 100 decrypts a page.
- **Searching captions** with the keyword search (they're sealed bound to their photo, so the search index would need to fetch and open them).
- Optional time on ties: an “Add a time” checkbox on the tie form, stored as a separate time field rather than turning the date into a timestamp.

<!-- - Educators on People: an “educator” checkbox on the People form decides who shows up in a workshop’s educators list. -->
<!-- - People’s socials and city: on form add optional + button next to a label "Social & Scene Names". clicking the button adds a row with 2 drop downs (similar to people & roles on ties): one drop down for 'platform' with values: scene name, fetlife, instagram, x/twitter, bluesky, other. another drop down for alias, as an open text box -->
<!-- - on people form, add an optional field for “Based in” with an example muted value on null that says 'e.g. Seattle, WA'. -->
<!-- - when searching for People in the Ties or People view, also search the alias field and display the Person's name + (alias) in the search result drop down (e.g. "J (therawkitty)") -->
<!-- - if a person is marked an educator, add a little yellow outlined graduation cap icon in the top right of their card -->
<!-- - remove the edit, archive, and delete buttons from the card -->
<!-- - make the person's name be clickable and open the edit person details dialog -->
<!-- - at the bottom of the dialog have close, archive, and delete buttons -->
<!-- - on the card in the list, next to the persons name, show their pronouns if entered -->
<!-- - to the right of their pronouns, show the default role if entered. give it a similar look to selected tie tags where its outlined with yellow -->
<!-- - on the card in the list, beneath the persons name, have the second row display 'based in ' + the value entered, if it is present. have the next row display 'aka ' followed by any entered socials, starting with scene name.  -->

<!-- - on people add/edit form: make pronouns and alias text fields not capitalize the first letter
- on people add/edit form: move the educator checkbox to the top right corner, in line with the Name label but right-aligned. move the 'this is me' checkbox on the default Me record to the top right of the form in line with the title "Add/Edit Person'
- on people add/edit form, make the text in the platform drop down (scene name, instragram, etc) smaller so 'scene name' fits in the box better after selection
- on people view, move the + button that brings up the new person dialog be the first thing on its card, left aligned, with the 'Add a Person' label just after it.
- on locations view, make it similar to the People view, where there's a small card at the top for 'Add a Location' with a + button on the left side that opens the new location form in a new dialog. Remove the add location form from the view and replace it with a 'search locations' box that filters the results in the list below.
- on locations add/edit form, above the coordinates and below the google maps link, can you add a text box for City and a text box for State/Province. then add a text box on the left side of row with Lat & Long for Country. Make the lat and long fields smaller, so they show the first 5 digits or so (but still hold the minimum needed for coordinates).  -->

- add a function that extracts the city, state/province, and country (as well as the coordinates) from the maps link 
- can you make it so that users can paste a full address instead of a maps link and also have those fields extracted? 

<!-- - Education tracker: log the workshops you take or teach (date, location, people and roles, educators, notes, ratings, tags), with a searchable list and a tag-filtered “resume” view. -->

<!-- - Map of ties: a map with a marker for each location that has coordinates, drawn without sending your locations to an outside map service. -->

<!-- - Drag photos into order: rearrange photos on ties and plans by dragging, by finger or mouse, keeping the Move earlier/later buttons.
- Videos: encrypted video clips on ties and plans, with their location and device details removed. -->

<!-- - Final logo and icons: swap the placeholder images for the final logo, favicon and home-screen icons. -->

- on model poser multiple hardpoints at once

<!-- - collapse the search forms to just the text box keyword search, and advanced >. expanding advanced shows the rest of the search form -->

<!-- - update the rope hank icon -->

<!-- - update the logo -->

- educators sharing handouts and other materials: they can generate a qr code that shares a workshop entry with attachments. or allows attendees to share their nots and append to each others workshop entry

- allow ties to be linked to workshops, or to be created from the workshop (and automatically linked). both entries should show the link to the other and allow clicking to view. 


Build plan
Each phase leaves the app working and shippable. The times are rough estimates in working days, including tests and the walkthrough.

#	Phase	Migration	Days	Why it's its own phase
<!-- 1	Two notes fields on people	0021 people.about	~1	Small, and profile invites need it
2	Shares on the server (no pages)	0022 shares, share_claims	2–3	The security-critical part, worth reviewing without page code around it
3	Profile invites + QR + /open + merge dialog	none	2–3	Smallest piece people can use; needs the QR library -->
<!-- 4	Account ids and connections, link icon	0023 connections + triggers	2	Database-enforced rules, disclosures, PRIVACY.md -->
<!-- 5	Ties, plans, workshops (drawings and poses included)	none	3	Reuses import; "Which of these is you?" -->
<!-- 6	Photos and videos in shares	none	2	R2, sizes and video carry their own risk -->
7	Passphrase and verification code	none	2–3	Both only change creating and opening a share
8	View-only	none	2–3	Separate path: shown but never added to the journal

- sick flip simulator 

- update people and location search: advanced. let keywords look in notes? 


