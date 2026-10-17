// The view links at the top of the app, as icons (each named for screen
// readers and in its tooltip), then the + button and the menu button (☰),
// which opens a side panel of settings: light/dark mode, the account and
// "Your data" links, and the privacy policy. Drawn once by app.js;
// setCurrent() marks the view being shown.

import { h, $ } from "./dom.js";
import { openTieForm } from "./tie-form.js";
import { navigate } from "./navigate.js";
import { THEME_KEY, parseChoice, shownTheme, nextChoice } from "./theme.js";

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
  // considerations.md).
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
  const theme = themeRow();
  const dialog = h(
    "dialog",
    { className: "menu-panel", "aria-label": "Menu", onclose: () => { theme.stop(); dialog.remove(); } },
    h(
      "div",
      { className: "menu-inner" },
      // The app's logo. Search for "NotoNawa" when it's renamed.
      h("h2", { className: "menu-title" }, h("img", { src: "/img/logo.png", alt: "NotoNawa" })),
      theme.row,
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
        privacyIcon(), h("span", {}, "Privacy Policy"))
    )
  );
  // The panel fills the dialog, so a click on the dialog itself is outside it.
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  document.body.append(dialog);
  dialog.showModal();
}

const deviceDark = matchMedia("(prefers-color-scheme: dark)");

/**
 * The menu's light/dark row: switches between light and dark mode (see
 * theme.js). Its tooltip says which way it will switch. Call stop() when the
 * menu closes.
 */
function themeRow() {
  const row = h("button", { type: "button", className: "menu-item menu-theme", onclick: toggle },
    sunIcon(), h("span", {}, "Light / Dark Mode"));

  // The choice on the page (put there from storage by theme-init.js) is the
  // one in effect, even when storage is blocked.
  function showing() {
    return shownTheme(parseChoice(document.documentElement.dataset.theme), deviceDark.matches);
  }
  function label() {
    row.title = showing() === "dark" ? "Switch to light mode" : "Switch to dark mode";
  }
  function toggle() {
    const choice = nextChoice(showing(), deviceDark.matches);
    if (choice) document.documentElement.dataset.theme = choice;
    else delete document.documentElement.dataset.theme;
    saveChoice(choice);
    label();
  }

  // The device's mode can change while the menu is open (e.g. at sunset).
  deviceDark.addEventListener("change", label);
  label();
  return { row, stop: () => deviceDark.removeEventListener("change", label) };
}

/**
 * Keeps the choice for next time. Just a convenience: if storage is
 * blocked, the choice lasts until the page is reloaded.
 * @param {import("./theme.js").Theme | null} choice
 */
function saveChoice(choice) {
  try {
    if (choice) localStorage.setItem(THEME_KEY, choice);
    else localStorage.removeItem(THEME_KEY);
  } catch {
    // storage blocked
  }
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

/** A sun whose disc is half filled: outlined on the left, solid on the right. */
function sunIcon() {
  const icon = lineIcon();
  icon.append(
    svg("circle", { cx: 12, cy: 12, r: 5 }),
    svg("path", { d: "M12 7a5 5 0 0 1 0 10z", fill: "currentColor" })
  );
  // Eight rays, every 45 degrees.
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const [x, y] = [Math.cos(angle), Math.sin(angle)];
    const point = (/** @type {number} */ r) => [12 + r * x, 12 + r * y].map((n) => n.toFixed(2));
    const [x1, y1] = point(8);
    const [x2, y2] = point(10.5);
    icon.append(svg("line", { x1, y1, x2, y2 }));
  }
  return icon;
}
