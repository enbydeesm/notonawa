# Rope Journal Privacy Policy

> **DRAFT: ** This policy describes how Rope Journal will
> handle data once the work planned in the privacy and accounts
> roadmap is finished. Some of it isn't true of the app today, 
> and some [information] is yet to be filled in.

**Last updated:** [date of publication]

## The short version

- Rope Journal is a private journal for rope practice. It is built so that
  **the most sensitive parts, your notes and your photos, are encrypted on
  your device before they leave it.** We can't read them, and neither can
  anyone who gets hold of our servers.
- **You sign in with a passkey.** There are no passwords, and we don't ask for
  your email address, your legal name, or a sign-in through Google, Apple or
  anyone else.
- **No ads, no analytics, no tracking, no selling or sharing your data.** The
  app loads no scripts or fonts from other companies.
- Some information has to stay readable by our server so the app can sort and
  filter it, such as names, titles, dates and ratings. The full list is in
  [What we can and can't read](#what-we-can-and-cant-read).
- You can export everything, import entries from a file, or delete your
  account and everything in it, at any time.

## Who we are

Rope Journal is run by [OPERATOR NAME] ("we", "us"), [LOCATION / COUNTRY].
Contact us about privacy at [CONTACT EMAIL].

Rope Journal is for adults only. You must be 18 or older to create an
account.

## What we collect

### Your account

- **A passkey.** When you create a passkey, your device keeps the secret part.
  We store only the public part, an ID for it, the name you give it (e.g.
  "My phone") and when it was created and last used. A passkey can't be
  used to identify you outside Rope Journal.
- **Your sessions.** When you sign in we give your browser a random session
  token in a cookie. We store a scrambled (hashed) copy of it, which passkey
  you signed in with, when the session started, and when it was last used
  (to the hour), so you can see and end your sessions. We don't store your IP
  address or a description of your device.
- **Your recovery code, scrambled.** The code is made on your device and we
  never receive it. We store only a scrambled (hashed) value derived from it,
  which can't be turned back into the code.
- **Your agreement.** When you confirmed you're 18 or older and agreed to
  this policy, and which version of it you agreed to.
- **Your invite.** Accounts are by invite for now. We record that an invite
  was used, and by which account, but nothing about who it was for.
- **Your encryption keys, locked.** Your notes and photos are encrypted with a
  key that only exists unlocked on your own device. We store copies of it that
  are themselves locked by your passkeys and by your recovery code, so we
  can't use them. See [How encryption works](#how-encryption-works).

We don't collect your email address, phone number, real name, contacts or
location.

### Your journal

What you choose to write in the app: ties, plans, people, locations, tags,
and (once photos are available) photos. Some of this is encrypted so only you
can read it, and some isn't (see the next section).

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

- tie titles, dates, durations and ratings; who took part and in what role;
  which plans and location were used
- people's names and pronouns
- location names, map links and coordinates
- plan titles, stages, difficulty and versions
- tags
- when things were created, changed or archived, and how they link together

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
  feature), which never leaves your device. If your passkey doesn't support
  this, you unlock with your recovery code instead.
- You get a **recovery code** when you create your account. It can also unlock
  your key. We show it once and don't keep a copy.
- **If you lose every passkey and your recovery code, your encrypted notes and
  photos can't be recovered, by you or by us.** That is the cost of us not
  being able to read them. You can add passkeys on more than one device to
  avoid this.

## How the app protects your data on your device

