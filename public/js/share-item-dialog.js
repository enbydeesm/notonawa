// "Share" on a tie, plan or workshop: choosing what of it to put in a share,
// for how long and for whom, then making it (sealed on this device with a
// key that's only in its link) and showing its code. It's a copy of the
// item as last saved. See considerations.md, "Sharing between accounts".

import { api, errorMessage } from "./api.js";
import { h, showMessage, privateField, infoTip } from "./dom.js";
import { open, openMedia } from "./vault.js";
import {
  FIELDS, ALWAYS_SHARED, SHARE_LEGEND, itemSource, hasField, buildItemShare, shareFiles, visualCounts, mediaSize,
} from "./share-item.js";
import { suggestedName } from "./profile-share.js";
import { mergeVisuals } from "./visual-order.js";
import { EXPIRY_CHOICES, DEFAULT_EXPIRY, USE_CHOICES, shareWarning } from "./share-options.js";
import { saveShare } from "./share-save.js";
import { showShareCode } from "./share-code.js";
import { roleName } from "./roles.js";
import { capitalise } from "./format.js";
import { PLAN_TYPE_NAMES } from "./plans-view.js";

/** @typedef {import("./share-item.js").ItemKind} ItemKind */
/** @typedef {import("./share-item.js").SharedItem} SharedItem */

const NOUNS = /** @type {Record<ItemKind, string>} */ ({ tie: "tie", plan: "plan", workshop: "workshop" });

/**
 * Opens the Share dialog for one of my ties, plans or workshops (as its
 * form has it, opened). Loads what the form doesn't have first (my
 * profile, the location's place, the drawings and poses), so it throws if
 * those can't be loaded. Resolves when it's closed.
 * @param {ItemKind} kind
 * @param {Record<string, any>} item
 * @returns {Promise<void>}
 */
export async function openShareItem(kind, item) {
  const source = await loadSource(kind, item);
  return new Promise((resolve) => {
    const noun = NOUNS[kind];
    // Ids start with "share-item-": this opens over the item's own form.
    const self = source.people.find((p) => p.sender);
    const myName = self ? privateField(h("input", {
      id: "share-item-my-name", name: "my_name", maxLength: 200, value: self.name,
    })) : null;
    const offered = FIELDS[kind].filter((f) => hasField(source, f.key));
    const fields = offered.map((f) => h("label", { className: "inline share-field" },
      h("input", { type: "checkbox", id: `share-item-${f.key}`, checked: true }),
      h("span", {}, h("strong", {}, `${f.label}${shown(source, f.key) ? ":" : ""}`), " ", shown(source, f.key))));
    const expires = h("select", { id: "share-item-expires" },
      EXPIRY_CHOICES.map((c) => h("option", { value: c.value, selected: c.value === DEFAULT_EXPIRY }, c.label)));
    const uses = h("select", { id: "share-item-uses" }, USE_CHOICES.map((c) => h("option", { value: c.value }, c.label)));
    const warning = h("p", { className: "warning-note", id: "share-item-warning", hidden: true });
    const showWarning = () => {
      const text = shareWarning(expires.value, uses.value);
      warning.hidden = !text;
      warning.textContent = text ?? "";
    };
    expires.addEventListener("change", showWarning);
    uses.addEventListener("change", showWarning);
    const label = privateField(h("input", { id: "share-item-label", name: "label", required: true, maxLength: 100 }));
    // The explanations, each behind a "?", as on Share my profile.
    const aboutInfo = infoTip("share-item-intro", `About sharing a ${noun}`,
      `Someone you share it with can add a copy of this ${noun} to their journal. Changing yours later doesn't change theirs.`);
    const nameInfo = infoTip("share-item-my-name-info", "About your profile name",
      `The name shared for the 'Me' rows on this ${noun}.`);
    const tagInfo = infoTip("share-item-label-info", "About the share tag",
      "Provides context for you in Your data (Shared by me). e.g. who you're sharing it with.");
    const message = h("p", { className: "message", id: "share-item-status" });
    const submit = h("button", { type: "submit", className: "primary", id: "share-item-make" }, "Make share link");

    const form = h("form", { onsubmit: make },
      aboutInfo.text,
      myName ? h("div", { className: "label-row" },
        h("label", { htmlFor: "share-item-my-name" }, "Your profile name"), nameInfo.button) : null,
      myName ? nameInfo.text : null,
      myName,
      // What's always shared, in the legend; with nothing to tick, said instead.
      offered.length
        ? h("fieldset", { className: "share-fields" }, h("legend", { id: "share-item-always" }, SHARE_LEGEND[kind]), fields)
        : h("p", { className: "hint", id: "share-item-always" }, ALWAYS_SHARED[kind]),
      hasField(source, "media") ? h("p", { className: "hint", id: "share-item-media-size" },
        `Photos and videos are copied into the share, taking ${mediaSize(source.visuals)} of your 1 GB until it ends.`) : null,
      h("div", { className: "row" },
        h("div", {}, h("label", { htmlFor: "share-item-expires" }, "Share link lasts"), expires),
        h("div", {}, h("label", { htmlFor: "share-item-uses" }, "Who can use it"), uses)),
      warning,
      h("div", { className: "label-row" }, h("label", { htmlFor: "share-item-label" }, "Share tag"), tagInfo.button),
      tagInfo.text,
      label,
      submit,
      h("button", { type: "button", className: "dialog-cancel", id: "share-item-cancel", onclick: () => dialog.close() }, "Cancel"),
      message);

    const dialog = h("dialog", { className: "form-dialog share-item", "aria-labelledby": "share-item-heading" },
      h("div", { className: "label-row heading-tip" }, h("h2", { id: "share-item-heading" }, `Share ${noun}`), aboutInfo.button),
      form);
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve();
    });

    /** @param {SubmitEvent} event */
    async function make(event) {
      event.preventDefault();
      submit.disabled = true;
      showMessage(message, "Making the share link…");
      try {
        const ticked = offered.filter((f) => /** @type {HTMLInputElement} */ (dialog.querySelector(`#share-item-${f.key}`)).checked)
          .map((f) => f.key);
        const named = myName ? {
          ...source, people: source.people.map((p) => (p.sender ? { ...p, name: myName.value.trim() } : p)),
        } : source;
        const data = buildItemShare(kind, named, ticked);
        const { id, key } = await saveShare({
          kind, data, label: label.value, expires: expires.value, uses: uses.value, files: shareFiles(source, data),
          progress: (done, total) => showMessage(message, `Sealing photos and videos… ${done + 1} of ${total}`),
        });
        dialog.close();
        await showShareCode({ id, key, title: `Your ${noun}`, note: shareWarning(expires.value, uses.value) ?? undefined });
      } catch (err) {
        showMessage(message, "Couldn't share it: " + errorMessage(err), true);
        submit.disabled = false;
      }
    }

    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * What the item has to share, with what its form doesn't have loaded: my
 * profile (to mark me), its location's place, and its visuals (captions
 * opened) in their order. Each photo and video gets a new random id for
 * the share, so nothing ties it to the one in my journal.
 * @param {ItemKind} kind
 * @param {Record<string, any>} item
 * @returns {Promise<SharedItem>}
 */
