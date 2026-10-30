// Keeping the screen awake while something is open (the poser): a phone
// would otherwise dim and lock while someone studies a pose. The browser
// drops the lock whenever the page is hidden, so it's asked for again on
// coming back. Where it isn't offered, or is refused (low battery), the
// screen just sleeps as usual: nothing depends on it.

/**
 * What this needs of the page (the browser's navigator and document,
 * passed in for tests).
 * @typedef {{ wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } }} Nav
 * @typedef {EventTarget & { visibilityState: string }} Doc
 */

/**
 * Keeps the screen awake until the returned function is called.
 * @param {Nav} [nav]
 * @param {Doc} [doc]
 * @returns {() => void} lets the screen sleep again
 */
export function keepAwake(nav = /** @type {any} */ (globalThis).navigator, doc = /** @type {any} */ (globalThis).document) {
  if (!nav.wakeLock) return () => {};
  /** @type {{ release(): Promise<void> } | null} */
  let lock = null;
  let done = false;
  const ask = async () => {
    if (done || doc.visibilityState !== "visible" || lock) return;
    try {
      const got = await /** @type {NonNullable<typeof nav.wakeLock>} */ (nav.wakeLock).request("screen");
      if (done) got.release().catch(() => {});
      else lock = got;
    } catch {
      // Refused: the screen sleeps as usual.
    }
  };
  const onVisible = () => {
    // Hidden, the browser has let it go already.
    if (doc.visibilityState !== "visible") lock = null;
    else ask();
  };
  doc.addEventListener("visibilitychange", onVisible);
  ask();
  return () => {
    done = true;
    doc.removeEventListener("visibilitychange", onVisible);
    lock?.release().catch(() => {});
    lock = null;
  };
}
