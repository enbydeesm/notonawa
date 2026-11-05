// How the walkthrough tells that the page has finished reacting to a step,
// so a step waits only as long as the app is busy rather than a fixed time
// (a busy machine is slower, and an idle one needn't wait).
//
// IDLE_TRACKER is added to every page before the app's own scripts
// (Page.addScriptToEvaluateOnNewDocument, which the page's CSP doesn't
// apply to). It counts what the app is waiting on: requests (fetch), the
// crypto Worker's answers (one for each message sent it, vault.js), frames asked for,
// passkeys, preparing photos, and short timers (the searches' typing
// delays), and notes when the page last changed. `window.__uiIdle()` is
// whether none is pending, no animation is running and the page hasn't
// changed for QUIET_MS.
//
// The page's `calm(ms)` (harness.mjs) waits for that, but never longer than
// ms, the fixed time the step used to wait: at worst a step takes as long
// as it did. Work the tracker can't see (something async that neither
// changes the page nor uses one of these) still has `wait(ms)`, a fixed
// time, as do loops that poll.

/** How long the page must be unchanged, with nothing pending, to count as done. */
export const QUIET_MS = 150;

/** Timers longer than this aren't waited for (e.g. revoking a download's URL after 10 s). */
export const SHORT_TIMER_MS = 1500;

export const IDLE_TRACKER = `(() => {
  if (window.__uiIdle) return;
  let pending = 0, lastChange = performance.now();
  const timers = new Set();
  const realSetTimeout = window.setTimeout.bind(window), realClearTimeout = window.clearTimeout.bind(window);
  // The walkthrough's own waits use these, so they aren't counted.
  window.__uiSetTimeout = realSetTimeout;
  const track = (promise) => {
    pending++;
    const done = () => { pending--; lastChange = performance.now(); };
    promise.then(done, done);
    return promise;
  };

  window.setTimeout = function (fn, ms = 0, ...rest) {
    if (typeof fn !== "function" || ms > ${SHORT_TIMER_MS}) return realSetTimeout(fn, ms, ...rest);
    const id = realSetTimeout(() => { timers.delete(id); lastChange = performance.now(); fn(...rest); }, ms);
    timers.add(id);
    return id;
  };
  window.clearTimeout = function (id) { timers.delete(id); return realClearTimeout(id); };

  // A frame asked for: the poser draws its 3D view on the next one, and taps
  // must wait for it (headless Chrome draws it slowly). The app asks for one
  // frame at a time, never one every frame.
  const frames = new Set();
  const realFrame = window.requestAnimationFrame.bind(window), realCancelFrame = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (fn) => {
    const id = realFrame((t) => { try { fn(t); } finally { frames.delete(id); lastChange = performance.now(); } });
    frames.add(id);
    return id;
  };
  window.cancelAnimationFrame = (id) => { frames.delete(id); return realCancelFrame(id); };

  const realFetch = window.fetch.bind(window);
  window.fetch = (...args) => track(realFetch(...args));

  // The crypto Worker answers each message once (vault.js's call()).
  const RealWorker = window.Worker;
  window.Worker = class extends RealWorker {
    constructor(...args) {
      super(...args);
      this.__waiting = 0;
      const answered = () => { if (this.__waiting > 0) { this.__waiting--; pending--; } lastChange = performance.now(); };
      super.addEventListener("message", answered);
      super.addEventListener("error", () => { pending -= this.__waiting; this.__waiting = 0; });
    }
    postMessage(...args) { this.__waiting++; pending++; return super.postMessage(...args); }
  };

  const wrap = (owner, name) => {
    const real = owner?.[name];
    if (typeof real !== "function") return;
    owner[name] = function (...args) { return track(real.apply(this, args)); };
  };
  if (navigator.credentials) { wrap(navigator.credentials, "get"); wrap(navigator.credentials, "create"); }
  wrap(window, "createImageBitmap");
  wrap(Blob.prototype, "arrayBuffer");
  wrap(Blob.prototype, "text");
  if (window.OffscreenCanvas) wrap(OffscreenCanvas.prototype, "convertToBlob");
  const realToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (callback, ...rest) {
    let finish;
    track(new Promise((resolve) => { finish = resolve; }));
    return realToBlob.call(this, (blob) => { try { callback(blob); } finally { finish(); } }, ...rest);
  };

  // A change of address: the app loads the view's module (an import(),
  // which nothing above sees) and then draws it in #view. Busy until #view
  // changes, or 3 s.
  let moving = false, movingTimer;
  const moved = () => {
    moving = true;
    realClearTimeout(movingTimer);
    movingTimer = realSetTimeout(() => { moving = false; }, 3000);
  };
  for (const name of ["pushState", "replaceState"]) {
    const real = history[name];
    history[name] = function (...args) {
      const before = location.pathname;
      const result = real.apply(this, args);
      if (location.pathname !== before) moved();
      return result;
    };
  }
  window.addEventListener("popstate", moved, true);

  new MutationObserver((changes) => {
    lastChange = performance.now();
    if (moving && changes.some((c) => c.target instanceof Element && c.target.closest("#view"))) moving = false;
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });

  window.__uiIdle = () => pending <= 0 && timers.size === 0 && frames.size === 0 && !moving
    && !document.getAnimations().some((a) => a.playState === "running")
    && performance.now() - lastChange >= ${QUIET_MS};
})();`;

/**
 * The page's helpers for waiting (put into harness.mjs's PAGE_HELPERS).
 * `wait(ms)`: a fixed time, for polling loops. `calm(ms)`: until the page is
 * idle, at most ms.
 */
export const WAIT_HELPERS = `
  const wait = (ms) => new Promise((r) => (window.__uiSetTimeout ?? setTimeout)(r, ms));
  const calm = async (ms) => {
    const until = performance.now() + ms;
    // A moment for the step to start what it starts (a click's handler, a
    // view drawn on the next frame).
    await wait(Math.min(ms, 30));
    while (performance.now() < until && !(window.__uiIdle?.() ?? false)) await wait(25);
  };
`;