async function loadSource(kind, item) {
  const where = new URLSearchParams({ [`${kind}_id`]: item.id });
  const hasPeople = kind !== "plan" && [...(item.participants ?? []), ...(item.educators ?? [])].length > 0;
  /** @type {[any[], any[], any[], any[], any[]]} */
  const [people, locations, media, drawings, poses] = await Promise.all([
    hasPeople ? api("/api/people?archived=false") : [],
    item.location_id ? api("/api/locations?archived=all") : [],
    api(`/api/media?${where}`).then((list) => openMedia(list)),
    api(`/api/drawings?${where}`).then((list) => open("drawing", list)),
    api(`/api/poses?${where}`).then((list) => open("pose", list)),
  ]);
  const self = people.find((/** @type {any} */ p) => p.is_self) ?? null;
  /** @type {import("./share-item.js").SharedVisual[]} */
  const visuals = mergeVisuals({ media, drawing: drawings, pose: poses }).map(({ kind: k, item: v }) => (k === "media"
    ? { kind: v.kind, file: crypto.randomUUID(), mime: v.mime, caption: v.caption ?? null, mediaId: v.id, bytes: v.bytes }
    : { kind: k, data: v.data, caption: v.caption ?? null }));
  return itemSource(kind, item, {
    selfId: self?.id ?? null,
    myName: self ? suggestedName(self.name) : "",
    location: locations.find((/** @type {any} */ l) => l.id === item.location_id) ?? null,
    visuals,
  });
}

/**
 * What a field holds, shortly, beside its tickbox ("" for long text).
 * @param {SharedItem} source
 * @param {string} key
 * @returns {string}
 */
function shown(source, key) {
  switch (key) {
    case "title": return source.title ?? "";
    case "duration_minutes": return String(source.duration_minutes);
    case "success_rating": case "rating": case "est_difficulty": return `${source[key]}/5`;
    case "attendee_count": return String(source.attendee_count);
    case "plan_type": return PLAN_TYPE_NAMES[/** @type {keyof typeof PLAN_TYPE_NAMES} */ (source.plan_type)] ?? "";
    case "tie_type": return capitalise(source.tie_type ?? "");
    case "location": return source.location?.name ?? "";
    case "plans": case "tags": return source[key].join(", ");
    case "people": return source.people.map((p) => `${p.sender ? "you" : p.name} (${roleName(p.role)})`).join(", ");
    case "visuals": return visualCounts(source.visuals, ["drawing", "pose"]);
    case "media": return visualCounts(source.visuals, ["photo", "video"]);
    default: return "";
  }
}
