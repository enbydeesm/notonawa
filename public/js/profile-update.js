// "Updated info available": a connected account sent its profile again (its
// own changes, the fields it shares with me). Nothing on my card of them
// changes until I review it here: field by field, as when adding an
// invite (profile-merge.js), then Save; or Ignore, which keeps my card as
// it is. Either way the update stops waiting.

import { errorMessage } from "./api.js";
import { h, showMessage } from "./dom.js";
import { readProfile } from "./profile-share.js";
import { mergeFields } from "./profile-merge.js";
import { profileCard } from "./open-profile.js";
import { saveItem, pendingProfile, profileUpdateDone } from "./store/index.js";

/**
 * Reviews the update waiting for this person, if there is one. Resolves
 * true if my card or the update changed (People reloads).
 * @param {any} person mine, opened
 * @returns {Promise<boolean>}
 */
export function reviewProfileUpdate(person) {
  const pending = pendingProfile(person.id);
  return new Promise((resolve) => {
    if (!pending) return resolve(false);
    let changed = false;
    const message = h("p", { className: "message", id: "update-message" });
    const dialog = h("dialog", { className: "form-dialog profile-update", "aria-labelledby": "update-heading" });
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(changed);
    });
    /** @param {string} what @param {() => Promise<void>} work */
    const act = async (what, work) => {
      for (const b of dialog.querySelectorAll("button")) b.disabled = true;
      showMessage(message, "Saving…");
      try {
        await work();
        await profileUpdateDone(pending.contactId);
        changed = true;
        dialog.close();
      } catch (err) {
        showMessage(message, `Couldn't ${what}: ` + errorMessage(err), true);
        for (const b of dialog.querySelectorAll("button")) b.disabled = false;
      }
    };
    const close = h("button", { type: "button", className: "dialog-cancel", id: "update-cancel", onclick: () => dialog.close() }, "Not now");
    // Read strictly again: it came from another account.
    const profile = readProfile(pending.profile);
    if (!profile) {
      dialog.append(h("h2", { id: "update-heading" }, "Updated info"),
        h("p", { id: "update-said" }, "This update couldn't be read."),
        h("button", { type: "button", className: "primary", id: "update-ignore", onclick: () => act("dismiss it", async () => {}) }, "Dismiss"),
        close, message);
    } else {
      const merge = mergeFields({ root: dialog, person, profile, prefix: "update" });
      dialog.append(h("h2", { id: "update-heading" }, `Updated info from ${person.name}`),
        h("p", { className: "hint" }, "What they share with you now:"),
        profileCard(profile, "update"),
        ...merge.elements,
        h("button", { type: "button", className: "primary", id: "update-save",
          onclick: () => act("save", async () => { await saveItem("people", person.id, merge.record()); }) }, `Save to ${person.name}`),
        h("button", { type: "button", id: "update-ignore", onclick: () => act("ignore it", async () => {}) }, "Ignore this update"),
        close, message);
    }
    document.body.append(dialog);
    dialog.showModal();
  });
}
