// A page left open over a deploy keeps running the code it loaded: no new
// features, and no "What's new". While the journal is locked (nothing
// unlocked to lose, no form open), the sign-in and Unlock views ask the
// server which version it's on, and reload the page if it's newer.

import { pendingShare } from "./pending-share.js";
import { APP_VERSION } from "./releases.js";
import { shouldReload } from "./version-rules.js";

/**
 * Reloads the page if the server is on a newer version. Resolves true when
 * it's reloading (the caller should stop), false otherwise, including when
 * the server can't be asked: that never gets in the way.
 * @returns {Promise<boolean>}
 */
export async function reloadIfOutdated() {
  try {
    // fetch, not api(): nothing here should send the page to sign in.
    const res = await fetch("/api/version");
    if (!res.ok) return false;
    const { version } = await res.json();
    const { link, damaged } = pendingShare();
    if (!shouldReload({ page: APP_VERSION, server: version, sharePending: !!link || damaged })) return false;
    location.reload();
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks now, and again whenever the page comes back into view, until the
 * signal aborts (the view is left).
 * @param {AbortSignal} signal
 */
export function watchVersion(signal) {
  reloadIfOutdated();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reloadIfOutdated();
  }, { signal });
}
