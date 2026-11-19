// A share's code and link, to show the person it's for: the QR code to
// scan, Copy link, and the phone's share sheet where there is one. Shown
// when a share is made, and again from "Shared by me".

import { h, privateField } from "./dom.js";
import { qrPath } from "./qr.js";
import { shareLink } from "./share-options.js";

const SVG = "http://www.w3.org/2000/svg";

/**
 * A link's QR code as an SVG element. The colors are --qr-dark and
 * --qr-light, the same in both modes: scanners read dark on light.
 * @param {string} text
 * @param {string} label what it's for, for screen readers
 * @returns {SVGSVGElement}
 */
export function qrCode(text, label) {
  const { size, path } = qrPath(text);
  const svg = /** @type {SVGSVGElement} */ (document.createElementNS(SVG, "svg"));
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("class", "qr-code");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  svg.setAttribute("shape-rendering", "crispEdges");
  const background = document.createElementNS(SVG, "rect");
  background.setAttribute("width", String(size));
  background.setAttribute("height", String(size));
  background.setAttribute("class", "qr-light");
  const squares = document.createElementNS(SVG, "path");
  squares.setAttribute("d", path);
  squares.setAttribute("class", "qr-dark");
  svg.append(background, squares);
  return svg;
}

/**
 * Opens a dialog with a share's code. Resolves when it's closed.
 * @param {{ id: string, key: string, title: string, note?: string }} share key: base64url
 * @returns {Promise<void>}
 */
export function showShareCode({ id, key, title, note }) {
  return new Promise((resolve) => {
    const link = shareLink(location.origin, id, key);
    const status = h("p", { className: "message", id: "share-code-status", role: "status" });
    const field = privateField(h("input", { id: "share-code-link", type: "text", readOnly: true, value: link, "aria-label": "Link" }));
    const copy = h("button", {
      type: "button", id: "share-code-copy",
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(link);
          status.textContent = "Link copied.";
        } catch {
          field.select();
          status.textContent = "Couldn't copy: select the link and copy it yourself.";
        }
      },
    }, "Copy link");
    // The phone's share sheet (Messages, Signal and so on), where there is one.
    const shareSheet = typeof navigator.share === "function"
      ? h("button", {
        type: "button", id: "share-code-send",
        onclick: () => navigator.share({ title: "nōtonawa", url: link }).catch(() => {}),
      }, "Share…")
      : null;

    // Ids start with "share-code-": this opens over a view or another dialog.
    const dialog = h("dialog", { className: "form-dialog share-code", "aria-labelledby": "share-code-heading" },
      h("h2", { id: "share-code-heading" }, title),
      h("p", { className: "hint" }, "They scan this with their phone's camera, or open the link, while signed in to nōtonawa."),
      qrCode(link, "QR code for the link"),
      note ? h("p", { className: "warning-note", id: "share-code-note" }, note) : null,
      h("label", { htmlFor: "share-code-link" }, "Link"),
      field,
      h("div", { className: "button-row" }, copy, shareSheet),
      status,
      h("div", { className: "dialog-footer" },
        h("button", { type: "button", className: "primary", id: "share-code-done", onclick: () => dialog.close() }, "Done")));
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
