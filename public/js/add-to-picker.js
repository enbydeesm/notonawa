// "Add pose to…": where the poser opened on its own (the nav's button)
// puts a pose (Save pose) or a picture of it (Add to visuals). One sheet
// for ties, plans and workshops: a search box over all three, chips to show
// only one kind, and the list (add-to-choices.js), each marked with its
// tab's icon and kind. The one chosen last comes first, so adding several
// poses to the same one is a tap each. Below, pinned to the sheet's foot
// with the list scrolling under it, + Tie, + Plan and + Workshop make a new
// one, called what was typed when nothing has that title. ✕ closes it.
//
// The last one chosen and the chip are kept in memory only, and forgotten
// on lock.

import { errorMessage } from "./api.js";
import { h, showMessage, privateField } from "./dom.js";
import { onLock } from "./vault.js";
import { iconButton } from "./dialog-icons.js";
import { tabIcon } from "./nav.js";
import { loadTies, loadPlans, loadWorkshops } from "./item-targets.js";
import { TARGET_KINDS, kindName, listChoices, offerNew, newKinds } from "./add-to-choices.js";

/** @typedef {import("./add-to-choices.js").Target} Target */
/** @typedef {import("./add-to-choices.js").TargetKind} TargetKind */
/** @typedef {import("./add-to-choices.js").Filter} Filter */
/** @typedef {{ target: Target } | { create: TargetKind, title: string }} AddChoice */

/** Each kind's tab, for its icon. */
const TABS = /** @type {const} */ ({ tie: "/", plan: "/plans", workshop: "/education" });

/** The one added to last (shown first next time). @type {Target | null} */
let lastTarget = null;
/** The chip chosen last. @type {Filter} */
let lastFilter = "all";
onLock(() => {
  lastTarget = null;
  lastFilter = "all";
});

/**
 * Remembers what a pose was just added to, to offer it first next time.
 * @param {Target} target
 */
export function rememberTarget(target) {
  lastTarget = target;
}

/** Forgets the one remembered, if it's this (it couldn't be added to: deleted). @param {Target} target */
export function forgetTarget(target) {
  if (lastTarget?.kind === target.kind && lastTarget.id === target.id) lastTarget = null;
}

/**
 * The kind's tab icon.
 * @param {TargetKind} kind
 */
export function kindIcon(kind) {
  return tabIcon(TABS[kind]);
}

/**
 * Asks where to add the pose.
 * @param {{ what: "pose" | "picture" }} options what: the pose itself (Save
 *   pose), or a picture of it as a photo (Add to visuals)
 * @returns {Promise<AddChoice | null>} null if cancelled
 */
