// A new tie, plan or workshop made from the poser opened on its own (the
// nav's button), through "Add pose to…" (add-to-picker.js): its form opens
// with the name typed there, the pose (or a picture of it) already in its
// Visuals, waiting like any visual added to a new item, and a bar at the
// top saying it isn't saved yet. Closing it asks first, even with nothing
// else changed, until it's saved (form-changes.js's unsaved).

import { h } from "./dom.js";
import { newEntryText } from "./add-to-choices.js";

/** @typedef {import("./add-to-choices.js").TargetKind} TargetKind */
/** @typedef {import("./pose-format.js").Pose} Pose */

/**
 * What a new item's form starts with. onSaved: once it's saved, with its
 * id and title (so the poser can offer it first next time).
 * @typedef {{
 *   title: string, pose?: Pose, picture?: Blob,
 *   onSaved?: (id: string, title: string) => void,
 * }} EntryStart
 */

/**
 * Fills in a new item's form from the poser.
 * @param {{
 *   start: EntryStart, kind: TargetKind, form: HTMLFormElement, titleInput: HTMLInputElement,
 *   visuals: { startWith: (start: { pose?: Pose, picture?: Blob }) => Promise<void> },
 * }} options
 * @returns {{
 *   unsaved: () => boolean,
 *   discard: () => ReturnType<typeof newEntryText>["discard"] | null,
 *   saved: (id: string) => void,
 * }}
 *   unsaved: whether it's still not saved; discard: what closing asks
 *   while it is; saved: call once the item is saved
 */
export function startEntry({ start, kind, form, titleInput, visuals }) {
  const text = newEntryText(kind, start.pose ? "pose" : "picture");
  let saved = false;
  titleInput.value = start.title;
  // The attribute, not form.id: a field named "id" would be that instead.
  const bar = h("p", { className: "unsaved-bar", role: "status", id: `${form.getAttribute("id")}-unsaved` }, text.bar);
  form.prepend(bar);
  visuals.startWith({ pose: start.pose, picture: start.picture });
  // Until it's saved, not only while the pose is waiting: a picture is
  // still being prepared for a moment before it is.
  const unsaved = () => !saved;
  return {
    unsaved,
    discard: () => (unsaved() ? text.discard : null),
    saved: (id) => {
      if (saved) return;
      saved = true;
      bar.remove();
      start.onSaved?.(id, titleInput.value.trim());
    },
  };
}

/**
 * A new plan from the poser, handed to the Plans view: its form is on that
 * view, so the app goes there (which closes the poser) and the view opens
 * it with this. Only in memory, and taken once.
 * @type {EntryStart | null}
 */
let handedPlan = null;

/** @param {EntryStart} start */
export function handPlanOver(start) {
  handedPlan = start;
}

/** The new plan handed over from the poser, if there is one (once). */
export function takeHandedPlan() {
  const start = handedPlan;
  handedPlan = null;
  return start;
}
