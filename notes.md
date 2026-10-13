Sign-in page (/signin):
"Sign in with a passkey", with no username, since the browser offers your passkeys
"Create an account": needs an invite code, the 18+ box and the privacy-policy box
"Use a recovery code": signs you in for 15 minutes, only to add a passkey. You then get a new recovery code, shown once, and the dialog won't close until you tick "I've saved it".
Account page: the person icon next to the sun opens it.
Add, rename and remove passkeys; you can't remove your last one.
See where you're signed in, sign out one session or all the others, make a new recovery code, and sign out.
Adding or removing a passkey or making a new code asks you to confirm with your passkey if you signed in more than 10 minutes ago, so a stolen session can't take over the account.
Behind the scenes:
Only hashes of session tokens, invite codes and recovery secrets are stored. Your recovery code never leaves your browser.
Writes from other sites are refused, and sign-in is limited to 20 tries a minute per IP address.
Sessions last 30 days, or end after 7 days unused.
Every passkey records whether it can make encryption keys (the PRF extension), ready for step 4.


tietally.app
workingend.app
tie.date

When you do switch domains, the changes are:

Point the domain at the Worker in the Cloudflare dashboard.
Change RP_ID and ORIGIN in wrangler.jsonc to the new domain.
Turn off the workers.dev address ("workers_dev": false), so the app only lives on one domain.
Revisit HSTS includeSubDomains, as noted in considerations.md.
Deploy, then sign in on the new domain with your recovery code, add your passkeys, and remove the old ones on the account page.