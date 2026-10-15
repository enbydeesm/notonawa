# NotoNawa Privacy Policy

> **DRAFT: ** This policy describes how NotoNawa will
> handle data once the work planned in the privacy and accounts
> roadmap is finished. Some of it isn't true of the app today, 
> and some [information] is yet to be filled in.

**Last updated:** [date of publication]

## The short version

- NotoNawa is a private journal for rope practice. It is built so that
  **the most sensitive parts, your notes and your photos, are encrypted on
  your device before they leave it.** We can't read them, and neither can
  anyone who gets hold of our servers.
- **You sign in with a passkey.** There are no passwords, and we don't ask for
  your legal name or a sign-in through Google, Apple or anyone else. An email
  address is optional, only for account recovery, and we keep only a
  scrambled copy that we can't read.
- **Keep a second passkey and your recovery code.** If you lose them all, we
  can't guarantee to get you back in, and your encrypted notes and photos
  can't be recovered by anyone.
- **No ads, no analytics, no tracking, no selling or sharing your data.** The
  app loads no scripts or fonts from other companies.
- Some information has to stay readable by our server so the app can sort and
  filter it, such as names, titles, dates and ratings. The full list is in
  [What we can and can't read](#what-we-can-and-cant-read).
- You can export everything, import entries from a file, or delete your
  account and everything in it, at any time.

## Who we are

NotoNawa is run by Mx_Piggie ("we", "us"), Seattle, WA, USA.
Contact us about privacy at contact@notonawa.app.

NotoNawa is for adults only. You must be 18 or older to create an
account.

## What we collect

### Your account

- **A passkey.** When you create a passkey, your device keeps the secret part.
  We store only the public part, an ID for it, the name you give it (e.g.
  "My phone") and when it was created and last used. A passkey can't be
  used to identify you outside NotoNawa.
- **Your sessions.** When you sign in we give your browser a random session
  token in a cookie. We store a scrambled (hashed) copy of it, which passkey
  you signed in with, when the session started, and when it was last used
  (to the hour), so you can see and end your sessions. We don't store your IP
  address or a description of your device.
- **Your recovery code, scrambled.** The code is made on your device and we
  never receive it. We store only a scrambled (hashed) value derived from it,
  which can't be turned back into the code.
- **Your recovery email, scrambled, if you add one.** It's optional. Your
  device scrambles the address (a slow, salted hash) before sending it, and
  we store only that, so we can't read the address or send you email. We use
  it for one thing: checking that someone asking us to recover an account is
  its owner (see [Our own access](#our-own-access)).
- **Your agreement.** When you confirmed you're 18 or older and agreed to
  this policy, and which version of it you agreed to.
- **Your invite.** Accounts are by invite for now. We record that an invite
  was used, and by which account, but nothing about who it was for.
- **Your encryption keys, locked.** Your notes and photos are encrypted with a
  key that only exists unlocked on your own device. We store copies of it that
  are themselves locked by your passkeys and by your recovery code, so we
  can't use them, and which of your passkeys can unlock it. See
  [How encryption works](#how-encryption-works).

We don't collect your phone number, real name, contacts or location, or your
email address unless you add a recovery email.

### Your journal

What you choose to write in the app: ties, plans, people, locations, tags
and photos. Some of this is encrypted so only you can read it, and some
isn't (see the next section).

### Technical information

To deliver the app and protect it from attacks, our hosting provider,
Cloudflare, briefly processes standard connection information such as your IP
address, and counts sign-in attempts per IP address for a minute at a time to
stop people guessing. We don't store it, and we don't keep request logs. We don't use
analytics, advertising or tracking tools of any kind.

## What we can and can't read

**Encrypted on your device. Only you can read it:**

- notes on ties, and each participant's notes on a tie
- notes on people, and their profile notes (injuries, modifications, likes,
  dislikes and limits)
- notes on locations
- plan descriptions and notes
- photos, their thumbnails, and any captions

**Readable by our server, so the app can list, sort and filter them:**

- tie titles, dates, types, durations and ratings; who took part and in what role;
  which plans and location were used
- people's names, pronouns and usual roles
- location names, map links and coordinates
- plan titles, stages, difficulty and versions
- tags
- when things were created, changed or archived, and how they link together
- for each photo: which tie or plan it's on, its place in their order, its
  size, whether it's a JPEG or WebP, and when it was added (not what it shows)

This second list is still private to your account: the app never shows it to
anyone else, and we don't look at it (see [Our own access](#our-own-access)).
But because it isn't encrypted on your device, it could be disclosed if our
systems were breached or if we were legally required to hand it over. **Keep
anything you consider truly sensitive, such as full names, addresses or
identifying details, in the notes fields, which are encrypted.** We plan to
encrypt more of these fields over time.

## How encryption works

- When you create your account, your device makes a random encryption key.
  Your notes and photos are encrypted with it (AES-256-GCM) on your device,
  before anything is sent to us.
- That key is locked using a secret your passkey produces (the WebAuthn "PRF"
  feature), which never leaves your device: it's never sent to us. On its
  way to the walled-off part of the app that holds your key (see below), it
  passes through the app's page for a moment. If your passkey doesn't
  support this, you unlock with your recovery code instead.
- A new passkey can only unlock your journal once you've confirmed it's you
  with a passkey or recovery code that already can. A passkey that couldn't
  unlock before (for example one added before encryption) can after you've
  unlocked once with your recovery code.
- You get a **recovery code** when you create your account. It can also unlock
  your key. We show it once and don't keep a copy.
- **If you lose every passkey and your recovery code, your encrypted notes and
  photos can't be recovered, by you or by us.** That is the cost of us not
  being able to read them. **We strongly recommend keeping a second passkey
  (on another device, or a hardware security key) and keeping your recovery
  code somewhere safe**, such as a password manager or on paper.

## How the app protects your data on your device

- **Nothing decrypted is saved on your device.** Your notes and photos are
  decrypted in your browser's memory only while the app is open and
  unlocked, and are never written to the browser's storage, its cache or its
  form history. Photos on screen are let go of when the app locks. Our pages
  and data are sent with instructions not to be cached. The browser's
  spellcheck is turned off in the app, because some browsers can send the
  text being checked to their maker. The one exception is an export, which
  saves a file wherever you choose (see
  [Your rights and choices](#your-rights-and-choices)).
- **The app locks itself.** It forgets your key and everything it decrypted
  after [15] minutes without use, after [5] minutes in the background, when
  you sign out, and when you close or reload the tab. You unlock again with
  your passkey.
- **Decryption happens in a separate, walled-off part of the browser** (a Web
  Worker), so the rest of the page only ever sees the results it is
  displaying, and your key can't be copied out of the page. This can't
  protect what is shown while the app is unlocked from other code running in
  the page itself, such as a browser extension you've allowed on this site.
  That's why the app is so strict about which code may run in it (below).
- **Searching happens on your device.** What you type in the search box is
  never sent to us and never appears in the page address, so it doesn't end
  up in your browser history either. Your notes are decrypted and searched
  on your device; to show the results a page at a time, the app tells us
  which entries matched, but not what you searched for.
- **Only our own code runs in the app.** Strict browser security rules
  (Content Security Policy and Trusted Types) block scripts from anywhere
  else, and the app can't be embedded in other websites.

Browsers have limits that no app can fully overcome. Your operating system
may copy memory to disk (for example when your computer sleeps or hibernates),
and browser extensions you install can see what's on the page. Using
full-disk encryption on your devices, and being careful which extensions you
allow on this site, protects you further.

## Photos

- Before a photo leaves your device, the app removes its hidden metadata,
  including GPS location, camera details and timestamps, by redrawing it as
  a new image. It's also made smaller (at most 2048 pixels on its longest
  side) to save space, and a small thumbnail is made from it. Your original
  file is never uploaded.
- The photo, its thumbnail and its caption are then encrypted on your
  device and stored in a private storage area that isn't reachable from the
  internet. Photos are only ever handed back to your own signed-in account,
  and only your device can decrypt them.
- Each account can store up to [1 GB] of photos, and up to [30] on each tie
  or plan.
- We never scan, analyse, tag or share your photos, and no other company
  processes them.
- **Only store photos of people who have agreed to it.** You are responsible
  for having their consent.

## Information about other people

Your journal may hold information about the people you tie with. Please only
record what they would be comfortable with, and remove it if they ask.
Entries about someone stay in your account. If that person also uses Rope
Journal, they can't see your entries, and we don't tell them you've written
about them.

## Where your data is stored

NotoNawa runs on Cloudflare (Workers, D1 database and R2 storage), which is
our only service provider with access to stored data. We ask Cloudflare to
store photos in North America [and the database in enam]; Cloudflare
doesn't guarantee where data is kept, and its network may handle it in
other countries. Everything is
encrypted at rest by Cloudflare, in addition to our own encryption of your
notes and photos.

When you paste a short Google Maps link (maps.app.goo.gl) into a location, our
server asks Google where the link points, to fill in its coordinates. Google
sees that request coming from our server, not from you, and it carries only
the link. Full Google Maps links are read on our server without contacting
Google.

## Cookies

We use one cookie: your session cookie. It's needed to keep you signed in. It
can't be read by scripts, is only sent over secure connections and only to
NotoNawa, and expires after [30] days, or sooner after [7] days without
use. We use no other cookies, local storage for tracking, or similar
technologies. If you switch between light and dark mode, the app remembers
that choice in your browser's local storage (just the word "light" or
"dark"); it never leaves your device.

## How long we keep your data

- **While you have an account**, we keep what you've stored until you delete
  it.
- **When you delete something**, it's removed from our live database straight
  away. Deleted photos are removed from storage straight away (deleting a tie
  or plan deletes its photos too). If that's ever interrupted, a daily
  clean-up removes what was left within a day or two.
- **When you delete your account**, everything in it (journal, photos,
  passkeys, sessions, recovery email and locked keys) is deleted straight away. Your device
  or password manager may still list your passkey for NotoNawa; where the
  browser supports it, the app tells it the passkey no longer works.
- **Backups.** Our database provider keeps a rolling history for disaster
  recovery, so deleted data can remain there for up to 7 days before it
  disappears permanently. Our own backups are encrypted and kept for no more
  than 7 days. Photos aren't in either: once deleted, they're gone. We would only restore from these to recover from a failure,
  never to bring back something you deleted unless you ask us to.
- **Signed-out sessions** are deleted when you sign out, and expired sessions
  are cleared every day.

## Your rights and choices

Wherever you live, you can:

- **Export** all your data from the app at any time, including your notes and
  photos, decrypted on your device into a file only you hold (a .zip when
  you have photos). It contains your
  whole journal, plus when you created your account and agreed to this
  policy, your passkeys' names and dates, and whether you've set a recovery
  email (not the address, which we don't have). The file isn't encrypted, so
  keep it somewhere safe.
- **Import** entries from an export, or ties from a spreadsheet (a CSV file).
  The file is read in your browser, and only the entries in it are sent to
  us, just as if you'd typed them in. Photos in an export are prepared and
  encrypted on your device first, as when you add one.
- **Correct** anything by editing it in the app.
- **Delete** individual entries, or your whole account, from the app.
- **End sessions** on any device, or remove passkeys, from your account
  settings.
- **Contact us** at contact@notonawa.app with any privacy question or request. We
  will respond within 10 days.

Depending on where you live (for example the EU, UK or California), you may
have further rights under laws such as the GDPR or CCPA, including the right
to complain to your data protection authority.

**Legal basis (EU/UK users).** We process your journal because you ask us to
in order to provide the service. Information about your or other people's sex
lives is special-category data, which we process only with your explicit
consent, given when you create your account. You can withdraw consent at any
time by deleting your data or your account.

## Our own access

The only person who can access NotoNawa's systems is Mx_Piggie,
using an account protected by a hardware security key. We don't browse users'
data. We would look at the readable parts of an account only when you ask us
to (for example to help with a problem), or when the law requires it.
Encrypted notes and photos can't be read by us under any circumstances.

**Keep a second passkey and your recovery code: we can't guarantee that we
can restore your account or your data if you lose them all.** We may be able
to help you sign in again, but only if you added a recovery email:

- Contact us from that address. We'll send a one-time code to it from our
  own mailbox, and you send it back, so we know the address is yours (an
  email that merely appears to come from an address doesn't prove it).
- We then give your account a new recovery code. We only do this when you
  ask.
- Without a recovery email we have no way to tell that an account is yours,
  so we can't help.

A new recovery code restores signing in and the parts of your journal we can
read. It never brings back your encrypted notes and photos, which still need
one of your own passkeys or your own earlier recovery code. (If you do unlock
with one of those, the app gives you a new recovery code straight away, so
the old one stops working.) If you have neither, you can start a new
encryption key, but what the old key encrypted can't be read again.

## Legal requests

If we receive a legally valid demand for data, we can only provide what we
can read (see [What we can and can't read](#what-we-can-and-cant-read)). We
cannot decrypt your notes or photos. Unless the law forbids it, we will tell
you about the request before handing anything over.

## Security incidents

If a breach affects your data, we will tell you through the app as quickly as
we can (we can't email you: we only hold a scrambled copy of any recovery
email), and notify regulators
where the law requires.

## What we don't do

- sell, rent or share your data
- show ads or use your data for advertising
- use analytics, tracking pixels or third-party scripts
- train AI models on your data or send it to AI services
- let anyone else see your journal

## Changes to this policy

If we change this policy, we will update the date at the top and tell you in
the app before the change takes effect. If a change would reduce your privacy,
we will ask for your agreement first.

## Contact

Mx_Piggie · contact@notonawa.app
