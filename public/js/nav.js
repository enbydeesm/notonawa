// The page links at the top of every page, and the + button.

import { h, $ } from "./dom.js";
import { openTieForm } from "./tie-form.js";

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
    h("button", { type: "button", className: "nav-add", "aria-label": "Log a tie", title: "Log a tie", onclick: add }, "+")
  );
  $("main").prepend(nav);
}
