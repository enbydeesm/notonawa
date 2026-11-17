// /link#<request id>.<key hash>: a new device's sign-in request, scanned
// from its QR code with this (signed-in) device's camera. Approving it
// sends this account's data key, sealed to the new device, so it asks
// which number the new device shows first (someone who sent the code
// couldn't see it), then for the passkey. See link-flows.js.

import { errorMessage } from "../api.js";
import { h, $ } from "../dom.js";
import { pendingLink, forgetLink } from "../pending-link.js";
import { linkRequest, approveLink, declineLink, LinkMismatch } from "../link-flows.js";
import { numberChoices } from "../crypto/link.js";

/**
 * @param {HTMLElement} root
 * @param {{ signal: AbortSignal }} options
 */
export async function mount(root, { signal }) {
  const body = $("#link-body", root);
  /** @param {...(Node | string)} children */
  const show = (...children) => { if (!signal.aborted) body.replaceChildren(...children); };
  const say = (/** @type {string} */ text, className = "") => show(h("p", { id: "link-said", className }, text));

  const { scanned, damaged } = pendingLink();
  if (!scanned) {
    return say(damaged
      ? "That code is damaged. Start again on the new device and scan its new code."
      : "To sign in on a new device, choose \"Sign in with another device\" on it, then scan the code it shows with this device's camera.");
  }

  say("Checking…");
  /** @type {Awaited<ReturnType<typeof linkRequest>>} */
  let request;
  try {
    request = await linkRequest(scanned);
  } catch (err) {
    forgetLink();
    if (err instanceof LinkMismatch) {
      await declineLink(scanned.id);
      return say(err.message, "warning-note");
    }
    return say(errorMessage(err));
  }

  const status = h("p", { className: "message", id: "link-message", role: "status" });
  const pick = (/** @type {number} */ number) => async () => {
    for (const button of body.querySelectorAll("button")) /** @type {HTMLButtonElement} */ (button).disabled = true;
    if (number !== request.number) {
      forgetLink();
      await declineLink(request.id);
      return say("That isn't the number the new device shows, so this sign-in has been cancelled. If the device is yours, "
        + "start again on it.", "warning-note");
    }
    status.textContent = "Confirm it's you with your passkey…";
    try {
      await approveLink(request);
      forgetLink();
      say("Approved. Carry on on the new device: it will ask you to add a passkey there.");
    } catch (err) {
      status.textContent = errorMessage(err);
      for (const button of body.querySelectorAll("button")) /** @type {HTMLButtonElement} */ (button).disabled = false;
    }
  };
  const cancel = async () => {
    forgetLink();
    await declineLink(request.id);
    say("Cancelled. The new device hasn't been signed in.");
  };

  show(
    h("p", { className: "warning-note" },
      "A new device is asking to sign in to your account and open your journal. Only approve it if it's yours and "
      + "in front of you now. If someone sent you this code, cancel: they're trying to get into your journal."),
    h("p", { id: "link-ask" }, "Which number does the new device show?"),
    h("div", { className: "button-row link-numbers" },
      ...numberChoices(request.number).map((number) => h("button", {
        type: "button", className: "link-number-choice", "data-number": String(number), onclick: pick(number),
      }, String(number)))),
    status,
    h("button", { type: "button", className: "link", id: "link-cancel", onclick: cancel }, "This isn't my device: cancel"),
  );
}
