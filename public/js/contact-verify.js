// A connected account's safety number (format 2), from their card in
// People: 60 digits, the same on both phones, made from both accounts' keys
// and ids. Compared in person (read aloud, or one scans the other's QR code
// with their phone's camera, which opens /verify), it shows no one came
// between the two accounts: the server only ever passes them keys, and a
// key of its own would give a different number.

import { errorMessage } from "./api.js";
import { h, showMessage } from "./dom.js";
import { qrCode } from "./share-code.js";
import { safetyBlocks } from "./crypto/safety-number.js";
import { contactStatus, contactSafetyNumber, markVerified } from "./store/index.js";

const SVG = "http://www.w3.org/2000/svg";

/**
 * A small shield, in the accent: a contact's safety number; with a tick
 * inside once verified.
 * @param {boolean} checked
 * @returns {SVGSVGElement}
 */
export function shieldIcon(checked) {
  const svg = /** @type {SVGSVGElement} */ (document.createElementNS(SVG, "svg"));
  for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", class: "shield-icon", "aria-hidden": "true", fill: "none",
    stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" })) svg.setAttribute(name, value);
  const paths = ["M12 3l7.5 3v5.5c0 4.4-3.1 8.2-7.5 9.5-4.4-1.3-7.5-5.1-7.5-9.5V6L12 3z", ...(checked ? ["M8.5 12.2l2.4 2.4 4.6-4.8"] : [])];
  for (const d of paths) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/** The address a safety number's QR code opens: the number after #, so it isn't sent anywhere. */
export const verifyLink = (/** @type {string} */ origin, /** @type {string} */ number) => `${origin}/verify#${number}`;

/**
 * What a contact's status says.
 * @param {{ verified: boolean, keyChanged: boolean }} status
 */
export function statusText({ verified, keyChanged }) {
  if (keyChanged) return "Their account's key has changed since you connected. Compare your safety numbers again in person before you trust it.";
  return verified ? "Verified in person." : "Not verified yet.";
}

/**
 * Opens the safety number of the contact on this person. Resolves true if
 * it was marked verified.
 * @param {{ id: string, name: string }} person
 * @returns {Promise<boolean>}
 */
export function showSafetyNumber(person) {
  const status = contactStatus(person.id);
  return new Promise((resolve) => {
    if (!status) return resolve(false);
    let marked = false;
    const message = h("p", { className: "message", id: "verify-message" });
    const said = h("p", { className: status.keyChanged ? "warning-note" : "hint", id: "verify-status" }, statusText(status));
    const number = h("div", { className: "safety-number", id: "verify-number" }, h("p", { className: "hint" }, "Working it out…"));
    const mark = h("button", {
      type: "button", className: "primary", id: "verify-mark", hidden: true,
      onclick: async () => {
        mark.disabled = true;
        try {
          await markVerified(status.contactId);
          marked = true;
          dialog.close();
        } catch (err) {
          showMessage(message, "Couldn't save it: " + errorMessage(err), true);
          mark.disabled = false;
        }
      },
    }, "They match: mark as verified");
    const dialog = h("dialog", { className: "form-dialog contact-verify", "aria-labelledby": "verify-heading" },
      h("h2", { id: "verify-heading" }, `Verify ${person.name}`),
      said,
      h("p", { className: "hint" }, "Together in person, check that their phone shows the same numbers, or scan their code with your phone's camera."),
      number,
      mark,
      message,
      h("div", { className: "dialog-footer" },
        h("button", { type: "button", id: "verify-close", onclick: () => dialog.close() }, "Close")));
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(marked);
    });
    document.body.append(dialog);
    dialog.showModal();

    contactSafetyNumber(status.contactId).then((digits) => {
      if (!digits) {
        number.replaceChildren(h("p", { className: "hint", id: "verify-waiting" },
          "Their account hasn't answered yet: their safety number shows once it has."));
        return;
      }
      number.replaceChildren(
        h("p", { className: "safety-blocks", id: "verify-digits" }, ...safetyBlocks(digits).map((b) => h("span", {}, b))),
        qrCode(verifyLink(location.origin, digits), "QR code of your safety number"));
      mark.hidden = status.verified && !status.keyChanged;
    }, (err) => showMessage(message, "Couldn't work it out: " + errorMessage(err), true));
  });
}
