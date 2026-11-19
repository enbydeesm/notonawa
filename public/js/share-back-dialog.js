// Sharing my profile with a connected account (format 2), through our
// connection rather than a link: on accepting their invite ("Share your
// profile back?"), or later from their card in People. The same choices as
// Share my profile (profile-choices.js). It goes sealed with our pair key,
// and later changes to my profile go to them too, the same fields.

import { errorMessage } from "./api.js";
import { h, showMessage } from "./dom.js";
import { profileChoices } from "./profile-choices.js";

/** @typedef {{ profile: import("./profile-share.js").SharedProfile, fields: Record<string, any> }} ShareBack */

/**
 * Asks what of my profile to share with them. Resolves with it, or null
 * if I'd rather not (or close it).
 * @param {import("./profile-choices.js").MyProfile} me
 * @param {{ name: string, accepting: boolean }} to their name; accepting: on accepting their invite (the
 *   connection is made either way), else from their card
 * @param {(share: ShareBack) => Promise<void>} [send] what to do with it before closing, its error said in the dialog
 * @returns {Promise<ShareBack | null>}
 */
export function chooseShareBack(me, { name, accepting }, send = async () => {}) {
  return new Promise((resolve) => {
    /** @type {ShareBack | null} */
    let result = null;
    // Ids start with "share-back-": this opens over the open page or the People dialog.
    const choose = profileChoices(me, "share-back");
    const message = h("p", { className: "message", id: "share-back-status" });
    const submit = h("button", { type: "submit", className: "primary", id: "share-back-share" }, accepting ? "Share and connect" : "Share");
    const form = h("form", { onsubmit: share },
      h("p", { className: "hint" }, "It goes to them through your connection, sealed: nōtonawa's server can't read it. "
        + "When you change your profile later, they get the same fields again."),
      ...choose.nameRow,
      choose.fields,
      submit,
      h("button", { type: "button", className: "dialog-cancel", id: "share-back-skip", onclick: () => dialog.close() },
        accepting ? "Connect without sharing" : "Cancel"),
      message);
    const dialog = h("dialog", { className: "form-dialog share-profile share-back", "aria-labelledby": "share-back-heading" },
      h("h2", { id: "share-back-heading" }, accepting ? `Share your profile back with ${name}?` : `Share my profile with ${name}`),
      form);
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(result);
    });

    /** @param {SubmitEvent} event */
    async function share(event) {
      event.preventDefault();
      submit.disabled = true;
      try {
        const chosen = choose.read();
        showMessage(message, "Sharing…");
        await send(chosen);
        result = chosen;
        dialog.close();
      } catch (err) {
        showMessage(message, "Couldn't share it: " + errorMessage(err), true);
        submit.disabled = false;
      }
    }

    document.body.append(dialog);
    dialog.showModal();
  });
}
