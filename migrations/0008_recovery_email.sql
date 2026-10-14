-- Rope Journal: an optional recovery email, stored only scrambled.
--
-- The browser hashes the address (PBKDF2-SHA256, 600,000 rounds, a random
-- salt each time it's set; public/js/recovery-email.js) and sends the hash
-- and the salt. The address itself is never sent or stored, so we can't read
-- it or send email to it. It lets the operator check that someone asking to
-- recover an account is its owner (scripts/recovery-code.mjs --email).
-- Both are NULL when no recovery email is set; the app always sets or clears
-- them together.

ALTER TABLE users ADD COLUMN recovery_email_hash TEXT;  -- base64url
ALTER TABLE users ADD COLUMN recovery_email_salt TEXT;  -- base64url
