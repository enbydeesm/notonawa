// SQL snippets shared by the database modules.

// SQL for "now" as an ISO timestamp, e.g. '2026-10-11T21:51:00Z'.
// Every timestamp the app writes uses this format.
export const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";

/**
 * SQL for everything an account keeps, in bytes: its photos and videos
 * (format 1's media, format 2's files) and its shares in R2, and its sealed
 * records in D1. All count toward the 1 GB (MAX_ACCOUNT_BYTES).
 * @param {string} owner where the owner's id is bound, e.g. "?1" (never a value)
 * @returns {string}
 */
export function accountBytes(owner) {
  return `((SELECT COALESCE(SUM(bytes), 0) FROM media WHERE owner_id = ${owner})
         + (SELECT COALESCE(SUM(bytes), 0) FROM shares WHERE owner_id = ${owner})
         + (SELECT COALESCE(SUM(bytes), 0) FROM files WHERE owner_id = ${owner})
         + (SELECT COALESCE(SUM(bytes), 0) FROM records WHERE owner_id = ${owner}))`;
}
