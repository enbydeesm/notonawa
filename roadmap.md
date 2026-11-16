# Roadmap

Planned features and known gaps that still need building. Once something
is built, move what we decided into [considerations.md](considerations.md)
(with the reasons) and take it off this list. Decisions that need no code
change, and "revisit if…" notes, stay in considerations.md.


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
- **Animated transitions** between a sequence's poses.
- **Limbs with weight**: unsupported limbs and the head drooping, perhaps
  as part of "Dangle" (the body hanging as one piece is built:
  considerations.md), and partial suspensions, where the floor carries
  part of the body.
- **Rope presets** (a chest harness, hip harness, futomomo, cuffs, and my
  own saved). After the encryption branch merges: it changes how presets
  are stored. (The Wrap tool and moving a placed point are built.)
- **Nerves on the body** (6–10, for rope safety: radial, ulnar, median,
  axillary, brachial plexus, common fibular, lateral femoral cutaneous,
  femoral, sciatic, saphenous), taken from Z-Anatomy (CC BY-SA 4.0,
  credited), shown or hidden over the body and moving with it. They'd be
  fitted into Anny's body at each of the 36 corners as the skin is
  (`scripts/figure/`), so they follow every slider. They'd follow the bones
  rather than the skin, so a heavier body doesn't carry them outward.
  Labelled approximate.
- **A smaller body file**: fewer components, or a lighter mesh, if 2 MB is
  slow on phones.

## Saving while offline (format 2)

The format 2 cache lets the journal be read offline, but a save still goes
straight to the server (as before), and fails without a connection. A
queue of saves made offline, sent when back online, would need its own
rules for edits another device made meanwhile (cache/sync-rules.js's
mergeEdit is where they'd start) and for showing what isn't saved yet.

## Covers (format 2)

Choose one of a tie's, plan's or workshop's visuals as its cover, shown on
its card. The records already have the field (`cover`, a visual's id;
records/visuals.js drops it when that visual goes), and format v3 files
have room for a cover part; what's left is choosing one and showing it.

## Pose pictures (format 2)

Keep a picture of each pose as a file (the pose record's reserved
`picture`, a file id), drawn when it's saved, so lists and cards show it
without loading the poser's 3D body to draw it.

## Importing photos from an album

Add photos from an album (for example the one a tie's album link points
to) to its Visuals in one go, each prepared and sealed on the device as a
photo picked from the device is. The open question is reading an album
without our server seeing what's in it.

## A device key, for passkeys that can't unlock

A passkey without PRF signs in but can't unlock the journal, so its
owner types the recovery code on each unlock. A key kept on the device
(locking a copy of the data key, never sent to the server) would let it
unlock after the first time. Deferred: every production passkey supports
PRF (checked November 13, 2026).

## The browser's own X-Wing

Identity keys use a library for X-Wing (vendor/hpke.js, behind
crypto/identity.js alone). Once every major browser has X-Wing in
WebCrypto (Chrome has it from 154), switch to it there: the format doesn't
change.

## Ideas, not yet committed
- **Thumbnails on tie cards.** The Ties list shows a photo count only, because thumbnails would mean up to 100 decrypts a page.

- add a function that extracts the city, state/province, and country (as well as the coordinates) from the maps link 
- can you make it so that users can paste a full address instead of a maps link and also have those fields extracted? 

- on model poser multiple hardpoints at once

- educators sharing handouts and other materials: they can generate a qr code that shares a workshop entry with attachments. or allows attendees to share their nots and append to each others workshop entry

- update people and location search: advanced. let keywords look in notes? 


