// People view: "Add a Person" (the + opens the form in a dialog, as tapping
// a name does), a search over them, and the list. The dialog's heading row
// holds Delete and Archive (or Restore), or on my own profile Share; the
// cards have no buttons.

import { h, $, privateField, showMessage, removeX } from "../dom.js";
import { iconButton } from "../dialog-icons.js";
import { confirmDeleteOrArchive } from "../dialog.js";
import { setupResourcePage } from "../resource-page.js";
import { roleName, roleOptions } from "../roles.js";
import { capitalise } from "../format.js";
import { PLATFORMS, readAliases, aliasesText, akaText } from "../aliases.js";
import { CAP_PATHS } from "../nav.js";
import { aboutField } from "../person-about.js";
import { openShareProfile } from "../share-profile-dialog.js";
import { linkIcon, removeConnection, CONNECTIONS_CHANGED } from "../connections.js";
import { reviewProfileUpdate } from "../profile-update.js";
import { pendingProfile, peopleWithUpdates, contactStatus, peopleWithChangedKeys } from "../store/index.js";
import { showSafetyNumber } from "../contact-verify.js";
import { errorMessage } from "../api.js";

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
  ...CAP_PATHS.map((d) => svg("path", { d })));
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
    const row = h("div", { className: "picker-row removable alias-row" }, platform, name,
      removeX("Remove", () => row.remove()));
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

  // Someone linked to their account, while their dialog is open: Remove link
  // removes the connection for both of us.
  /** @type {any} */
  let linked = null;
  $("#person-linked-icon").replaceWith(linkIcon(null));
  $("#person-unlink").addEventListener("click", async () => {
    if (!linked) return;
    const message = $(".message", $("#form"));
    try {
      if (!(await removeConnection(linked.connection_id, linked.name))) return;
      /** @type {HTMLDialogElement} */ ($("#person-dialog")).close();
    } catch (err) {
      showMessage(message, "Couldn't remove the link: " + errorMessage(err), true);
    }
  }, { signal });
  // A connected account's safety number (format 2), over the list.
  $("#person-verify").addEventListener("click", async () => {
    if (!linked) return;
    const person = linked;
    /** @type {HTMLDialogElement} */ ($("#person-dialog")).close();
    if (await showSafetyNumber(person)) page.reload();
  }, { signal });
  // Their account sent its profile again: reviewed over the list, not the form.
  $("#person-review-update").addEventListener("click", async () => {
    if (!linked) return;
    const person = linked;
    /** @type {HTMLDialogElement} */ ($("#person-dialog")).close();
    if (await reviewProfileUpdate(person)) page.reload();
  }, { signal });

  /** About me on my own profile; on others', what they shared, read-only (person-about.js). */
  function showAbout(/** @type {any} */ person) {
    const about = aboutField(person);
    $("#person-about-field").hidden = !about;
    if (!about) return;
    $("#person-about-label").textContent = about.label;
    $("#person-about-hint").textContent = about.hint;
    /** @type {HTMLTextAreaElement} */ ($("#person-about")).readOnly = about.readOnly;
  }

  // Who has an update waiting or a changed key, read once each time the list is drawn.
  /** @type {WeakMap<object, { updates: Set<string>, changed: Set<string> }>} */
  const marksFor = new WeakMap();

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

    // "This is me" is a badge on my own profile only: it can't be changed
    // (who is me is set at sign-up). Nor can that profile be archived or
    // deleted: the API refuses, so its buttons aren't shown.
    onEdit: (person) => {
      $("#person-self-badge").hidden = !person?.is_self;
      showAbout(person);
      linked = person?.connection_id ? person : null;
      $("#person-linked").hidden = !linked;
      $("#person-review-update").hidden = !(linked && pendingProfile(linked.id));
      const status = linked ? contactStatus(linked.id) : null;
      $("#person-verify").hidden = !status;
      $("#person-verify").textContent = status?.verified && !status.keyChanged ? "Verified ✓" : "Safety number";
      $("#person-key-changed").hidden = !status?.keyChanged;
      aliasRows.replaceChildren();
      for (const alias of readAliases(person?.aliases)) addAliasRow(alias);
    },
    canRemove: (person) => !person.is_self,
    // Share my profile, on my own: an invite to add what's saved, not
    // what's being typed.
    extraActions: (person) => (person.is_self
      ? [iconButton("share", { id: "person-share", label: "Share my profile", onclick: () => openShareProfile(/** @type {any} */ (person)) })]
      : []),
    // Sealed whole, as JSON text (aliases.js).
    prepare: (data) => ({ ...data, aliases: aliasesText(collectAliases()) }),

    // The name (which opens the dialog), pronouns and usual role; then where
    // they're based and their other names. Notes are in the dialog only.
    renderItem: (person, _people, edit) => {
      if (!marksFor.has(_people)) marksFor.set(_people, { updates: peopleWithUpdates(), changed: peopleWithChangedKeys() });
      const { updates, changed } = /** @type {{ updates: Set<string>, changed: Set<string> }} */ (marksFor.get(_people));
      const aka = akaText(readAliases(person.aliases));
      return [
        h("div", { className: "item-title name-title" },
          h("button", { type: "button", className: "name-button", onclick: edit }, person.name),
          person.is_self ? h("span", { className: "badge" }, "You") : null,
          person.pronouns ? h("span", { className: "item-meta" }, person.pronouns) : null,
          person.default_role ? h("span", { className: "tag outline role-tag" }, capitalise(roleName(person.default_role))) : null,
          person.is_educator ? educatorIcon() : null,
          person.connection_id ? linkIcon() : null,
          updates.has(person.id) ? h("span", { className: "badge update-badge" }, "Updated info") : null,
          changed.has(person.id) ? h("span", { className: "badge key-badge" }, "Key changed") : null),
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
  // A connection put on someone, or removed (here, on the banner or in Shared by me).
  window.addEventListener(CONNECTIONS_CHANGED, () => page.reload(), { signal });
}
