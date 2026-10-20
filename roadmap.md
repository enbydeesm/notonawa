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

## The + button asks what to add

**Status:** planned (2026-10-12)

The + button in the nav (every page) opens the "Log a tie"
dialog for now. Later it should first ask what to add (tie, person, location,
and maybe plan) and open that dialog. `renderNav` in `public/js/nav.js` is
where the choice goes; the person and location forms would need to move into
dialogs the way the tie form did (`public/js/tie-form.js`).

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

The column is a leftover from Cloudflare Access: migration 0003 overwrote
each email with the user's id, and new users get email = id, because SQLite
won't drop a UNIQUE column and rebuilding `users` would cascade-delete every
journal row (DROP TABLE runs an implicit DELETE). Drop it the next time
`users` has to be rebuilt anyway, children first, like migration 0002. See
"Passkey sign-in as built" in considerations.md.

## Finishing a photo import that stopped part-way through a tie

**Status:** known gap (2026-10-14).

Re-running an import gives a tie that's skipped as a duplicate (or a plan
matched by name) the file's photos only if it has none yet, so a failed
import can be finished without making copies (`import-photos.js`). But if
the import stopped part-way through one tie's photos, that tie already has
some, so running it again skips the rest. A fix could compare photo ids,
or how many photos the tie has with how many the file lists.

## UI walkthrough sometimes hangs

**Status:** to investigate (seen 2026-10-14).

`npm run test:ui` sometimes hung on a step ("took over a minute") or met an
Internal Server Error while unlocking, about 1 run in 2 at the time, before
any photo UI existed. First check whether it still happens; if it does,
find the cause.

## Ideas, not yet committed

>- Plans: “Type” becomes “Plan type”, plans get a tie type, and difficulty is picked with the rope-hank icons.
> - Default location first: the default location stays at the top of the Locations list, the way “Me” does on People.
> - Delete account wording: “THIS CAN’T BE UNDONE.” on its own line, in bold capitals.
> - Contact info when signed out: a “Trouble signing in? Email …” line at the bottom of the sign-in and Unlock screens.

- add an app version number, track release notes that can be displayed to users. put version number on the app somewhere (bottom of sign in screen, bottom of menu sidebar?)
- Welcome on new accounts: an intro dialog after sign-up with a “Don’t show this again” checkbox that’s remembered on your account.
- Bug and feedback button: a menu item that opens a short form for sending a bug report or idea, with a warning not to include journal details.
- + button asks what to add: the + button first asks whether to add a tie, person, location or plan.

- Tie type required: the blank type shows “–”, existing ties without one get filled in with 'hashira', and new ties must have a type selected.
- Optional time on ties: an “Add a time” checkbox on the tie form, stored as a separate time field rather than turning the date into a timestamp.
- Photo album link: an optional, encrypted link to a Google or Apple Photos album on ties and plans.

- **Thumbnails on tie cards.** The Ties list shows a photo count only,
  because thumbnails would mean up to 100 decrypts a page.
- **Searching captions** with the keyword search (they're sealed bound to
  their photo, so the search index would need to fetch and open them).


- Educators on People: an “educator” checkbox on the People form decides who shows up in a workshop’s educators list.
- People’s socials and city: optional platform and username rows, added with a + button and maybe found by the People search, plus a “based in” city.

- Education tracker: log the workshops you take (date, location, people and roles, educators, notes, ratings, tags), with a searchable list and a tag-filtered “resume” view.

- Map of ties: a map with a marker for each location that has coordinates, drawn without sending your locations to an outside map service.

- Drag photos into order: rearrange photos on ties and plans by dragging, by finger or mouse, keeping the Move earlier/later buttons.


- Videos: encrypted video clips on ties and plans, with their location and device details removed.
- Final logo and icons: swap the placeholder images for the final logo, favicon and home-screen icons.

## dev order: 
1. Quick polish (no database changes). These are small, low-risk and visible straight away.

Default location first in Locations
“THIS CAN’T BE UNDONE.” on its own line
Contact info on the sign-in and Unlock screens
Rope-hank icons for plan difficulty, and “Plan type” as the label
“–” for a blank tie type
Final logo and icons, whenever the files are ready

2. Ties and plans data (one migration). All of these change the ties and plans tables, so doing them together means rebuilding ties once instead of three times. It also means updating export, import and the CSV template once.

Fill in the missing tie types and make the type required (decide the “self tie” question first)
Optional time on ties
Tie type on plans
Photo album link on ties and plans


3. Photos. Dragging photos into order touches only the page. It sits next to the album link but is separate from the data work, so it’s easy to test alone.

4. People. Socials, “based in” city and the educator checkbox. These stand on their own, and the education tracker builds on them, so they come before it.

5. Getting started and support. These matter most once other people start signing up.

Welcome dialog for new accounts.
Bug and feedback form. It needs a PRIVACY.md update, so it pairs well with the welcome, which also mentions privacy.
add an app version number, track release notes that can be displayed to users. put version number on the app somewhere (bottom of sign in screen, bottom of menu sidebar?)
+ button asks what to add. It turns the person and location forms into dialogs, which the education tracker will reuse.

6. Education tracker. This is the biggest piece: new tables, a list view, the resume view, and export, import and Analytics support. Settle where it goes in the navigation first, since there are already six tabs.

7. Bigger extras.

Map: start with the simple outline map the app draws itself. Self-hosted street maps can come later if that’s too coarse.
Videos: last, because they’re the most work (removing their location and device details, large uploads, encryption in pieces) and the least urgent.