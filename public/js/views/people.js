// People view: "Add a Person" (the + opens the form in a dialog, as tapping
// a name does), a search over them, and the list. The dialog holds Archive
// (or Restore) and Delete; the cards have no buttons.

import { h, $, privateField } from "../dom.js";
import { confirmDeleteOrArchive } from "../dialog.js";
import { setupResourcePage } from "../resource-page.js";
import { roleName, roleOptions } from "../roles.js";
import { capitalise } from "../format.js";
import { PLATFORMS, readAliases, aliasesText, akaText } from "../aliases.js";

const SVG = "http://www.w3.org/2000/svg";

/**
 * @param {string} tag
 * @param {Record<string, string | number>} attrs
 * @param {...Node} children
 */
function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  el.append(...children);
  return el;
}

/** A graduation cap, outlined in the accent: an educator. */
function educatorIcon() {
  const title = document.createElementNS(SVG, "title");
  title.textContent = "Educator";
  return svg("svg", {
    viewBox: "0 0 24 24", class: "educator-icon", role: "img", "aria-label": "Educator",
    fill: "none", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round",
  },
  title,
  svg("path", { d: "M2 9.5 12 5l10 4.5L12 14z" }),
  svg("path", { d: "M6 11.5v4.2c0 1.6 2.7 2.8 6 2.8s6-1.2 6-2.8v-4.2" }),
  svg("path", { d: "M22 9.5v5" }));
}

/**
 * @param {HTMLElement} _root
 * @param {{ signal: AbortSignal }} options
 */
export function mount(_root, { signal }) {
  // Filled in when they're added to a tie (still changeable there).
  $("#person-default_role").append(...roleOptions().map((r) => h("option", { value: r.value }, r.label)));

  // Social and scene names: a platform and a name per row. The rows have no
  // name attributes, so the page's form reading skips them; prepare reads them.
  const aliasRows = $("#person-aliases");
  let aliasCount = 0;

  /** @param {import("../aliases.js").Alias} [alias] */
  function addAliasRow(alias) {
    const n = ++aliasCount;
    const platform = h("select", { className: "alias-platform", "aria-label": `Platform ${n}` },
      PLATFORMS.map((p) => h("option", { value: p.value }, p.label)));
    const name = privateField(h("input", {
      type: "text", className: "alias-name", placeholder: "Name or handle", "aria-label": `Name or handle ${n}`,
      autocapitalize: "none",
    }));
    if (alias) {
      platform.value = alias.platform;
      name.value = alias.alias;
    }
    const row = h("div", { className: "picker-row alias-row" }, platform, name,
      h("button", { type: "button", "aria-label": "Remove", onclick: () => row.remove() }, "✕"));
    aliasRows.append(row);
    return platform;
  }

  /** The rows' aliases; empty ones are dropped (tidyAliases). */
  function collectAliases() {
    return [...aliasRows.querySelectorAll(".alias-row")].map((row) => ({
      platform: /** @type {HTMLSelectElement} */ ($(".alias-platform", /** @type {HTMLElement} */ (row))).value,
      alias: /** @type {HTMLInputElement} */ ($(".alias-name", /** @type {HTMLElement} */ (row))).value,
    }));
  }

  $("#person-add-alias").addEventListener("click", () => addAliasRow().focus(), { signal });

  const page = setupResourcePage({
    resource: "people",
    signal,
    form: $("#form"),
    list: $("#list"),
    archivedToggle: $("#show-archived"),
    dialog: $("#person-dialog"),
    actionsInDialog: true,
    // My own profile stays at the top, whatever the order.
    searchable: { noun: "people", pinned: (person) => !!person.is_self, slot: $("#people-search") },

    // "This is me" is shown only on my own profile, and can't be changed
    // (who is me is set at sign-up). Nor can that profile be archived or
    // deleted: the API refuses, so its buttons aren't shown.
    onEdit: (person) => {
      $("#person-self-flag").hidden = !person?.is_self;
      aliasRows.replaceChildren();
      for (const alias of readAliases(person?.aliases)) addAliasRow(alias);
    },
    canRemove: (person) => !person.is_self,
    // Sealed whole, as JSON text (aliases.js).
    prepare: (data) => ({ ...data, aliases: aliasesText(collectAliases()) }),

    // The name (which opens the dialog), pronouns and usual role; then where
    // they're based and their other names. Notes are in the dialog only.
    renderItem: (person, _people, edit) => {
      const aka = akaText(readAliases(person.aliases));
      return [
        h("div", { className: "item-title name-title" },
          h("button", { type: "button", className: "name-button", onclick: edit }, person.name),
          person.is_self ? h("span", { className: "badge" }, "You") : null,
          person.pronouns ? h("span", { className: "item-meta" }, person.pronouns) : null,
          person.default_role ? h("span", { className: "tag outline role-tag" }, capitalise(roleName(person.default_role))) : null,
          person.is_educator ? educatorIcon() : null),
        person.based_in ? h("div", { className: "item-meta" }, `based in ${person.based_in}`) : null,
        aka ? h("div", { className: "item-meta" }, aka) : null,
      ];
    },

    confirmDelete: (person) =>
      confirmDeleteOrArchive({
        title: `Delete ${person.name}?`,
        message: `This can't be undone. Ties they were in will show "(person deleted)".` +
          (person.archived_at ? "" : " If you just won't tie with them again, archive them instead."),
        archived: !!person.archived_at,
      }),
  });

  $("#add-person").addEventListener("click", () => page.add(), { signal });
}
