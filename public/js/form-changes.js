// Whether an edit form has changes since it opened: its Save changes is
// clickable only while it has (editing a saved item), and closing it with
// changes asks first. A new item's Save stays clickable.
//
// It compares the form's fields as a whole, rather than tracking each
// edit, so undoing a change (typing a word and deleting it, removing a row
// just added) counts as no change. The Visuals section is left out: on a
// saved item, a visual is saved as soon as it's added.

import { choose } from "./dialog.js";

/**
 * Every field's value in order (whether it's ticked, for checkboxes and
 * radios), and anything else extra() adds (tags, rows with no fields),
 * as one string to compare.
 * @param {HTMLFormElement} form
 * @param {Element | null | undefined} ignore fields inside it are left out
 * @param {(() => unknown) | undefined} extra
 */
function formState(form, ignore, extra) {
  const fields = [...form.elements].filter((el) => !ignore?.contains(el) && !(el instanceof HTMLButtonElement)
    && !(el instanceof HTMLFieldSetElement));
  const values = fields.map((el) => {
    const input = /** @type {HTMLInputElement} */ (el);
    if (input.type === "file") return "";
    return input.type === "checkbox" || input.type === "radio" ? input.checked : input.value;
  });
  return JSON.stringify([values, extra?.() ?? null]);
}

/**
 * Watches a form for changes. Call reset() once it's filled in, to start
 * from there.
 * @param {{
 *   form: HTMLFormElement,
 *   button: HTMLButtonElement,
 *   editing: () => boolean,
 *   ignore?: Element | null,
 *   extra?: () => unknown,
 *   unsaved?: () => boolean,
 *   signal?: AbortSignal,
 * }} options
 *   button: its Save, muted (aria-disabled) while editing a saved item
 *   without changes, and disabled while busy; editing: whether it's a
 *   saved item; ignore: a part whose fields don't count; extra: more of
 *   its state, as JSON; unsaved: counts as changed whatever's in it, while
 *   true (a new item that opened with a pose from the poser in it)
 * @returns {{ changed: () => boolean, canSave: () => boolean, reset: () => void, busy: (on: boolean) => void }}
 */
export function watchChanges({ form, button, editing, ignore, extra, unsaved, signal }) {
  let start = formState(form, ignore, extra);
  let saving = false;
  button.classList.add("save-changes");

  const changed = () => !!unsaved?.() || formState(form, ignore, extra) !== start;
  const canSave = () => !editing() || changed();
  // Muted rather than disabled, so the form's submit still runs and asks
  // canSave() itself: a tap straight after typing can't beat the update.
  const update = () => {
    button.disabled = saving;
    button.setAttribute("aria-disabled", String(!canSave()));
  };
  // After the event's own handlers: a row removed, a pick from a list, a
  // search box going back to its choice when it loses focus.
  const later = () => queueMicrotask(update);
  for (const type of ["input", "change", "click", "focusout"]) form.addEventListener(type, later, { signal });
  // Rows added or removed by code, tags chosen in their own dialog.
  const observer = new MutationObserver(update);
  observer.observe(form, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  signal?.addEventListener("abort", () => observer.disconnect());

  return {
    changed,
    /** Whether Save should do anything: a new item, or a saved one with changes. */
    canSave,
    reset: () => { start = formState(form, ignore, extra); update(); },
    busy: (on) => { saving = on; update(); },
  };
}

/**
 * Makes a form dialog ask before throwing away changes, when it's closed
 * with Esc or with the close function this returns (its ✕).
 * @param {HTMLDialogElement} dialog
 * @param {() => boolean} changed
 * @param {() => Discard | null} [asking] what to ask in place of "Discard
 *   your changes?" (null: that), e.g. for a new item holding a pose
 * @returns {() => Promise<void>} closes it, asking first if there are changes
 */
export function guardClose(dialog, changed, asking) {
  async function close() {
    if (changed() && !(await confirmDiscard(asking?.() ?? undefined))) return;
    dialog.close();
  }
  dialog.addEventListener("cancel", (event) => {
    if (!changed()) return;
    event.preventDefault();
    close();
  });
  return close;
}

/** @typedef {{ title: string, message: string, label: string }} Discard */

/** @type {Discard} */
const DISCARD_CHANGES = {
  title: "Discard your changes?",
  message: "What you've changed since opening it won't be saved.",
  label: "Discard changes",
};

/**
 * Asks whether to throw away what's changed. Resolves true to discard it.
 * @param {Discard} [text]
 */
async function confirmDiscard({ title, message, label } = DISCARD_CHANGES) {
  const choice = await choose({
    title,
    message,
    choices: [{ label, value: "discard", style: "danger" }],
    cancelLabel: "Keep editing",
  });
  return choice === "discard";
}
