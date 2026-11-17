// The daily tidy-up, run by the cron trigger in wrangler.jsonc. Ended
// sessions and unused sign-in challenges are otherwise only removed when
// someone happens to use them, and PRIVACY.md promises they're cleared
// regularly.

import { NOW } from "./sql.js";
import { idleCutoff } from "./auth/session.js";

/**
 * Deletes sessions that have expired or sat unused too long (the same rule
 * as auth/session.js isActive), expired challenges, and expired requests to
 * sign in on a new device (link/), never picked up.
 * @param {D1Database} db
 * @param {number} [now]
 */
export async function cleanUp(db, now = Date.now()) {
  await db.batch([
    db.prepare(
      `DELETE FROM sessions
        WHERE expires_at <= ${NOW} OR (kind = 'full' AND last_used_at <= ?)`
    ).bind(idleCutoff(now)),
    db.prepare(`DELETE FROM auth_challenges WHERE expires_at <= ${NOW}`),
    db.prepare(`DELETE FROM link_requests WHERE expires_at <= ${NOW}`),
  ]);
}
