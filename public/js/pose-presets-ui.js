// Naming a saved preset, to save it or to rename it, from the poser's
// preset pickers (preset-picker.js). It opens over the picker, as the
// poser's other questions do (dialog.js).

import { h, privateField, showMessage } from "./dom.js";
import { errorMessage } from "./api.js";

/** The longest name, in characters. */
export const MAX_NAME = 60;

/**
 * Asks for a preset's name, and saves with it (save is run before the
 * dialog closes, so a failure is shown in it). With `also`, a checkbox
 * under the name, unticked, asks whether to save the other kind too.
 * @param {{ title: string, value?: string, action: string, also?: string,
 *   save: (name: string, also: boolean) => Promise<void> }} options
 * @returns {Promise<boolean>} whether it was saved
 */
export function askPresetName({ title, value = "", action, also, save }) {
  return new Promise((resolve) => {
    let saved = false;
    const input = privateField(h("input", { type: "text", id: "pose-preset-name", maxLength: MAX_NAME, required: true, value }));
    const message = h("p", { className: "message", id: "pose-preset-message", "aria-live": "polite" });
    const saveButton = h("button", { type: "submit", className: "primary", id: "pose-preset-save" }, action);
    const alsoBox = h("input", { type: "checkbox", id: "pose-preset-also" });
    const form = h("form", { method: "dialog" },
      h("label", { htmlFor: "pose-preset-name" }, "Name"), input,
      also ? h("label", { className: "inline preset-also" }, alsoBox, " ", also) : null, message,
      h("div", { className: "dialog-buttons" }, saveButton,
        h("button", { type: "button", id: "pose-preset-cancel", onclick: () => dialog.close() }, "Cancel")));
    const dialog = h("dialog", { "aria-labelledby": "pose-preset-title", onclose: () => { dialog.remove(); resolve(saved); } },
      h("h2", { id: "pose-preset-title" }, title), form);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) {
        showMessage(message, "Give it a name.", true);
        return;
      }
      saveButton.disabled = true;
      showMessage(message, "Saving…");
      try {
        await save(name, alsoBox.checked);
        saved = true;
        dialog.close();
      } catch (err) {
        showMessage(message, `Couldn't save: ${errorMessage(err)}`, true);
        saveButton.disabled = false;
      }
    });
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}
