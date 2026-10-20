// The view links at the top of the app, as icons (each named for screen
// readers and in its tooltip), then the + button and the menu button (☰),
// which opens a side panel: Settings (light/dark mode and role names, in
// their own dialog), the account and "Your data" links, the privacy policy
// and Sign Out. Drawn once by app.js; setCurrent() marks the view being
// shown.

import { h, $ } from "./dom.js";
import { openTieForm } from "./tie-form.js";
import { navigate } from "./navigate.js";
import { openSettings } from "./settings-dialog.js";
import { api, errorMessage } from "./api.js";
import { lock } from "./vault.js";

/** The tabs: address, name and icon, in order. */
export const PAGES = /** @type {const} */ ([
  ["/", "Ties", hankLineIcon],
  ["/plans", "Plans", planIcon],
  ["/people", "People", personIcon],
  ["/locations", "Locations", pinIcon],
  ["/calendar", "Calendar", calendarIcon],
  ["/analytics", "Analytics", chartIcon],
]);

// Fired on document when a tie is saved from the + button on the Ties view,
// so the list can reload.
export const TIE_SAVED = "tie-saved";

/** The path of the view being shown (null: not one of the app's views). @type {string | null} */
let current = null;
/** @type {HTMLElement | null} */
let navElement = null;

/** Draws the nav at the top of <main>, once. */
export function renderNav() {
  // For now + always logs a tie. Later it will ask what to add (see
  // roadmap.md).
  async function add() {
    if (!(await openTieForm())) return;
    if (current === "/") document.dispatchEvent(new CustomEvent(TIE_SAVED));
    else navigate("/");
  }

  const nav = h(
    "nav",
    {},
    PAGES.map(([href, label, icon]) => h("a", { href, className: "nav-tab", "aria-label": label, title: label }, icon())),
    h("button", { type: "button", className: "nav-add", "aria-label": "Log a tie", title: "Log a tie", onclick: add }, "+"),
    h("button", {
      type: "button", className: "nav-icon nav-menu", "aria-label": "Menu", title: "Menu",
      "aria-haspopup": "dialog", onclick: openMenu,
    }, menuIcon())
  );
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
      // The app's logo. Search for "NotoNawa" when it's renamed.
      h("h2", { className: "menu-title" }, h("img", { src: "/img/logo.png", alt: "NotoNawa" })),
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
      // Pinned to the bottom of the panel. The same page sign-up links to. It
      // isn't part of the app, so it opens in a new tab and leaves the app
      // (and later its unlocked key) as it is.
      h("a", { href: "/privacy", target: "_blank", rel: "noopener", className: "menu-item menu-privacy" },
        privacyIcon(), h("span", {}, "Privacy Policy")),
      h("button", { type: "button", className: "menu-item menu-sign-out", onclick: signOut },
        signOutIcon(), h("span", {}, "Sign Out")),
      signOutMessage
    )
  );

  // Signs out as the Account page does: the session ends on the server, the
  // journal locks, and the sign-in view replaces this one.
  async function signOut() {
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
      lock();
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

/** A blank line-drawn icon to draw in. */
function lineIcon() {
  return svg("svg", {
    viewBox: "0 0 24 24", "aria-hidden": "true", fill: "none",
    stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round",
  });
}

/** Three lines (☰), for the menu button. */
function menuIcon() {
  const icon = lineIcon();
  for (const y of [6, 12, 18]) icon.append(svg("line", { x1: 4, y1: y, x2: 20, y2: y }));
  return icon;
}

/** A coil of rope with wraps round its waist, as in the ratings, for Ties. */
function hankLineIcon() {
  const icon = lineIcon();
  icon.append(
    svg("path", { d: "M12 2.5a5.5 5.5 0 0 1 5.5 5.5v8a5.5 5.5 0 0 1-11 0V8A5.5 5.5 0 0 1 12 2.5z" }),
    svg("path", { d: "M12 6.5a1.5 1.5 0 0 0-1.5 1.5v8a1.5 1.5 0 0 0 3 0V8A1.5 1.5 0 0 0 12 6.5z" }),
    svg("path", { d: "M5 10.5h14M5 13.5h14" })
  );
  return icon;
}

/** A sheet of paper with a pencil writing on it, for Plans. */
function planIcon() {
  const icon = lineIcon();
  icon.setAttribute("stroke-linejoin", "round");
  icon.append(
    svg("path", { d: "M13 3H5.5A1.5 1.5 0 0 0 4 4.5v15A1.5 1.5 0 0 0 5.5 21h11a1.5 1.5 0 0 0 1.5-1.5V14" }),
    svg("path", { d: "M7.5 8h5M7.5 12h3M7.5 16h4" }),
    svg("path", { d: "M19.2 3.3a1.6 1.6 0 0 1 2.3 2.3L14.8 12.3l-3.2.9.9-3.2z" })
  );
  return icon;
}

/** A map pin, for Locations. */
function pinIcon() {
  const icon = lineIcon();
  icon.setAttribute("stroke-linejoin", "round");
  icon.append(
    svg("path", { d: "M12 21.5s-6.5-5.9-6.5-11.5a6.5 6.5 0 0 1 13 0c0 5.6-6.5 11.5-6.5 11.5z" }),
    svg("circle", { cx: 12, cy: 10, r: 2.3 })
  );
  return icon;
}

/** A page of a calendar, for Calendar. */
function calendarIcon() {
  const icon = lineIcon();
  icon.append(
    svg("rect", { x: 3.5, y: 5, width: 17, height: 15.5, rx: 2 }),
    svg("path", { d: "M3.5 10h17M8 3v4M16 3v4" })
  );
  return icon;
}

/** Three bars on a baseline, for the Analytics tab. */
function chartIcon() {
  const icon = lineIcon();
  icon.append(
    svg("path", { d: "M4 20h16" }),
    svg("path", { d: "M7 16v-5M12 16V6M17 16v-8" })
  );
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
