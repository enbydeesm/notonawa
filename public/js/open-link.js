// A link field's label with an "Open …" link beside it ("Album link  Open
// Album"): shown once the saved item has a web address there, opening it
// in a new tab. The tie, plan and workshop forms' album links and a
// workshop's event link use it.

import { h } from "./dom.js";
import { isWebLink } from "./links.js";

/**
 * @param {{ htmlFor: string, label: string, link: string }} options
 *   htmlFor: the field's id; label: its label; link: the link's words
 * @returns {{ element: HTMLElement, show: (url: unknown) => void }}
 *   show: the saved address, or nothing to hide the link (it's only made
 *   clickable if it's a web link, links.js)
 */
export function labelWithOpenLink({ htmlFor, label, link }) {
  const anchor = /** @type {HTMLAnchorElement} */ (h("a", {
    className: "open-link", id: `${htmlFor}-open`, target: "_blank", rel: "noopener noreferrer", hidden: true,
  }, link));
  const element = h("div", { className: "label-row" }, h("label", { htmlFor }, label), anchor);
  return {
    element,
    show(url) {
      if (typeof url === "string" && isWebLink(url.trim())) {
        anchor.href = url.trim();
        anchor.hidden = false;
      } else {
        anchor.removeAttribute("href");
        anchor.hidden = true;
      }
    },
  };
}