export function chooseAddTarget({ what }) {
  return new Promise((resolve) => {
    /** @type {Filter} */
    let filter = lastFilter;
    /** @type {AddChoice | null} */
    let result = null;
    /** Ties for the search typed (the newest without one). @type {Target[]} */
    let ties = [];
    /** The ties the device's search found for it. @type {Set<string> | null} */
    let matched = null;
    /** Plans and workshops, loaded once. @type {Target[]} */
    let others = [];
    let loaded = false;
    /** Only the latest search's ties are kept. */
    let searchCount = 0;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let typing;

    const message = h("p", { className: "message", id: "add-to-message", "aria-live": "polite" });
    const listLabel = h("p", { className: "add-to-label", id: "add-to-list-label" });
    const list = h("div", { className: "add-to-list", id: "add-to-list", role: "group", "aria-labelledby": "add-to-list-label" });
    const newLabel = h("p", { className: "add-to-label", id: "add-to-new-label" });
    const newList = h("div", { className: "add-to-new", id: "add-to-new", role: "group", "aria-labelledby": "add-to-new-label" });
    const search = privateField(h("input", {
      id: "add-to-search", type: "search", placeholder: "Search ties, plans, workshops", "aria-label": "Search ties, plans and workshops",
      oninput: () => {
        clearTimeout(typing);
        draw();
        typing = setTimeout(findTies, 250);
      },
    }));
    /** @type {[Filter, string][]} */
    const chips = [["all", "All"], ...TARGET_KINDS.map(([kind, , plural]) => /** @type {[Filter, string]} */ ([kind, plural]))];
    const chipButtons = chips.map(([value, label]) => h("button", {
      type: "button", className: "tool", id: `add-to-filter-${value}`, "aria-pressed": String(value === filter),
      onclick: () => {
        filter = value;
        lastFilter = value;
        for (const [i, b] of chipButtons.entries()) b.setAttribute("aria-pressed", String(chips[i][0] === value));
        draw();
      },
    }, label));

    const dialog = h("dialog", { className: "form-dialog add-to-sheet", "aria-labelledby": "add-to-heading" },
      h("div", { className: "add-to-head" },
        h("span", { className: "pose-icon add-to-icon", "aria-hidden": "true" }),
        h("h2", { id: "add-to-heading" }, "Add pose to…"),
        iconButton("close", { id: "add-to-close", label: "Close", onclick: () => dialog.close() })),
      h("p", { className: "hint" }, what === "pose"
        ? "The pose goes in its visuals, to open in the poser again later."
        : "A picture of the pose, as you see it now, goes in its visuals as a photo."),
      search,
      h("div", { className: "tool-group add-to-filters", role: "group", "aria-label": "Show" }, chipButtons),
      // The list scrolls; the new ones' bar stays at the bottom over it.
      h("div", { className: "add-to-scroll", id: "add-to-scroll" },
        message,
        listLabel,
        list,
        h("div", { className: "add-to-foot", id: "add-to-foot" }, newLabel, newList)));
    dialog.addEventListener("close", () => {
      clearTimeout(typing);
      dialog.remove();
      resolve(result);
    });

    /** @param {AddChoice} choice */
    function pick(choice) {
      result = choice;
      dialog.close();
    }

    /** Everything loaded, with the one chosen last added if it isn't (an older tie). */
    function targets() {
      const all = [...ties, ...others];
      const last = lastTarget;
      if (last && !search.value.trim() && !all.some((t) => t.kind === last.kind && t.id === last.id)) all.push(last);
      return all;
    }

    function draw() {
      const q = search.value.trim();
      const all = targets();
      const shown = loaded ? listChoices({ targets: all, query: q, filter, last: lastTarget }, matched ?? undefined) : [];
      listLabel.textContent = q ? "Matches" : "Recent";
      listLabel.hidden = !loaded || shown.length === 0;
      list.replaceChildren(...shown.map((t) => h("button", {
        type: "button", className: "add-to-row", onclick: () => pick({ target: t }),
        "aria-label": `${kindName(t.kind)}: ${t.title}${t.meta ? `, ${t.meta}` : ""}`,
      },
      kindIcon(t.kind),
      h("span", { className: "item-title" }, t.title),
      t.meta ? h("span", { className: "item-meta" }, t.meta) : null,
      h("span", { className: "badge" }, kindName(t.kind)))));
      if (loaded) {
        showMessage(message, shown.length ? "" : q ? "Nothing matches." : filter === "all" ? "Nothing yet: make one below." : `No ${filter}s yet.`);
      }

      // A new one: called what was typed if nothing has that title.
      const named = loaded && offerNew(all, q, filter);
      newLabel.textContent = named ? `Create “${q}” as a new…` : "Create new";
      newList.classList.toggle("named", named);
      newList.classList.toggle("all-kinds", !named && newKinds(filter).length === TARGET_KINDS.length);
      newList.replaceChildren(...newKinds(filter).map((kind) => h("button", {
        type: "button", className: "add-to-make", id: `add-to-new-${kind}`,
        "aria-label": named ? `New ${kindName(kind).toLowerCase()} called ${q}` : `New ${kindName(kind).toLowerCase()}`,
        onclick: () => pick({ create: kind, title: named ? q : "" }),
      }, h("span", { className: "add-to-plus", "aria-hidden": "true" }, "+"), kindIcon(kind), h("span", {}, kindName(kind)))));
    }

    /** The ties for what's typed (searched on the device), then the list again. */
    async function findTies() {
      const mine = ++searchCount;
      try {
        const found = await loadTies(search.value);
        if (mine !== searchCount) return;
        ties = found.targets;
        matched = found.matched;
        draw();
      } catch (err) {
        if (mine === searchCount) showMessage(message, "Couldn't search the ties: " + errorMessage(err), true);
      }
    }

    async function start() {
      showMessage(message, "Loading…");
      try {
        const mine = ++searchCount;
        const [found, plans, workshops] = await Promise.all([loadTies(search.value), loadPlans(), loadWorkshops()]);
        others = [...plans, ...workshops];
        if (mine === searchCount) {
          ties = found.targets;
          matched = found.matched;
        }
        loaded = true;
        draw();
      } catch (err) {
        showMessage(message, "Couldn't load them: " + errorMessage(err), true);
      }
    }

    document.body.append(dialog);
    dialog.showModal();
    draw();
    start();
  });
}
