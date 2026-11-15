// "Share my profile": choosing what of my own profile to put in an invite,
// for how long and for whom, then making it (sealed on this device with a
// key that's only in its link) and showing its code. See
// considerations.md, "Sharing between accounts".

import { errorMessage } from "./api.js";
import { h, showMessage, privateField, infoTip } from "./dom.js";
import { EXPIRY_CHOICES, DEFAULT_INVITE_EXPIRY, USE_CHOICES, shareWarning } from "./share-options.js";
import { saveShare } from "./share-save.js";
import { canConnect, profileInvite } from "./store/index.js";
import { showShareCode } from "./share-code.js";
import { profileChoices } from "./profile-choices.js";
import { CONNECT_DISCLOSURE } from "./connection-text.js";

/**
 * Opens the dialog for my own profile (as saved, opened). Resolves when
 * it's closed.
 * @param {{ name: string, pronouns: string | null, default_role: string | null, based_in: string | null, is_educator: unknown,
 *   aliases: string | null, about: string | null }} me
 * @returns {Promise<void>}
 */
export function openShareProfile(me) {
  return new Promise((resolve) => {
    // Ids start with "share-profile-": this opens over the People dialog.
    const choose = profileChoices(me, "share-profile");
    const expires = h("select", { id: "share-profile-expires" },
      EXPIRY_CHOICES.map((c) => h("option", { value: c.value, selected: c.value === DEFAULT_INVITE_EXPIRY }, c.label)));
    const uses = h("select", { id: "share-profile-uses" }, USE_CHOICES.map((c) => h("option", { value: c.value }, c.label)));
    // Connect our accounts: unticked, with what it means shown once it's ticked.
    const connect = h("input", { type: "checkbox", id: "share-profile-connect" });
    const disclosure = h("div", { id: "share-profile-connect-note", hidden: true },
      h("p", { className: "hint connect-disclosure" }, CONNECT_DISCLOSURE));
    const tagInfo = infoTip("share-profile-label-info", "About the invite tag",
      "Provides context for you in Your data (Shared by me and Connections). e.g. the person's name and where you met them.");
    const warning = h("p", { className: "warning-note", id: "share-profile-warning", hidden: true });
    const showWarning = () => {
      const text = shareWarning(expires.value, uses.value, connect.checked);
      warning.hidden = !text;
      warning.textContent = text ?? "";
      disclosure.hidden = !connect.checked;
    };
    expires.addEventListener("change", showWarning);
    uses.addEventListener("change", showWarning);
    connect.addEventListener("change", showWarning);
    const label = privateField(h("input", { id: "share-profile-label", name: "label", required: true, maxLength: 100 }));
    const message = h("p", { className: "message", id: "share-profile-status" });
    const submit = h("button", { type: "submit", className: "primary", id: "share-profile-make" }, "Make invite");

    const aboutInfo = infoTip("share-profile-intro", "About sharing your profile",
      "Someone you invite can add your profile to their People. Your private notes are never shared.");
    const form = h("form", { onsubmit: make },
      aboutInfo.text,
      canConnect() ? h("label", { className: "inline share-connect" }, connect, " ", h("strong", {}, "Connect our accounts")) : null,
      canConnect() ? disclosure : null,
      ...choose.nameRow,
      choose.fields,
      h("div", { className: "row" },
        h("div", {}, h("label", { htmlFor: "share-profile-expires" }, "Share invite lasts"), expires),
        h("div", {}, h("label", { htmlFor: "share-profile-uses" }, "Who can use it"), uses)),
      warning,
      h("div", { className: "label-row" }, h("label", { htmlFor: "share-profile-label" }, "Invite tag"), tagInfo.button),
      tagInfo.text,
      label,
      submit,
      h("button", { type: "button", className: "dialog-cancel", id: "share-profile-cancel", onclick: () => dialog.close() }, "Cancel"),
      message);

    const dialog = h("dialog", { className: "form-dialog share-profile", "aria-labelledby": "share-profile-heading" },
      h("div", { className: "label-row heading-tip" }, h("h2", { id: "share-profile-heading" }, "Share my profile"), aboutInfo.button),
      form);
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve();
    });

    /** @param {SubmitEvent} event */
    async function make(event) {
      event.preventDefault();
      submit.disabled = true;
      showMessage(message, "Making the invite…");
      try {
        const { profile, fields } = choose.read();
        const { id, key } = await profileInvite({
          kind: "profile", data: profile, label: label.value, expires: expires.value, uses: uses.value, connect: connect.checked,
          fields, saveShare,
        });
        dialog.close();
        await showShareCode({ id, key, title: "Your invite", note: shareWarning(expires.value, uses.value, connect.checked) ?? undefined });
      } catch (err) {
        showMessage(message, "Couldn't make the invite: " + errorMessage(err), true);
        submit.disabled = false;
      }
    }

    document.body.append(dialog);
    dialog.showModal();
  });
}
