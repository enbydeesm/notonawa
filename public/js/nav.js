// The page links at the top of every page, the light/dark button, and the
// + button.

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
    themeButton(),
    h("button", { type: "button", className: "nav-add", "aria-label": "Log a tie", title: "Log a tie", onclick: add }, "+")
  );
  $("main").prepend(nav);
}

const deviceDark = matchMedia("(prefers-color-scheme: dark)");

/** The sun button: switches between light and dark mode (see theme.js). */
function themeButton() {
  const button = h("button", { type: "button", className: "nav-theme", onclick: toggle }, sunIcon());

  // The choice on the page (put there from storage by theme-init.js) is the
  // one in effect, even when storage is blocked.
  function showing() {
    return shownTheme(parseChoice(document.documentElement.dataset.theme), deviceDark.matches);
  }
  function label() {
    const text = showing() === "dark" ? "Switch to light mode" : "Switch to dark mode";
    button.setAttribute("aria-label", text);
    button.title = text;
  }
  function toggle() {
    const choice = nextChoice(showing(), deviceDark.matches);
    if (choice) document.documentElement.dataset.theme = choice;
    else delete document.documentElement.dataset.theme;
    saveChoice(choice);
    label();
  }

  // The device's mode can change while the page is open (e.g. at sunset).
  deviceDark.addEventListener("change", label);
  label();
  return button;
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

/** A sun whose disc is half filled: outlined on the left, solid on the right. */
function sunIcon() {
  const icon = svg("svg", {
    viewBox: "0 0 24 24", "aria-hidden": "true", fill: "none",
    stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round",
  });
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
