# git commands
Commit your work on it first (git add -A && git commit -m "…"), then:

Merge locally and push:
git checkout main
git pull                      # get main up to date
git merge ik-time             # bring the branch in
git push                      # send main to GitHub
git branch -d ik-time         # delete the local branch
git push origin --delete ik-time   # delete it on GitHub (only if you pushed it there)
git branch -d refuses to delete a branch that hasn't been merged, so it won't throw work away. -D forces the delete; avoid it unless you mean it.

Or through a pull request, like PR #1:
git push -u origin ik-time
gh pr create --base main --fill
gh pr merge --merge --delete-branch   # merges, then deletes the branch on GitHub and locally
git checkout main && git pull

for rebase. Commit your work on the branch first (or stash it), then:
git fetch origin
git rebase origin/main
This replays your branch's commits on top of the latest main.

If there are conflicts: fix the files git lists, then
git add <fixed files>
git rebase --continue
git rebase --abort puts everything back as it was before you started.

If the branch was already pushed to GitHub, the rebase rewrote its history, so push with:
git push --force-with-lease
--force-with-lease refuses to overwrite anything on GitHub you haven't fetched yet, so it's safer than --force.

With uncommitted changes you'd rather not commit yet, add --autostash:
git rebase --autostash origin/main
It sets them aside, rebases, and puts them back afterwards.



the walkthrough into independent chunks:

scripts/ui-smoke.mjs becomes a small runner. It takes --only people,plans or --changed, and runs everything when given neither.
scripts/ui/harness.mjs holds the shared parts: starting wrangler and Chrome, run, go, check, the page helpers, and a new freshAccount() that signs up with a new invite and virtual passkey.
scripts/ui/seed.mjs creates people, locations, plans and ties through the API, sealing notes in the page as the walkthrough already does.
scripts/ui/chunks/*.mjs are the chunks:
Chunk	Sections
basics	headers, icons, sign-up, welcome tour, single-page app
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

Run npm run deploy:prod.
Run node scripts/release-cleanup.mjs --dry-run --remote, then run it again without --dry-run.