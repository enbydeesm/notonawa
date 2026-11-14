// "Share my profile": choosing what of my own profile to put in an invite,
// for how long and for whom, then making it (sealed on this device with a
// key that's only in its link) and showing its code. See
// considerations.md, "Sharing between accounts".

import { errorMessage } from "./api.js";
import { h, showMessage, privateField, infoTip } from "./dom.js";
import { readAliases, PLATFORMS } from "./aliases.js";
import { buildProfile, suggestedName } from "./profile-share.js";
import { EXPIRY_CHOICES, DEFAULT_EXPIRY, USE_CHOICES, shareWarning } from "./share-options.js";
import { saveShare } from "./share-save.js";
import { canConnect } from "./store/index.js";
import { showShareCode } from "./share-code.js";
import { CONNECT_DISCLOSURE_SHORT, CONNECT_DISCLOSURE_MORE } from "./connection-text.js";
import { roleName } from "./roles.js";
import { capitalise } from "./format.js";

/**
 * Opens the dialog for my own profile (as saved, opened). Resolves when
 * it's closed.
 * @param {{ name: string, pronouns: string | null, default_role: string | null, based_in: string | null, is_educator: unknown,
 *   aliases: string | null, about: string | null }} me
 * @returns {Promise<void>}
 */
export function openShareProfile(me) {
  return new Promise((resolve) => {
    const aliases = readAliases(me.aliases);
    // Ids start with "share-profile-": this opens over the People dialog.
    const name = privateField(h("input", {
      id: "share-profile-name", name: "name", required: true, maxLength: 200, value: suggestedName(me.name),
    }));
    /**
     * A tickbox for one thing to share, showing what it is.
     * @param {string} id
     * @param {string} label
     * @param {string} value
     */
    const tick = (id, label, value) => h("label", { className: "inline share-field" },
      h("input", { type: "checkbox", id: `share-profile-${id}`, checked: true }),
      h("span", {}, h("strong", {}, label), " ", value));
    const platform = (/** @type {string} */ value) => PLATFORMS.find((p) => p.value === value)?.label ?? "Other";
    const fields = [
      me.pronouns ? tick("pronouns", "Pronouns:", me.pronouns) : null,
      me.default_role ? tick("default_role", "Usual role:", capitalise(roleName(me.default_role))) : null,
      ...aliases.map((a, i) => tick(`alias-${i}`, `${platform(a.platform)}:`, a.alias)),
      me.based_in ? tick("based_in", "Based in:", me.based_in) : null,
      // Shown either way; only a yes goes in the invite (profile-share.js),
      // so "No" leaves their card for me as they set it.
      tick("is_educator", "Educator:", me.is_educator ? "Yes" : "No"),
      me.about ? tick("about", "About me:", "Your shareable notes about yourself. Your private notes are never shared.") : null,
    ].filter(Boolean);
    const expires = h("select", { id: "share-profile-expires" },
      EXPIRY_CHOICES.map((c) => h("option", { value: c.value, selected: c.value === DEFAULT_EXPIRY }, c.label)));
    const uses = h("select", { id: "share-profile-uses" }, USE_CHOICES.map((c) => h("option", { value: c.value }, c.label)));
    // Connect our accounts: unticked, with what it means shown once it's ticked.
    const connect = h("input", { type: "checkbox", id: "share-profile-connect" });
    // The first sentence of what it means, the rest behind a "?".
    const more = infoTip("share-profile-connect-more", "More about connecting accounts", CONNECT_DISCLOSURE_MORE);
    const disclosure = h("div", { id: "share-profile-connect-note", hidden: true },
      h("p", { className: "hint connect-disclosure" }, CONNECT_DISCLOSURE_SHORT, " ", more.button),
      more.text);
    const nameInfo = infoTip("share-profile-name-info", "About the profile name",
      "The suggested name for your profile in the recipient's journal.");
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
      // Format 2 accounts connect through contacts, which come later.
      canConnect() ? h("label", { className: "inline share-connect" }, connect, " ", h("strong", {}, "Connect our accounts")) : null,
      canConnect() ? disclosure : null,
      h("div", { className: "label-row" }, h("label", { htmlFor: "share-profile-name" }, "Profile name"), nameInfo.button),
      nameInfo.text,
      name,
      h("fieldset", { className: "share-fields" }, h("legend", {}, "Also share"), fields),
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

    /** @param {string} id */
    const ticked = (id) => /** @type {HTMLInputElement | null} */ (dialog.querySelector(`#share-profile-${id}`))?.checked ?? false;

    /** @param {SubmitEvent} event */
    async function make(event) {
      event.preventDefault();
      submit.disabled = true;
      showMessage(message, "Making the invite…");
      try {
        const profile = buildProfile(me, aliases, {
          name: name.value,
          pronouns: ticked("pronouns"),
          default_role: ticked("default_role"),
          aliases: aliases.flatMap((_, i) => (ticked(`alias-${i}`) ? [i] : [])),
          based_in: ticked("based_in"),
          is_educator: ticked("is_educator"),
          about: ticked("about"),
        });
        const { id, key } = await saveShare({
          kind: "profile", data: profile, label: label.value, expires: expires.value, uses: uses.value, connect: connect.checked,
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
