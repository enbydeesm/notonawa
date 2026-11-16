// Merging a profile someone shared into a card I have, field by field:
// theirs or mine, and their social and scene names added, swapped in or
// left. Shared by adding an invite to someone (open-profile.js) and
// reviewing a connected account's update (profile-update.js). What they
// shared comes from another account: it's shown as text only.

import { h, privateField } from "./dom.js";
import { fieldChoices, newAliases, mergedPerson } from "./contact-merge.js";
import { roleName } from "./roles.js";
import { akaText } from "./aliases.js";
import { capitalise, today } from "./format.js";

/** @typedef {import("./profile-share.js").SharedProfile} SharedProfile */

/**
 * What they shared, as a card.
 * @param {SharedProfile} profile
 * @param {string} [prefix] the ids' start
 */
export function profileCard(profile, prefix = "open") {
  const aka = akaText(profile.aliases ?? []);
  return h("div", { className: "item shared-profile", id: `${prefix}-profile` },
    h("div", { className: "item-title name-title" },
      h("span", { id: `${prefix}-name` }, profile.name),
      profile.pronouns ? h("span", { className: "item-meta" }, profile.pronouns) : null,
      profile.default_role ? h("span", { className: "tag outline role-tag" }, capitalise(roleName(profile.default_role))) : null,
      profile.is_educator ? h("span", { className: "badge" }, "Educator") : null),
    profile.based_in ? h("div", { className: "item-meta" }, `based in ${profile.based_in}`) : null,
    aka ? h("div", { className: "item-meta" }, aka) : null,
    profile.about ? h("p", { className: "item-notes shared-about" }, profile.about) : null);
}

/**
 * The merge's fields, and the card they make once chosen.
 * @param {{ root: HTMLElement, person: any, profile: SharedProfile, prefix: string }} merge root: where the
 *   fields will be (read when record is called); person: mine, opened; prefix: the ids' and names' start
 * @returns {{ elements: HTMLElement[], record: () => Record<string, any> }}
 */
export function mergeFields({ root, person, profile, prefix }) {
  const choices = fieldChoices(person, profile, (role) => capitalise(roleName(role)));
  /**
   * Radio buttons: theirs or mine.
   * @param {string} name
   * @param {[string, string, boolean][]} options value, label, checked
   */
  const radios = (name, options) => options.map(([value, label, checked]) => h("label", { className: "inline" },
    privateField(h("input", { type: "radio", name, value, checked })), label));
  const rows = choices.map((c) => h("fieldset", { className: "merge-field", id: `${prefix}-merge-${c.field}` },
    h("legend", {}, c.label),
    radios(`${prefix}-${c.field}`, [
      ["theirs", `Use theirs: ${c.theirs}`, c.choice === "theirs"],
      ["mine", c.mine ? `Keep yours: ${c.mine}` : "Keep yours (empty)", c.choice === "mine"],
    ])));
  const extra = newAliases(person, profile);
  const aliasRow = profile.aliases?.length
    ? h("fieldset", { className: "merge-field", id: `${prefix}-merge-aliases` },
      h("legend", {}, "Social & scene names"),
      radios(`${prefix}-aliases`, [
        ["add", extra.length ? `Add their ${extra.length} new one${extra.length === 1 ? "" : "s"} to yours` : "Add theirs (you have them all)", true],
        ["replace", "Replace yours with theirs", false],
        ["keep", "Keep yours only", false],
      ]))
    : null;
  const chosen = (/** @type {string} */ name) =>
    /** @type {HTMLInputElement | null} */ (root.querySelector(`input[name="${name}"]:checked`))?.value;
  const elements = [
    rows.length || aliasRow ? null : h("p", { className: "hint" }, "Nothing they shared differs from your card."),
    ...rows,
    aliasRow,
    h("p", { className: "hint", id: `${prefix}-about-note` }, profile.about
      ? "Their About replaces what's in About them on the card."
      : "They didn't share an About: the card's stays as it is."),
    h("p", { className: "hint" }, "Your private notes about them stay as they are."),
  ].filter((el) => el !== null);
  return {
    elements: /** @type {HTMLElement[]} */ (elements),
    record: () => {
      const picked = choices.map((c) => ({ ...c, choice: /** @type {"mine" | "theirs"} */ (chosen(`${prefix}-${c.field}`) ?? c.choice) }));
      const aliases = /** @type {import("./contact-merge.js").AliasChoice} */ (chosen(`${prefix}-aliases`) ?? "keep");
      return mergedPerson(person, profile, picked, aliases, today());
    },
  };
}
