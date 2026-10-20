# What's new

The app's release notes, newest first: the "What's new" dialog shows them.
Each release is a `## YYYY.MM.DD.NNN` heading (the date it's released, and
001, 002… for each release that day), then its notes as `- ` bullets, in
plain words for the people using the app. The newest heading is the app's
version. After editing, run `node scripts/releases.mjs`.

## 2026.10.20.001

- A welcome with a quick guide to the app. It shows each time you unlock until you tick "Don't show this again".
- "Bug and feedback" in the menu: tell us about a bug or an idea from inside the app, or email us to attach a screenshot.
- Plans: tap + on "Add a Plan" to add one in a pop-up form, like logging a tie. Edit opens the same form.
- Plans can be searched by keyword, plan type, tie type and tags.
- Each plan shows how many ties it's on and their average rating, and its form lists those ties: tap one to open it.

## 2026.10.19.001

- Every tie now has a type. Ties previously logged without one are now 'hashira': change any that should be something else.
- Plans can have a tie type and tags, like ties.
- Ties and plans can link to a photo album (Google Photos, iCloud or anywhere else). The link is encrypted, like your notes.
- Plan difficulty is chosen with rope hanks, and your default location stays at the top of Locations.
- "What's new" in the menu shows these notes again.
