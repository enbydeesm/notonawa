// When the journal locks itself. Pure, so it's easy to test; lock.js
// watches the page and asks.

export const IDLE_LIMIT_MS = 15 * 60 * 1000; // no taps, keys or scrolling
export const HIDDEN_LIMIT_MS = 5 * 60 * 1000; // in a background tab, or the screen off

/**
 * Why the journal should lock now, or null if it shouldn't.
 * @param {{ now: number, lastActivity: number, hiddenSince: number | null }} state
 * @returns {"idle" | "hidden" | null}
 */
export function lockReason({ now, lastActivity, hiddenSince }) {
  if (hiddenSince !== null && now - hiddenSince >= HIDDEN_LIMIT_MS) return "hidden";
  if (now - lastActivity >= IDLE_LIMIT_MS) return "idle";
  return null;
}
