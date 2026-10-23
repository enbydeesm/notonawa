the walkthrough into independent chunks:

scripts/ui-smoke.mjs becomes a small runner. It takes --only people,plans or --changed, and runs everything when given neither.
scripts/ui/harness.mjs holds the shared parts: starting wrangler and Chrome, run, go, check, the page helpers, and a new freshAccount() that signs up with a new invite and virtual passkey.
scripts/ui/seed.mjs creates people, locations, plans and ties through the API, sealing notes in the page as the walkthrough already does.
scripts/ui/chunks/*.mjs are the chunks:
Chunk	Sections
basics	headers, icons, sign-up, welcome, single-page app
lock	locking and unlocking
settings	menu and Settings
people	People
locations	Locations
plans	Plans, plus linked ties and search
ties	logging, plus + on other tabs
search	searching and paging
notes	encrypted notes
photos	Photos
deleting	Deleting
account	Account, signing in, recovery, notices and policy, deleting the account
data	Your data
insights	Calendar and Analytics

 In CLAUDE.md, the commands section and the testing rule would change to: run npm run check:changed (with --ui when pages change) after each change, and the full npm run check plus npm run test:ui before a release.

 What you run now:

npm run check:changed: after every change. Lint and type check always run in full (about 1s together), then only the tests for what changed since the last commit, including new files.
npm run check:changed -- --ui: the same, plus the walkthrough chunks for those changes. Use it when pages change.
npm run check:changed -- people plans: checks named areas, whatever changed. -- --list shows what would run without running it.
npm run test:ui -- --only people,plans: chosen walkthrough chunks only.
npm run check and npm run test:ui still run everything, before a release.

