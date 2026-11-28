// The view links at the top of the app, as icons (each named for screen
// readers and in its tooltip), the poser's button after them (the poser on
// its own, over the view: it asks where to save what it makes), then the menu
// button, which opens a side panel: Settings (light/dark mode and role names, in
// their own dialog), the account and "Your data" links, Install app (until
// it's installed, where the browser can), Tutorial (the
// welcome tour), Join the nōtonawa Discord (our community's invite link, in
// a new tab), Bug and feedback,
// What's new (the release notes), the privacy policy, Sign Out and the
// app's version.
// Drawn once by app.js; setCurrent() marks the view being shown.

import { h, $ } from "./dom.js";
import { navigate } from "./navigate.js";
import { openSettings } from "./settings-dialog.js";
import { openWhatsNew } from "./whats-new.js";
import { openFeedback } from "./feedback-dialog.js";
import { openTour } from "./tour.js";
import { installMenuOffer, installFromMenu } from "./install-banner.js";
import { forgetPushDevice } from "./push.js";
import { APP_VERSION } from "./releases.js";
import { api, errorMessage } from "./api.js";
import { lock, isUnlocked } from "./vault.js";
import { wipeCaches } from "./cache/db.js";
import { ICONS as VISUAL_ICONS } from "./visual-icons.js";
import { HANK_PATH } from "./rope-rating.js";
import { drawnIcon } from "./nav-art.js";

/** The nōtonawa Discord's invite (the menu's Join the nōtonawa Discord). */
export const DISCORD_INVITE = "https://discord.gg/5tqpYntYvM";

/** The tabs: address, name and icon, in order. */
export const PAGES = /** @type {const} */ ([
  ["/", "Ties", hankShapeIcon],
  ["/plans", "Plans", () => drawnIcon("plans")],
  ["/education", "Education", () => drawnIcon("education")],
  ["/people", "People", () => drawnIcon("people")],
  ["/locations", "Locations", () => drawnIcon("locations")],
  ["/calendar", "Calendar", () => drawnIcon("calendar")],
  ["/analytics", "Analytics", () => drawnIcon("analytics")],
]);

/**
 * The icon of the tab for a view, e.g. "/plans" (the "Add pose to…" sheet
 * marks ties, plans and workshops with their tabs' icons).
 * @param {string} path
 * @returns {Element}
 */
export function tabIcon(path) {
  const page = PAGES.find(([href]) => href === path);
  return page ? page[2]() : lineIcon();
}

// Fired on document when a tie is saved from the + button on the Ties view,
// so the list can reload.
export const TIE_SAVED = "tie-saved";
// The same for plans and workshops: fired when one changes from outside
// its view (the poser on its own adding a pose to it), so the view reloads.
export const PLAN_SAVED = "plan-saved";
export const WORKSHOP_SAVED = "workshop-saved";

// The logo's two parts, as in app.css (.logo), the same in both modes.
const LOGO = ["/img/logo-mark-v4.svg", "/img/logo-word-v4.svg"];

/**
 * Fetches the logo, so it's there as soon as the menu first opens rather
 * than loading as it slides in. app.js calls it once the journal is
 * unlocked; images are cached (public/_headers), so the menu's mask then
 * comes from the cache.
 */
export function preloadMenuLogo() {
  for (const src of LOGO) new Image().src = src;
}

/** The path of the view being shown (null: not one of the app's views). @type {string | null} */
let current = null;
/** @type {HTMLElement | null} */
let navElement = null;
/** @type {HTMLButtonElement | null} */
let poserButton = null;

/** Draws the nav at the top of <main>, once, hidden until showNav. */
export function renderNav() {
  // The poser, loaded only once it's wanted (three.js is big). Opened
  // here, Save pose and Add to visuals ask which tie, plan or workshop
  // they're for (standalone-poser.js).
  async function openPoser() {
    const { openStandalonePoser } = await import("./standalone-poser.js");
    await openStandalonePoser();
  }
  poserButton = h("button", {
    type: "button", className: "nav-tab nav-poser", id: "nav-poser", "aria-label": "Poser", title: "Poser",
    "aria-haspopup": "dialog", onclick: openPoser,
  }, VISUAL_ICONS.pose());

  const nav = h(
    "nav",
    {},
    PAGES.map(([href, label, icon]) => h("a", { href, className: "nav-tab", "aria-label": label, title: label }, icon())),
    poserButton,
    h("button", {
      type: "button", className: "nav-icon nav-menu", "aria-label": "Menu", title: "Menu",
      "aria-haspopup": "dialog", onclick: openMenu,
    }, drawnIcon("menu"))
  );
  // Hidden until the first view that has it is shown (showNav): a page
  // loading, still locked, mustn't show it before Unlock is drawn.
  nav.hidden = true;
  $("main").prepend(nav);
  navElement = nav;
  return nav;
}

