// The one-time offer of push notifications: a banner under the install
// offer, while the journal is open, on each device until it's answered
// (push-rules.js's wantsBanner). Allow asks the browser's permission; on an
// iPhone or iPad without the app installed it says to install it first.
// Answered is kept in localStorage (just "1", never journal data).

import { h, $ } from "./dom.js";
import { ASKED_KEY, BANNER_TEXT, blockedText, installFirstText, wantsBanner } from "./push-rules.js";
import { platformOf } from "./install-rules.js";
import { installBannerShown, isInstalled } from "./install-banner.js";
import { pushStatus, turnOnPush } from "./push.js";
import { errorMessage } from "./api.js";

/** @type {HTMLElement | null} */
let box = null;
let asked = readAsked();
/** What it says after Allow, until the next view. @type {string | null} */
let said = null;
let drawing = 0;

/** Makes the banner's place, under the install offer. */
export function pushBox() {
  box = h("div", { id: "push-offer", className: "notices", role: "region", "aria-label": "Notifications", hidden: true });
  $("#install-offer").after(box);
}

/**
 * Shows the banner (if it's wanted here), or hides it.
 * @param {boolean} show
 */
export async function showPushOffer(show) {
  if (!box) return;
  const id = ++drawing;
  said = null;
  if (!show || asked) {
    box.hidden = true;
    return;
  }
  const { state } = await pushStatus().catch(() => ({ state: /** @type {const} */ ("unsupported") }));
  if (id !== drawing) return;
  if (!wantsBanner({ state, asked, installOfferShown: installBannerShown() })) {
    box.hidden = true;
    return;
  }
  draw(state);
}

/** @param {import("./push-rules.js").PushState} state */
function draw(state) {
  if (!box) return;
  box.hidden = false;
  box.replaceChildren(h("div", { className: "notice push-notice" },
    h("p", { id: "push-offer-text" }, said ?? BANNER_TEXT),
    said ? h("div", { className: "notice-actions" },
      h("button", { type: "button", className: "link push-done", onclick: hide }, "OK"))
      : h("div", { className: "notice-actions" },
        h("button", { type: "button", className: "push-allow", onclick: () => allow(state) }, "Allow"),
        h("button", { type: "button", className: "link push-later", onclick: () => { remember(); hide(); } }, "Not now"))));
}

/** @param {import("./push-rules.js").PushState} state */
async function allow(state) {
  remember();
  if (state === "install-first") {
    said = installFirstText();
    return draw(state);
  }
  try {
    const now = await turnOnPush();
    said = now.state === "on" ? "Notifications are on for this device. Choose which ones in Settings."
      : now.state === "blocked" ? blockedText({ platform: platformOf(navigator.userAgent, navigator.maxTouchPoints), installed: isInstalled(), userAgent: navigator.userAgent })
        : null;
    if (said === null) return hide();
  } catch (err) {
    said = "Couldn't turn notifications on: " + errorMessage(err) + " You can try again in Settings.";
  }
  draw(state);
}

function hide() {
  said = null;
  if (box) box.hidden = true;
}

function remember() {
  asked = true;
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    // Storage blocked: asked again when the page is loaded again.
  }
}

function readAsked() {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}
