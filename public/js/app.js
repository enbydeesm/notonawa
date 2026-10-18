// The app: one page that stays loaded while you move between views, so
// nothing held in memory (later, the unlocked encryption key) is lost on
// every tab change. index.html holds each view's markup in a <template>;
// this file shows the one for the address, runs its module's mount(), and
// handles links and Back/Forward without loading a new page.
//
// Each view gets an AbortSignal that fires when it's left: listeners on the
// window or document, observers and timers hang off it, so nothing from one
// view keeps running in the next.
//
// Views that need the encryption key show the Unlock view instead while the
// journal is locked, and are drawn again when it locks (lock.js), so nothing
// decrypted stays on the page.

import { matchRoute, inAppTarget, UNLOCK, CONSENT } from "./router.js";
import { setNavigator } from "./navigate.js";
import { renderNav, showNav, setCurrent } from "./nav.js";
import { $ } from "./dom.js";
import { isUnlocked, onLock } from "./vault.js";
import { sealLeftovers } from "./seal-leftovers.js";
import { watchForLock } from "./lock.js";
import { api } from "./api.js";
import { consentState, setConsentState, onConsentRequired } from "./consent-state.js";
import { noticeBox, showNotices, forgetNotices } from "./notices.js";
import { loadSettings, SETTINGS_SAVED } from "./settings.js";

/**
 * @typedef {{ mount: (root: HTMLElement, context: { signal: AbortSignal, unlocked: () => void }) => unknown }} ViewModule
 * @type {Record<import("./router.js").ViewName, () => Promise<ViewModule>>}
 */
const VIEWS = {
  ties: () => import("./views/ties.js"),
  plans: () => import("./views/plans.js"),
  people: () => import("./views/people.js"),
  locations: () => import("./views/locations.js"),
  calendar: () => import("./views/calendar.js"),
  analytics: () => import("./views/analytics.js"),
  account: () => import("./views/account.js"),
  data: () => import("./views/data.js"),
  signin: () => import("./views/signin.js"),
  "not-found": () => import("./views/not-found.js"),
  unlock: () => import("./views/unlock.js"),
  consent: () => import("./views/consent.js"),
};

const root = $("#view");
renderNav();
noticeBox();

/** @type {import("./router.js").ViewName | null} */
let currentView = null;
// Whether this unlock has checked for notes left in plain text (see below).
let leftoversChecked = false;
/** @type {AbortController | null} */
let controller = null;
// Only the newest change of view is shown, if two overlap.
let latestShow = 0;

// The app puts the scroll position back itself on Back and Forward, once the
// view is drawn.
history.scrollRestoration = "manual";

/**
 * Shows the view for the current address.
 * @param {{ fresh: boolean, scroll: number, focus: boolean }} options
 *   fresh: draw it again even if it's the view already shown (a link or
 *   navigate() to it starts it afresh, as a page load did; Back and Forward
 *   within a view are left to the view, e.g. the Ties list's pages).
 */
async function show({ fresh, scroll, focus }) {
  const addressed = matchRoute(location.pathname);
  const id = ++latestShow;
  const route = await routeFor(addressed);
  if (id !== latestShow) return;
  if (!fresh && route.view === currentView) return;
  const module = await VIEWS[route.view]();
  if (id !== latestShow) return;

  controller?.abort();
  controller = new AbortController();
  currentView = route.view;
  // A dialog belongs to the view it was opened from, as when pages changed.
  for (const dialog of document.querySelectorAll("dialog[open]")) /** @type {HTMLDialogElement} */ (dialog).close();

  document.title = route.title;
  showNav(route.nav);
  // Messages from us, over the journal (not over Unlock, Consent or sign-in).
  showNotices(route === addressed && route.needsKey);
  setCurrent(addressed.path);
  const template = /** @type {HTMLTemplateElement} */ ($(`#view-${route.view}`));
  root.replaceChildren(template.content.cloneNode(true));
  // unlocked: the Unlock view calls it once the journal is unlocked, to draw
  // the view the address is for.
  const unlocked = () => show({ fresh: true, scroll: 0, focus: true });
  await module.mount(root, { signal: controller.signal, unlocked });

  // The first time the journal is shown after unlocking (with a full
  // session, which signing up or recovering only has once they're done):
  // encrypt any notes left in plain text from before encryption.
  if (route.needsKey && !leftoversChecked) {
    leftoversChecked = true;
    sealLeftovers().catch((err) => console.error("Couldn't encrypt older notes:", err));
  }

  window.scrollTo(0, scroll);
  // Tell screen readers the view changed: focus its heading (not on the
  // first load, where the browser does that itself).
  if (focus) {
    const heading = root.querySelector("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }
}

/**
 * What to show for an address: Unlock in place of a view that needs the key
 * while the journal is locked, and Consent in its place while the privacy
 * policy has changed and I haven't agreed (asked once per unlock), except
 * where I can still take my data or delete my account.
 * @param {import("./router.js").Route} addressed
 */
async function routeFor(addressed) {
  if (!addressed.needsKey) return addressed;
  if (!isUnlocked()) return UNLOCK;
  // My role names and mode, before the journal is drawn with them.
  await loadSettings().catch(() => {
    // Unreachable for now: the defaults until the next view tries again.
  });
  if (consentState() === null) {
    try {
      setConsentState(await api("/api/consent"));
    } catch {
      // Unreachable for now: the journal's own requests will say so, and a
      // refusal for want of agreement brings the agreement up.
    }
  }
  return consentState()?.needed && !addressed.beforeConsent ? CONSENT : addressed;
}

/**
 * Goes to a path in the app, adding a history entry unless replace is set.
 * @param {string} path
 * @param {boolean} replace
 */
function go(path, replace) {
  // Remember where this entry was scrolled to, for Back.
  history.replaceState({ ...history.state, scroll: window.scrollY }, "");
  if (replace) history.replaceState({ scroll: 0 }, "", path);
  else history.pushState({ scroll: 0 }, "", path);
  show({ fresh: true, scroll: 0, focus: true });
}

setNavigator(go);
watchForLock();
// Locked (by time, sign-out or the session ending): draw the view again,
// which shows Unlock in place of anything that needs the key.
onLock(() => {
  leftoversChecked = false;
  // Asked again after the next unlock (it may be someone else signing in).
  setConsentState(null);
  forgetNotices();
  show({ fresh: true, scroll: 0, focus: true });
});

// The server refused a change until I agree to the changed policy: show the
// agreement in place of the journal (unless I'm exporting or deleting).
onConsentRequired(() => {
  if (currentView !== "consent" && currentView !== "data" && currentView !== "account") {
    show({ fresh: true, scroll: 0, focus: true });
  }
});

// New role names saved in Settings: draw the view again with them.
document.addEventListener(SETTINGS_SAVED, () => {
  show({ fresh: true, scroll: window.scrollY, focus: false });
});

// Registered before any view's own popstate listener, so a view being left
// is aborted (and its listener skipped) before it reacts.
window.addEventListener("popstate", () => {
  show({ fresh: false, scroll: history.state?.scroll ?? 0, focus: true });
});

document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!(link instanceof HTMLAnchorElement)) return;
  const path = inAppTarget({ href: link.href, target: link.target, download: link.hasAttribute("download") }, event, location.origin);
  if (path === null) return;
  event.preventDefault();
  go(path, false);
});

show({ fresh: true, scroll: 0, focus: false });
