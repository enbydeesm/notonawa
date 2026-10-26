// "Share my profile": choosing what of my own profile to put in an invite,
// for how long and for whom, then making it (sealed on this device with a
// key that's only in its link) and showing its code. See
// considerations.md, "Sharing between accounts".

import { api, errorMessage } from "./api.js";
import { h, showMessage, privateField } from "./dom.js";
import { sealShare, sealOne } from "./vault.js";
import { newShareId } from "./crypto/share.js";
import { toBase64url } from "./crypto/keys.js";
import { readAliases, PLATFORMS } from "./aliases.js";
import { buildProfile, suggestedName } from "./profile-share.js";
import { EXPIRY_CHOICES, DEFAULT_EXPIRY, USE_CHOICES, maxUsesFor, shareWarning } from "./share-options.js";
import { showShareCode } from "./share-code.js";
import { CONNECT_DISCLOSURE } from "./connection-text.js";
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
      me.is_educator ? tick("is_educator", "Educator", "") : null,
      me.about ? tick("about", "About me:", me.about.length > 80 ? `${me.about.slice(0, 80)}…` : me.about) : null,
    ].filter(Boolean);
    const expires = h("select", { id: "share-profile-expires" },
      EXPIRY_CHOICES.map((c) => h("option", { value: c.value, selected: c.value === DEFAULT_EXPIRY }, c.label)));
    const uses = h("select", { id: "share-profile-uses" }, USE_CHOICES.map((c) => h("option", { value: c.value }, c.label)));
    // Connect our accounts: unticked, with what it means shown once it's ticked.
    const connect = h("input", { type: "checkbox", id: "share-profile-connect" });
    const disclosure = h("p", { className: "hint connect-disclosure", id: "share-profile-connect-note", hidden: true }, CONNECT_DISCLOSURE);
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
    const label = privateField(h("input", { id: "share-profile-label", name: "label", maxLength: 100 }));
    const message = h("p", { className: "message", id: "share-profile-status" });
    const submit = h("button", { type: "submit", className: "primary", id: "share-profile-make" }, "Make invite");

    const form = h("form", { onsubmit: make },
      h("p", { className: "hint" }, "Someone you invite can add your profile to their People. Your private notes are never shared."),
      h("label", { htmlFor: "share-profile-name" }, "Name to share"),
      name,
      h("p", { className: "hint" }, "What they'll see you as in their People."),
      fields.length
        ? h("fieldset", { className: "share-fields" }, h("legend", {}, "Also share"), fields)
        : h("p", { className: "hint", id: "share-profile-nothing" }, "There's nothing else on your profile to share yet."),
      h("div", { className: "row" },
        h("div", {}, h("label", { htmlFor: "share-profile-expires" }, "Lasts"), expires),
        h("div", {}, h("label", { htmlFor: "share-profile-uses" }, "Who can use it"), uses)),
      h("label", { className: "inline share-connect" }, connect, " Connect our accounts"),
      disclosure,
      warning,
      h("label", { htmlFor: "share-profile-label" }, "Name for this invite (optional)"),
      label,
      h("p", { className: "hint" }, "Only you see this, in Your data, Shared by me."),
      submit,
      h("button", { type: "button", className: "dialog-cancel", id: "share-profile-cancel", onclick: () => dialog.close() }, "Cancel"),
      message);

    const dialog = h("dialog", { className: "form-dialog share-profile", "aria-labelledby": "share-profile-heading" },
      h("h2", { id: "share-profile-heading" }, "Share my profile"),
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
        const id = newShareId();
        // Sealed with its own key, for the link; that key and my name for
        // the invite sealed with mine, so I can show the code again.
        const { key, body } = await sealShare(id, "profile", profile);
        const sealed = await sealOne("share", { label: label.value, link_key: key });
        await api("/api/shares", { method: "POST", body: {
          id, kind: "profile", label: sealed.label, link_key: sealed.link_key,
          expires: expires.value, max_uses: maxUsesFor(uses.value), snapshot: toBase64url(body), connect: connect.checked,
        } });
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