/**
 * Shows or hides the nav (hidden on the sign-in view, and once the account
 * is deleted).
 * @param {boolean} shown
 */
export function showNav(shown) {
  if (navElement) navElement.hidden = !shown;
}

/**
 * Marks the view being shown in the nav (and in the menu when it opens).
 * @param {string | null} path
 */
export function setCurrent(path) {
  current = path;
  // The poser reads my presets and default body, sealed: only once unlocked.
  if (poserButton) poserButton.disabled = !isUnlocked();
  for (const link of navElement?.querySelectorAll("a") ?? []) {
    if (link.getAttribute("href") === path) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

/**
 * The menu: a panel that slides in from the right, built each time it opens
 * (like the confirmation dialogs) and removed when it closes. Closes with
 * Esc or a tap on the dimmed page beside it.
 */
function openMenu() {
  const signOutMessage = h("p", { className: "message error menu-message", role: "alert" });
  const dialog = h(
    "dialog",
    { className: "menu-panel", "aria-label": "Menu", onclose: () => dialog.remove() },
    h(
      "div",
      { className: "menu-inner" },
      // The app's logo, app.css's mask in the text color. Search for "nōtonawa" when it's renamed.
      h("h2", { className: "menu-title" }, h("span", { className: "logo", role: "img", "aria-label": "nōtonawa" })),
      h("button", {
        type: "button", className: "menu-item menu-settings", "aria-haspopup": "dialog",
        onclick: () => { dialog.close(); openSettings(); },
      }, gearIcon(), h("span", {}, "Settings")),
      h("a", {
        href: "/account", className: "menu-item nav-account",
        "aria-current": current === "/account" ? "page" : null,
      }, personIcon(), h("span", {}, "Account")),
      h("a", {
        href: "/data", className: "menu-item nav-data",
        "aria-current": current === "/data" ? "page" : null,
      }, dataIcon(), h("span", {}, "Your data")),
      // Installing, the tutorial, feedback, What's new, the privacy policy
      // and signing out are pinned to the bottom of the panel. Install app
      // stays after the banner's "Not now". The tutorial is the welcome
      // tour (tour.js), from its start.
      installMenuOffer() ? h("button", {
        type: "button", className: "menu-item menu-install",
        onclick: () => { dialog.close(); installFromMenu(); },
      }, installIcon(), h("span", {}, "Install app")) : null,
      h("button", {
        type: "button", className: "menu-item menu-tutorial", "aria-haspopup": "dialog",
        onclick: () => { dialog.close(); openTour(); },
      }, tutorialIcon(), h("span", {}, "Tutorial")),
      // Our Discord's invite. Another site: a new tab (the app, and its
      // unlocked key, left as they are), and noreferrer, so it isn't told
      // which page sent them. Nothing of Discord's runs in the app.
      h("a", { href: DISCORD_INVITE, target: "_blank", rel: "noopener noreferrer", className: "menu-item menu-discord" },
        discordIcon(), h("span", {}, "Join the nōtonawa Discord")),
      h("button", {
        type: "button", className: "menu-item menu-feedback", "aria-haspopup": "dialog",
        onclick: () => { dialog.close(); openFeedback(); },
      }, feedbackIcon(), h("span", {}, "Bug and feedback")),
      h("button", {
        type: "button", className: "menu-item menu-whats-new", "aria-haspopup": "dialog",
        onclick: () => { dialog.close(); openWhatsNew(); },
      }, sparkleIcon(), h("span", {}, "What's new")),
      // The same page sign-up links to. It isn't part of the app, so it
      // opens in a new tab and leaves the app (and its unlocked key) as it is.
      h("a", { href: "/privacy", target: "_blank", rel: "noopener", className: "menu-item menu-privacy" },
        privacyIcon(), h("span", {}, "Privacy Policy")),
      h("button", { type: "button", className: "menu-item menu-sign-out", onclick: signOut },
        signOutIcon(), h("span", {}, "Sign Out")),
      signOutMessage,
      h("p", { className: "hint app-version" }, `Version ${APP_VERSION}`)
    )
  );

  // Signs out as the Account page does: the session ends on the server, the
  // journal locks, and the sign-in view replaces this one.
  async function signOut() {
    try {
      // This device's notifications stop first, while still signed in.
      await forgetPushDevice();
      await api("/api/auth/logout", { method: "POST", body: {} });
      lock();
      // The journal's sealed copy on this device goes too: someone else may use it next.
      await wipeCaches();
      dialog.close();
      navigate("/signin", { replace: true });
    } catch (err) {
      signOutMessage.textContent = "Couldn't sign out: " + errorMessage(err);
    }
  }
  // The panel fills the dialog, so a click on the dialog itself is outside it.
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  document.body.append(dialog);
  dialog.showModal();
}

const SVG = "http://www.w3.org/2000/svg";

/**
 * @param {string} tag
 * @param {Record<string, string | number>} attrs
 */
function svg(tag, attrs) {
  const el = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  return el;
}

/** A graduation cap's lines: the Education tab, and an educator's card on People. */
export const CAP_PATHS = [
  "M2 9.5 12 5l10 4.5L12 14z",
  "M6 11.5v4.2c0 1.6 2.7 2.8 6 2.8s6-1.2 6-2.8v-4.2",
  "M22 9.5v5",
];

/** A blank line-drawn icon to draw in. */
function lineIcon() {
  return svg("svg", {
    viewBox: "0 0 24 24", "aria-hidden": "true", fill: "none",
    stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round",
  });
}

/** The ratings' rope hank, for Ties: a filled shape, not lines, in the text color. */
function hankShapeIcon() {
  const icon = lineIcon();
  icon.append(svg("path", { d: HANK_PATH, fill: "currentColor", stroke: "none" }));
  return icon;
}

/** A head and shoulders, for the account link. */
function personIcon() {
  const icon = lineIcon();
  icon.append(
    svg("circle", { cx: 12, cy: 8, r: 4 }),
    svg("path", { d: "M4 21a8 8 0 0 1 16 0" })
  );
  return icon;
}

/** A tray with arrows in and out, for exporting and importing. */
function dataIcon() {
  const icon = lineIcon();
  icon.append(
    svg("path", { d: "M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" }),
    svg("path", { d: "M9 4v10M6 11l3 3 3-3" }),
    svg("path", { d: "M15 14V4M12 7l3-3 3 3" })
  );
  return icon;
}

/** A phone with an arrow down into it, for Install app. */
function installIcon() {
  const icon = lineIcon();
  icon.setAttribute("stroke-linejoin", "round");
  icon.append(
    svg("rect", { x: 6, y: 2.5, width: 12, height: 19, rx: 2 }),
    svg("path", { d: "M12 7v7M9 11l3 3 3-3" }),
    svg("path", { d: "M10.5 18.5h3" })
  );
  return icon;
}

/** A four-pointed star with a small one beside it, for What's new. */
function sparkleIcon() {
  const icon = lineIcon();
  icon.setAttribute("stroke-linejoin", "round");
  icon.append(
    svg("path", { d: "M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z" }),
    svg("path", { d: "M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" })
  );
  return icon;
}

/**
 * A speech bubble with a small bug over its bottom-left corner, for Bug and
 * feedback. The bubble's outline stops short of the bug, so the two don't
 * cross.
 */
/** A lightbulb with a question mark inside it. */
function tutorialIcon() {
  const icon = lineIcon();
  icon.setAttribute("stroke-linejoin", "round");
  icon.append(
    // The bulb, narrowing to its base, and the base's two lines.
    svg("path", { d: "M9 17.5c0-2-1-2.8-2.2-4.3A6.5 6.5 0 1 1 17.2 13.2C16 14.7 15 15.5 15 17.5" }),
    svg("path", { d: "M9 17.5h6M9.8 20.5h4.4" }),
    // The question mark inside.
    svg("path", { d: "M10.4 8.2a1.8 1.8 0 1 1 2.6 1.6c-.6.3-1 .8-1 1.5v.4", "stroke-width": 1.6 }),
    svg("circle", { cx: 12, cy: 13.6, r: 0.9, fill: "currentColor", stroke: "none" })
  );
  return icon;
}

/**
 * Discord's own symbol, from their brand guidelines (discord.com/branding:
 * Discord-Symbol-White.svg, its one path unchanged), drawn in the text's
 * color as their white and black versions are: 20 wide, centred in the
 * menu's 24 × 24 icons.
 */
function discordIcon() {
  const icon = lineIcon();
  icon.append(svg("path", {
    transform: "translate(2 4.42) scale(0.15792)", fill: "currentColor", stroke: "none",
    d: "M81.15,0c-1.2376,2.1973-2.3489,4.4704-3.3591,6.794-9.5975-1.4396-19.3718-1.4396-28.9945,0-.985-2.3236-2.1216-4.5967-3.3591-6.794-9.0166,1.5407-17.8059,4.2431-26.1405,8.0568C2.779,32.5304-1.6914,56.3725.5312,79.8863c9.6732,7.1476,20.5083,12.603,32.0505,16.0884,2.6014-3.4854,4.8998-7.1981,6.8698-11.0623-3.738-1.3891-7.3497-3.1318-10.8098-5.1523.9092-.6567,1.7932-1.3386,2.6519-1.9953,20.281,9.547,43.7696,9.547,64.0758,0,.8587.7072,1.7427,1.3891,2.6519,1.9953-3.4601,2.0457-7.0718,3.7632-10.835,5.1776,1.97,3.8642,4.2683,7.5769,6.8698,11.0623,11.5419-3.4854,22.3769-8.9156,32.0509-16.0631,2.626-27.2771-4.496-50.9172-18.817-71.8548C98.9811,4.2684,90.1918,1.5659,81.1752.0505l-.0252-.0505ZM42.2802,65.4144c-6.2383,0-11.4159-5.6575-11.4159-12.6535s4.9755-12.6788,11.3907-12.6788,11.5169,5.708,11.4159,12.6788c-.101,6.9708-5.026,12.6535-11.3907,12.6535ZM84.3576,65.4144c-6.2637,0-11.3907-5.6575-11.3907-12.6535s4.9755-12.6788,11.3907-12.6788,11.4917,5.708,11.3906,12.6788c-.101,6.9708-5.026,12.6535-11.3906,12.6535Z",
  }));
  return icon;
}

function feedbackIcon() {
  const icon = lineIcon();
  icon.setAttribute("stroke-linejoin", "round");
  icon.append(
    // The bubble: a rounded box with its tail at the bottom right.
    svg("path", { d: "M11 16h3l4 3.5V16h.5a2.5 2.5 0 0 0 2.5-2.5v-8A2.5 2.5 0 0 0 18.5 3h-12A2.5 2.5 0 0 0 4 5.5V11" }),
    // The bug: a solid body and head, with legs and feelers.
    svg("ellipse", { cx: 6, cy: 18, rx: 2.6, ry: 3.2, fill: "currentColor", stroke: "none" }),
    svg("circle", { cx: 6, cy: 13.6, r: 1.4, fill: "currentColor", stroke: "none" }),
    svg("path", { d: "M2 16l1.6.8M10 16l-1.6.8M1.8 19.5h1.6M10.2 19.5H8.6M2.5 22.5l1.4-1M9.5 22.5l-1.4-1M4.8 12.5L4 11M7.2 12.5L8 11", "stroke-width": 1.4 })
  );
  return icon;
}

/** A solid person with a padlock by their shoulder, for the privacy policy. */
function privacyIcon() {
  const icon = lineIcon();
  icon.append(
    svg("circle", { cx: 9, cy: 7, r: 4, fill: "currentColor", stroke: "none" }),
    svg("path", { d: "M2 21a7 7 0 0 1 11.5-5.4V21z", fill: "currentColor", stroke: "none" }),
    svg("path", { d: "M16 15.5v-2a2.5 2.5 0 0 1 5 0v2", "stroke-width": 1.8 }),
    svg("rect", { x: 14.5, y: 15.5, width: 8, height: 6, rx: 1, fill: "currentColor", stroke: "none" })
  );
  return icon;
}

/** A cog with six teeth round a hole, for Settings. */
function gearIcon() {
  const icon = lineIcon();
  icon.setAttribute("stroke-linejoin", "round");
  // Teeth every 60 degrees: each a short block standing out from the rim.
  const points = [];
  for (let i = 0; i < 6; i++) {
    const mid = (i * Math.PI) / 3;
    for (const [angle, r] of [[mid - 0.42, 7.2], [mid - 0.26, 10], [mid + 0.26, 10], [mid + 0.42, 7.2]]) {
      points.push(`${(12 + r * Math.cos(angle)).toFixed(2)} ${(12 + r * Math.sin(angle)).toFixed(2)}`);
    }
  }
  icon.append(svg("path", { d: `M${points.join("L")}Z` }), svg("circle", { cx: 12, cy: 12, r: 3 }));
  return icon;
}

/** A door with an arrow leaving through it, for Sign Out. */
function signOutIcon() {
  const icon = lineIcon();
  icon.setAttribute("stroke-linejoin", "round");
  icon.append(
    svg("path", { d: "M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10" }),
    svg("path", { d: "M10 12h10M16 8l4 4-4 4" })
  );
  return icon;
}
