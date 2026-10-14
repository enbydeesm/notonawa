// The page links at the top of every page, then the + button and the menu
// button (☰), which opens a side panel of settings: light/dark mode and the
// account link so far.

import { h, $ } from "./dom.js";
import { openTieForm } from "./tie-form.js";
import { THEME_KEY, parseChoice, shownTheme, nextChoice } from "./theme.js";

export const PAGES = [
  ["/", "Ties"],
  ["/plans", "Plans"],
  ["/people", "People"],
  ["/locations", "Locations"],
];

// Fired on document when a tie is saved from the + button on the Ties page,
// so the list can reload.
export const TIE_SAVED = "tie-saved";

/** @param {string} current the current page's path */
export function renderNav(current) {
  // For now + always logs a tie. Later it will ask what to add (see
  // considerations.md).
  async function add() {
    if (!(await openTieForm())) return;
    if (current === "/") document.dispatchEvent(new CustomEvent(TIE_SAVED));
    else location.href = "/";
  }

  const nav = h(
    "nav",
    {},
    PAGES.map(([href, label]) =>
      h("a", { href, "aria-current": href === current ? "page" : null }, label)
    ),
    h("button", { type: "button", className: "nav-add", "aria-label": "Log a tie", title: "Log a tie", onclick: add }, "+"),
    h("button", {
      type: "button", className: "nav-icon nav-menu", "aria-label": "Menu", title: "Menu",
      "aria-haspopup": "dialog", onclick: () => openMenu(current),
    }, menuIcon())
  );
  $("main").prepend(nav);
}

/**
 * The menu: a panel that slides in from the right, built each time it opens
 * (like the confirmation dialogs) and removed when it closes. Closes with
 * Esc or a tap on the dimmed page beside it.
 * @param {string} current the current page's path
 */
function openMenu(current) {
  const theme = themeRow();
  const dialog = h(
    "dialog",
    { className: "menu-panel", "aria-label": "Menu", onclose: () => { theme.stop(); dialog.remove(); } },
    h(
      "div",
      { className: "menu-inner" },
      // The app's name. Search for "Rope Journal" when it's renamed.
      h("h2", { className: "menu-title" }, "Rope Journal"),
      theme.row,
      h("a", {
        href: "/account", className: "menu-item nav-account",
        "aria-current": current === "/account" ? "page" : null,
      }, personIcon(), h("span", {}, "Account")),
      // Pinned to the bottom of the panel. The same page sign-up links to.
      h("a", { href: "/privacy", className: "menu-item menu-privacy" }, privacyIcon(), h("span", {}, "Privacy Policy"))
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
 * Keeps the choice for the next page. Just a convenience: if storage is
 * blocked, the choice lasts until the page changes.
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

/** A head and shoulders, for the account link. */
function personIcon() {
  const icon = lineIcon();
  icon.append(
    svg("circle", { cx: 12, cy: 8, r: 4 }),
    svg("path", { d: "M4 21a8 8 0 0 1 16 0" })
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
