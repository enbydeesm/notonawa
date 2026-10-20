// Which release notes to show. Pure, so it's easy to test.

/** The most releases the dialog lists at once. */
export const MAX_SHOWN = 10;

/**
 * The releases newer than the one I last saw, newest first (as RELEASES
 * lists them), at most MAX_SHOWN. Versions compare as text: they're dates
 * with a three-digit number for each release that day (2026.10.19.001).
 * Never having seen any (null): all of them.
 * @template {{ version: string }} R
 * @param {R[]} releases newest first
 * @param {string | null} seen
 * @returns {R[]}
 */
export function unseenReleases(releases, seen) {
  return releases.filter((r) => seen === null || r.version > seen).slice(0, MAX_SHOWN);
}
