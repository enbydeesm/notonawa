// Whether a page left open over a deploy should reload. Pure, so it's easy
// to test; version-check.js asks.

/**
 * Whether to reload: the server is on a newer version than this page (they
 * compare as text: dates with a three-digit number for each release that
 * day), and no share link is waiting to be opened (its key is only in
 * memory, and a reload would lose it; it's forgotten at the next lock, so
 * the check after that reloads). Only newer, never just different: a page
 * that has reloaded is on the server's version, so it can't reload again
 * and again.
 * @param {{ page: string, server: unknown, sharePending: boolean }} state
 */
export function shouldReload({ page, server, sharePending }) {
  return typeof server === "string" && server > page && !sharePending;
}
