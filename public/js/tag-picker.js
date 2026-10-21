// The "Edit tags" dialog, opened from the "Log a tie" and Plans forms (ties
// and plans share my tags): search my tags, pick some, type a new one and
// press +, or delete one I don't use any more. The Ties and Plans searches
// open it too (forSearch), only to pick tags already on a tie (or a plan):
// any other can't match one, and deleting tags isn't what a search is for.

import { api, errorMessage } from "./api.js";
import { h, showMessage } from "./dom.js";
import { choose } from "./dialog.js";
import { filterTags, findTag, deleteTagWarning, MAX_TAGS, MAX_TAG_LENGTH } from "./tags.js";

/** @typedef {import("./tags.js").Tag} Tag */

/**
 * Opens the dialog with these tags already chosen. Resolves with the chosen
 * tag names on OK, or null if it's closed with Esc (nothing changes). Deleting
 * a tag is saved straight away, whichever way it closes.
 * @param {string[]} chosen
 * @param {{ forSearch?: boolean, noun?: "tie" | "plan" | "workshop" }} [options]
 *   forSearch: pick tags on ties (or plans, or workshops) only (no adding or deleting)
 *   noun: what the tags are for: which ones a search lists, and the limit's message
 * @returns {Promise<string[] | null>}
 */
export function pickTags(chosen, { forSearch = false, noun = "tie" } = {}) {
  return new Promise((resolve) => {
    /** @type {string[] | null} */
    let result = null;
    /** @type {Tag[]} */
    let tags = [];
    // Names, in the order they were picked.
    let selected = [...chosen];

    // Ids start with "tags-": this opens over the tie form and a page.
    const message = h("p", { className: "message", id: "tags-message" });
    const input = h("input", {
      // Tags are usually lowercase, so phone keyboards shouldn't start with a capital.
      id: "tags-search", type: "text", autocomplete: "off", autocapitalize: "none", "aria-label": "Search tags",
      maxLength: MAX_TAG_LENGTH, oninput: renderList, onkeydown: onSearchKey,
    });
    // No autocorrect or spellcheck either: rope terms like "futomomo" aren't
    // in the dictionary. Set as attributes because h() skips false values, and
    // where autocorrect is a true/false property "off" would turn it on.
    input.setAttribute("autocorrect", "off");
    input.setAttribute("spellcheck", "false");
    const searchBox = h("div", { className: "tag-search" });
    const list = h("div", { className: "tag-list", id: "tags-list" });

    const dialog = h("dialog", { className: "form-dialog", "aria-labelledby": "tags-heading" },
      h("h2", { id: "tags-heading" }, forSearch ? "Choose tags" : "Edit tags"),
      h("div", { className: "tag-search-row" },
        searchBox,
        forSearch ? null
          : h("button", { type: "button", className: "tag-add", id: "tags-add", "aria-label": "Add tag", title: "Add tag", onclick: addTyped }, "+")),
      list,
      message,
      h("div", { className: "dialog-footer" },
        h("button", { type: "button", id: "tags-ok", onclick: () => { result = selected; dialog.close(); } }, "OK"))
    );
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(result);
    });

    /** @param {string} name */
    const isSelected = (name) => selected.includes(name);

    /** @param {string} name */
    function select(name) {
      if (isSelected(name)) return;
      if (selected.length >= MAX_TAGS) {
        showMessage(message, forSearch ? `Choose up to ${MAX_TAGS} tags.` : `A ${noun} can have up to ${MAX_TAGS} tags.`, true);
        return;
      }
      selected.push(name);
    }

    /** @param {string} name */
    function deselect(name) {
      selected = selected.filter((n) => n !== name);
    }

    function render() {
      renderSearchBox();
      renderList();
    }

    // The chosen tags sit in the search box, before where you type.
    function renderSearchBox() {
      searchBox.replaceChildren(
        searchIcon(),
        ...selected.map((name) =>
          h("span", { className: "tag selected" }, name,
            h("button", {
              type: "button", className: "tag-x", "aria-label": `Remove ${name}`,
              onclick: () => { deselect(name); render(); input.focus(); },
            }, "×"))),
        input
      );
      input.placeholder = selected.length ? "" : "search tags";
    }

    function renderList() {
      const shown = filterTags(tags, input.value);
      list.replaceChildren(
        ...shown.map((tag) => {
          const on = isSelected(tag.name);
          return h("span", { className: on ? "tag selected" : "tag" },
            h("button", {
              type: "button", className: "tag-toggle", "aria-pressed": String(on),
              onclick: () => { if (on) deselect(tag.name); else select(tag.name); render(); },
            }, tag.name),
            // Only unselected tags can be deleted, so a tag can't vanish from
            // the tie you're picking for.
            on || forSearch ? null : h("button", {
              type: "button", className: "tag-x", "aria-label": `Delete ${tag.name}`,
              onclick: () => confirmDelete(tag),
            }, "×"));
        })
      );
      if (shown.length === 0) {
        const hint = forSearch
          ? (tags.length ? "No matching tags." : "No tags yet. Add them to a tie first.")
          : (tags.length ? "No matches. Press + to add it." : "No tags yet. Type one and press +.");
        list.append(h("p", { className: "hint" }, hint));
      }
    }

    /** @param {KeyboardEvent} e */
    function onSearchKey(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        addTyped();
      } else if (e.key === "Backspace" && input.value === "" && selected.length) {
        selected.pop();
        render();
      }
    }

    // Picks the tag typed in the search box, creating it if it's new. New
    // tags go first in the list so they're in view; they're saved with the tie.
    // In a search, only an existing tag can be picked.
    function addTyped() {
      const name = input.value.trim();
      if (!name) {
        input.focus();
        return;
      }
      showMessage(message, "");
      let tag = findTag(tags, name);
      if (!tag && forSearch) return;
      if (!tag) {
        tag = { id: null, name, tie_count: 0, plan_count: 0, workshop_count: 0 };
        tags.unshift(tag);
      }
      select(tag.name);
      input.value = "";
      render();
      input.focus();
    }

    /** @param {Tag} tag */
    async function confirmDelete(tag) {
      const choice = await choose({
        title: `Delete tag '${tag.name}'?`,
        message: deleteTagWarning(tag.tie_count, tag.plan_count, tag.workshop_count),
        choices: [{ label: "Confirm", value: "delete", style: "solid-danger" }],
      });
      if (choice !== "delete") return;
      try {
        if (tag.id) await api(`/api/tags/${encodeURIComponent(tag.id)}`, { method: "DELETE" });
        tags = tags.filter((t) => t !== tag);
        showMessage(message, "");
        renderList();
      } catch (err) {
        showMessage(message, "Couldn't delete: " + errorMessage(err), true);
      }
    }

    async function loadTags() {
      try {
        /** @type {Tag[]} */
        const mine = await api("/api/tags");
        tags = forSearch ? mine.filter((t) => t[`${noun}_count`] > 0) : mine;
      } catch (err) {
        showMessage(message, "Couldn't load tags: " + errorMessage(err), true);
      }
      // Chosen tags not saved yet (typed last time the dialog was open) go first.
      // A search only ever holds saved tags.
      if (!forSearch) {
        for (const name of [...selected].reverse()) {
          if (!findTag(tags, name)) tags.unshift({ id: null, name, tie_count: 0, plan_count: 0, workshop_count: 0 });
        }
      }
      renderList();
    }

    document.body.append(dialog);
    render();
    dialog.showModal();
    input.focus();
    loadTags();
  });
}

// A magnifying glass, drawn in the text color.
function searchIcon() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "tag-search-icon");
  const circle = document.createElementNS(ns, "circle");
  circle.setAttribute("cx", "10"); circle.setAttribute("cy", "10"); circle.setAttribute("r", "6.5");
  const line = document.createElementNS(ns, "path");
  line.setAttribute("d", "M15 15l5.5 5.5");
  svg.append(circle, line);
  return svg;
}
