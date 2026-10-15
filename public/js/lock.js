// Locks the journal by itself (lock-rules.js): after 15 minutes without
// use, after 5 minutes hidden, and when the page goes away (closing the
// tab, reloading, leaving the site). Sign-out and an ended session lock it
// too (account view, api.js).
//
// Browsers slow timers right down in background tabs, so the time is also
// checked as soon as the page is visible again, before anything is shown.

import { lockReason } from "./lock-rules.js";
import { isUnlocked, lock } from "./vault.js";

const CHECK_EVERY_MS = 30 * 1000;
const ACTIVITY = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"];

/** Starts watching. Call once, from app.js. */
export function watchForLock() {
  let lastActivity = Date.now();
  /** @type {number | null} */
  let hiddenSince = document.hidden ? Date.now() : null;

  function check() {
    if (isUnlocked() && lockReason({ now: Date.now(), lastActivity, hiddenSince })) lock();
  }

  const active = () => { lastActivity = Date.now(); };
  for (const type of ACTIVITY) document.addEventListener(type, active, { capture: true, passive: true });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenSince = Date.now();
      return;
    }
    check();
    hiddenSince = null;
    active();
  });
  window.addEventListener("pagehide", () => lock());
  setInterval(check, CHECK_EVERY_MS);
  return { active };
}
