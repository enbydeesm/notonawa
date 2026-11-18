// Offers installing the app (install-rules.js decides whether and how): a
// banner between the nav and the view, below the notices, while the journal
// is open, until the app is installed or "Not now" is chosen on this device;
// and the menu's Install app (nav.js), which "Not now" doesn't hide.
// "Not now" is kept in localStorage (just "1", never journal data), like the
// light/dark mode, and isn't sent to us.

import { h, $ } from "./dom.js";
import { tell } from "./dialog.js";
import { installOffer, menuOffer, platformOf, isDismissed, DISMISSED_KEY, INSTALLED_MODES } from "./install-rules.js";

/**
 * The browser's own install window, handed over by Chrome and Edge.
 * @typedef {Event & { prompt: () => Promise<unknown>, userChoice: Promise<{ outcome: string }> }} InstallPromptEvent
 */

/** @type {InstallPromptEvent | null} */
let promptEvent = null;
let installed = INSTALLED_MODES.some((mode) => matchMedia(`(display-mode: ${mode})`).matches)
  // Safari on iPhone and iPad, from the home screen.
  || /** @type {{ standalone?: boolean }} */ (navigator).standalone === true;
let dismissed = readDismissed();
let visible = false;
/** @type {HTMLElement | null} */
let box = null;

// Listened for as soon as the page loads: the browser hands it over once,
// early on (and again later if it isn't used).
window.addEventListener("beforeinstallprompt", (event) => {
  // Our banner in place of the browser's own bar on Android.
  event.preventDefault();
  promptEvent = /** @type {InstallPromptEvent} */ (event);
  draw();
});
window.addEventListener("appinstalled", () => {
  installed = true;
  promptEvent = null;
  draw();
});

/** Makes the banner's place, between the notices and the view. */
export function installBox() {
  box = h("div", { id: "install-offer", className: "notices", role: "region", "aria-label": "Install the app", hidden: true });
  $("#view").before(box);
}

/**
 * Shows the banner (if there's anything to offer), or hides it.
 * @param {boolean} show
 */
export function showInstallOffer(show) {
  visible = show;
  draw();
}

function draw() {
  if (!box) return;
  const offer = visible
    ? installOffer({ installed, dismissed, canPrompt: promptEvent !== null, platform: platformOf(navigator.userAgent, navigator.maxTouchPoints) })
    : null;
  box.hidden = offer === null;
  box.replaceChildren(...(offer ? [h("div", { className: "notice install-notice" },
    h("p", {}, offer.text),
    h("div", { className: "notice-actions" },
      offer.kind === "button" ? h("button", { type: "button", className: "install-now", onclick: install }, "Install") : null,
      h("button", { type: "button", className: "link install-later", onclick: notNow }, "Not now")))] : []));
}

/**
 * What the menu's Install app would do now, or null to leave it out.
 * @returns {import("./install-rules.js").InstallOffer | null}
 */
export function installMenuOffer() {
  return menuOffer({ installed, canPrompt: promptEvent !== null, platform: platformOf(navigator.userAgent, navigator.maxTouchPoints) });
}

/** The menu's Install app: the browser's install window, or where to find it. */
export async function installFromMenu() {
  const offer = installMenuOffer();
  if (offer?.kind === "button") return install();
  if (offer) await tell({ title: "Install the app", message: offer.text, id: "install-steps" });
}

/** Whether the install banner is showing (the notifications offer waits for it). */
export function installBannerShown() {
  return box !== null && !box.hidden;
}

/** Whether the app is running installed (in a window of its own). */
export function isInstalled() {
  return installed;
}

async function install() {
  const event = promptEvent;
  if (!event) return;
  // Each can be opened once; the browser hands over another later if it's closed.
  promptEvent = null;
  draw();
  try {
    await event.prompt();
    if ((await event.userChoice).outcome === "accepted") installed = true;
  } catch {
    // Unreachable for now: the browser refused to open it; nothing to do.
  }
  draw();
}

function notNow() {
  dismissed = true;
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Storage blocked: hidden until the page is loaded again.
  }
  draw();
}

function readDismissed() {
  try {
    return isDismissed(localStorage.getItem(DISMISSED_KEY));
  } catch {
    return false;
  }
}
