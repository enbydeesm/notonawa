// Choosing what of my own profile to share: the name to share it under and
// a tickbox for each thing on it. Shared by Share my profile (an invite),
// sharing back on accepting one, and sharing with a connected account from
// their card. Private notes are never offered.

import { h, privateField, infoTip } from "./dom.js";
import { readAliases, PLATFORMS } from "./aliases.js";
import { buildProfile, suggestedName } from "./profile-share.js";
import { keptChoices } from "./contacts/rules.js";
import { roleName } from "./roles.js";
import { capitalise } from "./format.js";

/**
 * @typedef {{ name: string, pronouns: string | null, default_role: string | null, based_in: string | null, is_educator: unknown,
 *   aliases: string | null, about: string | null }} MyProfile mine, as saved, opened
 * @typedef {import("./profile-share.js").SharedProfile} SharedProfile
 */

/**
 * The name field and the tickboxes, and reading them.
 * @param {MyProfile} me
 * @param {string} prefix the ids' start (e.g. "share-profile")
 * @returns {{ nameRow: HTMLElement[], fields: HTMLElement, read: () => { profile: SharedProfile, fields: Record<string, any> } }}
 *   read: the profile to send, and what was chosen, kept for later updates (aliases as themselves); throws if no name
 */
export function profileChoices(me, prefix) {
  const aliases = readAliases(me.aliases);
  const name = privateField(h("input", {
    id: `${prefix}-name`, name: "name", required: true, maxLength: 200, value: suggestedName(me.name),
  }));
  /**
   * A tickbox for one thing to share, showing what it is.
   * @param {string} id
   * @param {string} label
   * @param {string} value
   */
  const tick = (id, label, value) => h("label", { className: "inline share-field" },
    h("input", { type: "checkbox", id: `${prefix}-${id}`, checked: true }),
    h("span", {}, h("strong", {}, label), " ", value));
  const platform = (/** @type {string} */ value) => PLATFORMS.find((p) => p.value === value)?.label ?? "Other";
  const ticks = [
    me.pronouns ? tick("pronouns", "Pronouns:", me.pronouns) : null,
    me.default_role ? tick("default_role", "Usual role:", capitalise(roleName(me.default_role))) : null,
    ...aliases.map((a, i) => tick(`alias-${i}`, `${platform(a.platform)}:`, a.alias)),
    me.based_in ? tick("based_in", "Based in:", me.based_in) : null,
    // Shown either way; only a yes is shared (profile-share.js), so "No"
    // leaves their card for me as they set it.
    tick("is_educator", "Educator:", me.is_educator ? "Yes" : "No"),
    me.about ? tick("about", "About me:", "Your shareable notes about yourself. Your private notes are never shared.") : null,
  ].filter((el) => el !== null);
  const nameInfo = infoTip(`${prefix}-name-info`, "About the profile name", "The suggested name for your profile in the recipient's journal.");
  const fields = h("fieldset", { className: "share-fields" }, h("legend", {}, "Also share"), ticks);
  /** @param {string} id */
  const ticked = (id) => /** @type {HTMLInputElement | null} */ (fields.querySelector(`#${prefix}-${id}`))?.checked ?? false;
  return {
    nameRow: [h("div", { className: "label-row" }, h("label", { htmlFor: `${prefix}-name` }, "Profile name"), nameInfo.button),
      nameInfo.text, name],
    fields,
    read: () => {
      const choices = {
        name: name.value,
        pronouns: ticked("pronouns"),
        default_role: ticked("default_role"),
        aliases: aliases.flatMap((_, i) => (ticked(`alias-${i}`) ? [i] : [])),
        based_in: ticked("based_in"),
        is_educator: ticked("is_educator"),
        about: ticked("about"),
      };
      return { profile: buildProfile(me, aliases, choices), fields: keptChoices(choices, aliases) };
    },
  };
}
