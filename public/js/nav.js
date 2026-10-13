// The page links at the top of every page.

import { h, $ } from "./dom.js";

export const PAGES = [
  ["/", "Ties"],
  ["/plans", "Plans"],
  ["/people", "People"],
  ["/locations", "Locations"],
];

/** @param {string} current the current page's path */
export function renderNav(current) {
  const nav = h(
    "nav",
    {},
    PAGES.map(([href, label]) =>
      h("a", { href, "aria-current": href === current ? "page" : null }, label)
    )
  );
  $("main").prepend(nav);
}