- **Nothing decrypted is saved on your device.** Your notes are decrypted in
  your browser's memory only while the app is open and unlocked, and are never
  written to the browser's storage, its cache or its form history. Our pages
  and data are sent with instructions not to be cached. The browser's
  spellcheck is turned off in the app, because some browsers can send the
  text being checked to their maker. The one exception is an export, which
  saves a file wherever you choose (see
  [Your rights and choices](#your-rights-and-choices)).
- **The app locks itself.** It forgets your key and everything it decrypted
  after [15] minutes without use, after [5] minutes in the background, when
  you sign out, and when you close the tab. You unlock again with your
  passkey.
- **Decryption happens in a separate, walled-off part of the browser** (a Web
  Worker), so the rest of the page only ever sees the results it is
  displaying.
- **Searching happens on your device.** What you type in the search box is
  never sent to us and never appears in the page address, so it doesn't end
  up in your browser history either.
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
  including GPS location, camera details and timestamps.
- The photo and its thumbnail are then encrypted on your device and stored
  in a private storage area that isn't reachable from the internet. Photos are
  only ever handed back to your own signed-in account, and only your device
  can decrypt them.
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

Rope Journal runs on Cloudflare (Workers, D1 database and R2 storage), which is
our only service provider with access to stored data. Data is stored
[in REGION / "in Cloudflare's network, which may include countries other than
your own"] and is encrypted at rest by Cloudflare, in addition to our own
encryption of your notes and photos.

## Cookies

We use one cookie: your session cookie. It's needed to keep you signed in. It
can't be read by scripts, is only sent over secure connections and only to
Rope Journal, and expires after [30] days, or sooner after [7] days without
use. We use no other cookies, local storage for tracking, or similar
technologies. If you switch between light and dark mode, the app remembers
that choice in your browser's local storage (just the word "light" or
"dark"); it never leaves your device.

## How long we keep your data

- **While you have an account**, we keep what you've stored until you delete
  it.
- **When you delete something**, it's removed from our live database straight
  away. Deleted photos are removed from storage straight away.
- **When you delete your account**, everything in it (journal, photos,
  passkeys, sessions and locked keys) is deleted straight away. Your device
  or password manager may still list your passkey for Rope Journal; where the
  browser supports it, the app tells it the passkey no longer works.
- **Backups.** Our database provider keeps a rolling history for disaster
  recovery, so deleted data can remain there for up to 7 days before it
  disappears permanently. Our own backups are encrypted and kept for no more
  than 7 days. We would only restore from these to recover from a failure,
  never to bring back something you deleted unless you ask us to.
- **Signed-out sessions** are deleted when you sign out, and expired sessions
  are cleared every day.

## Your rights and choices

Wherever you live, you can:

- **Export** all your data from the app at any time, including your notes and
  photos, decrypted on your device into a file only you hold. It contains your
  whole journal, plus when you created your account and agreed to this
  policy, and your passkeys' names and dates. The file isn't encrypted, so
  keep it somewhere safe.
- **Import** entries from an export, or ties from a spreadsheet (a CSV file).
  The file is read in your browser, and only the entries in it are sent to
  us, just as if you'd typed them in.
- **Correct** anything by editing it in the app.
- **Delete** individual entries, or your whole account, from the app.
- **End sessions** on any device, or remove passkeys, from your account
  settings.
- **Contact us** at [CONTACT EMAIL] with any privacy question or request. We
  will respond within [30] days.

Depending on where you live (for example the EU, UK or California), you may
have further rights under laws such as the GDPR or CCPA, including the right
to complain to your data protection authority.

**Legal basis (EU/UK users).** We process your journal because you ask us to
in order to provide the service. Information about your or other people's sex
lives is special-category data, which we process only with your explicit
consent, given when you create your account. You can withdraw consent at any
time by deleting your data or your account.

## Our own access

The only person who can access Rope Journal's systems is [OPERATOR NAME],
using an account protected by a hardware security key. We don't browse users'
data. We would look at the readable parts of an account only when you ask us
to (for example to help with a problem), or when the law requires it.
Encrypted notes and photos can't be read by us under any circumstances.

If you lose every passkey and your recovery code, you can ask us to give your
account a new recovery code so you can sign in again. We only do this when
you ask. It restores signing in, not your encrypted notes and photos, which
still need one of your own passkeys or your own recovery code.

## Legal requests

If we receive a legally valid demand for data, we can only provide what we
can read (see [What we can and can't read](#what-we-can-and-cant-read)). We
cannot decrypt your notes or photos. Unless the law forbids it, we will tell
you about the request before handing anything over.

## Security incidents

If a breach affects your data, we will tell you through the app [and by any
contact method you've given us] as quickly as we can, and notify regulators
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

[OPERATOR NAME] · [CONTACT EMAIL]
