# nōtonawa Privacy Policy

**Last updated:** November 18, 2026

## The short version

- nōtonawa is a private journal for rope practice. **Everything you put in
  your journal is encrypted on your device before it leaves it**: your ties,
  plans, workshops, people, locations, tags, notes, photos, videos, drawings
  and poses. We can't read any of it, and neither can anyone who gets hold of
  our servers.
- **You sign in with a passkey.** There are no passwords, and we don't ask for
  your name. A recovery email is optional, and we keep only a scrambled copy
  we can't read.
- **Keep a second passkey and your recovery code.** If you lose them all, your
  journal can't be recovered, by you or by us.
- **No ads, no tracking, no third-party analytics, and we never sell or share
  your data.** We only count basic totals, such as how many accounts are
  active (see [Usage statistics](#usage-statistics)).
- **You can share things with other people**, by link or through a
  connection between your accounts. What you share is encrypted too, and
  **our server keeps no record of who is connected to whom.**
- You can export everything, or delete your account, at any time.

## Who we are

nōtonawa is run by Juice aka Mx_Piggie ("we", "us") in Seattle, WA, USA.
Contact us about privacy, give feedback, or tell us how frickin cool we are at contact@notonawa.app.

## What we store

### Your journal, encrypted

Each entry in your journal (a tie, plan, workshop, person, location, tag,
drawing, pose, preset, your settings for role names and the poser's body, and
each connection) is encrypted on your device and stored as a sealed record.
Photos and videos are encrypted on your device and stored as sealed files.

All our server can see of them is:

- **what kind each record is** (for example "tie" or "person"), so it can
  tell how many of each you have;
- **roughly how big each one is** (records are padded, so their size says
  little), which counts toward your 1 GB;
- **the order your changes were made in**, so your other devices can catch up;
- **for each photo or video**, that it's a photo or a video, its size and when
  it was uploaded. Nothing on our server says which entry it belongs to.

When you delete an entry, we keep a small marker (its random id and its kind,
nothing of what it was) so your other devices know to remove it too.

### Your account

- **Your passkeys**: the public part only (your device keeps the secret part),
  with the name you gave each one and when it was added and last used.
- **Your sessions**: a scrambled copy of each sign-in's token, which passkey
  was used, and when it started and was last used. We don't store your IP
  address or a description of your device.
- **Your recovery code, scrambled.** The code is made on your device and we
  never receive it, only a scrambled value made from it.
- **Your recovery email, scrambled, if you add one.** Your device scrambles it
  before sending it, so we can't read it or email you. We use it only to check
  that someone asking us to recover an account is its owner.
- **Your encryption key, locked**, so we can't use it (see
  [How encryption works](#how-encryption-works)), and a public key other
  accounts use to connect with you.
- **A few settings**: light or dark mode, the last release notes you saw, and
  whether you've hidden the welcome. They're readable by our server.
- **Your agreement** to this policy, which version, and when; and that you
  joined with an invite (not who it was from).
- **Messages from us** you've dismissed, and any meant only for you.
- **Bug reports and ideas you send us**, as you wrote them. **These aren't
  encrypted** (we need to read them), so please leave journal details out.

### Technical information

Our hosting provider, Cloudflare, briefly handles standard connection
information such as your IP address to deliver the app, and counts requests
per IP address for a minute at a time to stop abuse. We don't store it and we
keep no request logs.

## Usage statistics

To understand how nōtonawa is used and which features matter, we count a few
things from what we already store: how many accounts there are, how many have
been used recently (from when their passkeys and sessions were last used),
how many entries of each kind accounts have (for example ties, plans or
poses), and how much storage they use. We look at these as totals and spreads
across accounts, not at what any one person is doing, and we never combine
them with information from outside nōtonawa. We can't see what's in any
entry, only its kind and size.

## How encryption works

- When you create your account, your device makes a random encryption key.
  Every entry gets a key of its own, locked with yours, and is encrypted with
  it (AES-256-GCM) on your device.
- Your key is locked with a secret your passkey produces, which never leaves
  your device, and with your recovery code. We store only these locked
  copies.
- **Signing in on a new device with one you're signed in on**: the new
  device shows a code and makes a one-time lock for it; your other device
  scans the code, checks the lock is the new device's, and, once you've
  confirmed with your passkey, sends your key locked for the new device
  only. We pass it on and can't open it. The request lasts 5 minutes and
  is deleted once the new device picks it up or it's cancelled; any left
  over are cleared daily.
- **If you lose every passkey and your recovery code, your journal can't be
  recovered, by you or by us.** That's the cost of us not being able to read
  it. Keep a second passkey (on another device, or a hardware security key)
  and keep your recovery code somewhere safe.

## On your device

- **Nothing decrypted is stored on your device.** Your device keeps a copy of
  your journal still sealed, so the app opens quickly, and decrypts it in
  memory only while the app is unlocked. Signing out, or deleting your
  account, removes that copy.
- **Searching and sorting happen on your device.** What you search for is
  never sent to us.
- **The app locks itself** after 15 minutes without use, after 5 minutes in
  the background, and when you close or reload it, forgetting your key and
  everything it decrypted.
- **Decryption happens in a walled-off part of the browser**, and only our own
  code can run in the app.

Your operating system may copy memory to disk, and browser extensions you
allow on this site can see what's on screen, so use full-disk encryption and
be careful which extensions you allow.

## Photos and videos

- Before a photo or video leaves your device, the app rebuilds it as a new,
  smaller file, so none of its hidden details (GPS location, dates, the camera
  or phone it was made with) are kept. Your original is never uploaded.
- Each account can store up to 1 GB in all, with up to 30 photos and videos
  (5 of them videos) on each tie, plan or workshop.
- We never scan or analyse your photos or videos.
- **Only store photos and videos of people who have agreed to it.**

## Sharing with other people

### By link

- You can share your profile, or a copy of a tie, plan or workshop, as a link
  or QR code. You choose exactly what goes in it.
- It's encrypted on your device with a key that's only in the link, after the
  "#", which browsers never send to us. We store the encrypted copy and can't
  open it, so send the link only to the person it's for.
- We store the share's kind, its size, when it ends, how many times it can be
  and has been opened (not by whom), and its name (encrypted). It counts
  toward your 1 GB until it ends.
- It's deleted when it ends, when its last allowed use is opened, or as soon
  as you revoke it. Revoking doesn't take back what someone already added.

### Connecting accounts

- A profile invite can offer to connect your accounts, if you tick it and the
  person opening it agrees.
- **Our server keeps no record that two accounts are connected.** Each of you
  keeps the connection in your own encrypted journal. Your devices pass each
  other messages (profile updates, and things you send) through mailboxes on
  our server: a mailbox has an owner but no record of who writes to it, and
  every message is encrypted so only the two of you can read it. Messages are
  deleted once fetched, or after 90 days.
- Through a connection you can share your profile (it updates when you change
  it, with the same fields), and send a tie, plan or workshop, which is
  stored as a one-use share that ends after 30 days.
- You can each check a connection's safety number in person, to be sure no
  one is in between.
- Either of you can remove a connection at any time. It ends for both of you,
  and you can also clear the About you shared from their card.

## Information about other people

Your journal may hold information about the people you tie with. Please only
record what they would be comfortable with, and remove it if they ask. If they
also use nōtonawa, they can't see your entries, and we don't tell them you've
written about them. When you share a tie, plan or workshop, share only what
the people on it would be comfortable with.

## Where your data is stored

nōtonawa runs on Cloudflare (Workers, D1 database and R2 storage), our only
service provider with access to stored data. We ask Cloudflare to store photos
and videos in North America [and the database in enam]; its network may
handle data in other countries. Everything is also encrypted at rest by
Cloudflare.

**Notifications, if you turn them on** for a device, go through the push
service of that device's browser (Apple's for Safari, Google's for Chrome
and most others, Mozilla's for Firefox, Microsoft's for Edge on Windows).
Each one is encrypted to your device, so the push service can't read it; it
sees that a notification went to that device, and when. A connection's
notification says only that you have something new, as our server can't
tell what or who it's from.

When you paste a short Google Maps link (maps.app.goo.gl) into a location, our
server asks Google where it points, to fill in its coordinates. Google sees
our server, not you, and only the link. Full Google Maps links are read on
your device.

## Cookies and browser storage

We use one cookie, to keep you signed in. It can't be read by scripts, is sent
only to nōtonawa over secure connections, and expires after 30 days (7 without
use). Your browser also keeps the app's own code, the sealed copy of your
journal (see [On your device](#on-your-device)), and the word "light" or
"dark" so pages show the right colors before you sign in. It also notes
whether you've answered the offers to install the app and to turn on
notifications, and, once you turn them on, keeps a small background script
that only shows notifications. Nothing is used for tracking.

## How long we keep your data

- **What you store** is kept until you delete it. Deleting removes it from our
  live database and storage straight away.
- **Shares and messages** are deleted when they end, as above.
- **When you delete your account**, everything in it is deleted straight away.
- **Backups.** Our database provider keeps a rolling history for disaster
  recovery, and we back up the database every day, encrypted with a key that
  only Mx_Piggie holds, away from our servers. Both are gone after 30 days.
  Photos and videos aren't backed up. We restore only to recover from a
  failure, never to bring back something you deleted unless you ask.
- **When your account was updated to full encryption**, our backups and our
  database provider's history still held the older, partly readable version
  of your journal; that copy is gone 30 days after the update.
- **Sessions** end when you sign out, and expired ones are cleared daily.
- **Notifications**: for each device you turn them on for, we keep the
  address its push service gave it, the keys notifications are encrypted
  to, and which kinds you chose. It's deleted when you turn them off on
  that device, sign out there, or delete your account, and when the push
  service says the address no longer works.
- **Requests to sign in on a new device** are deleted when used or
  cancelled, and within a day of ending if never used.

## Your rights and choices

Wherever you live, you can:

- **Export** everything, decrypted on your device into a file only you hold
  (with your photos and videos, as a .zip). The file isn't encrypted, so keep
  it somewhere safe.
- **Import** entries from an export or a spreadsheet. The file is read and
  encrypted on your device.
- **Correct or delete** anything in the app, or delete your whole account.
- **End sessions** or remove passkeys from your account settings.
- **Contact us** at contact@notonawa.app. We will respond within 10 days.

Depending on where you live (for example the EU, UK or California), you may
have further rights under laws such as the GDPR or CCPA, including the right
to complain to your data protection authority.

**Legal basis (EU/UK users).** We store your journal because you ask us to in
order to provide the service. Information about your or other people's sex
lives is special-category data, which we process only with your explicit
consent, given when you create your account. You can withdraw it at any time
by deleting your data or your account. We count usage statistics because we
have a legitimate interest in improving the service; they're totals, worked
out from data we already hold for running your account.

## Our own access

The only person who can access nōtonawa's systems is Mx_Piggie, using an
account protected by a hardware security key. We don't browse accounts, and we
can't read your journal under any circumstances.

**We can't restore your journal if you lose every passkey and your recovery
code.** If you added a recovery email, we can help you sign in again: contact
us from that address, we'll send a one-time code to it, and when you send it
back we'll give your account a new recovery code. That restores signing in
only. Your journal still needs one of your own passkeys or your earlier
recovery code; without either, you can start again, but the old journal can't
be read.

## Legal requests

If we receive a legally valid demand for data, we can only provide what we
store (see [What we store](#what-we-store)), and we can't decrypt your
journal. Unless the law forbids it, we will tell you in the app before handing
anything over.

## Security incidents

If a breach affects your data, we will tell you in the app as quickly as we
can, and notify regulators where the law requires.

## What we don't do

- sell, rent or share your data
- show ads or use your data for advertising
- track how you use the app: no analytics or session-recording tools,
  tracking pixels, third-party scripts or request logs (beyond the totals in
  [Usage statistics](#usage-statistics))
- train AI models on your data or send it to AI services
- let anyone else see your journal, except what you choose to share

## Messages from us

We can show you messages in the app, for example about a change to this
policy or a problem with the service. They're written by us as plain text. We
record which ones you've dismissed, so they don't come back. Some may also
come as a notification, on devices where you've turned on announcements.

## Changes to this policy

If we change this policy, we will update the date at the top. If a change
would reduce your privacy, we will ask for your agreement in the app first.
Until you agree, nothing new can be saved to your journal, but you can still
export your data or delete your account.

## Contact

Mx_Piggie · contact@notonawa.app
