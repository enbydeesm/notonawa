// The poser's dialogs for saved presets: naming one (to save it, or to
// rename it) and "Manage my presets" (renaming and deleting them). Each
// opens over the poser, as its other questions do (dialog.js).

import { h, privateField, showMessage } from "./dom.js";
import { choose } from "./dialog.js";
import { errorMessage } from "./api.js";
import { savedPresets, renamePreset, deletePreset, presetLabel } from "./pose-presets.js";

/** The longest name, in characters. */
export const MAX_NAME = 60;

const KIND_NAMES = /** @type {const} */ ({ body: "Body", arms: "Arms" });

/**
 * Asks for a preset's name, and saves with it (save is run before the
 * dialog closes, so a failure is shown in it).
 * @param {{ title: string, value?: string, action: string, save: (name: string) => Promise<void> }} options
 * @returns {Promise<boolean>} whether it was saved
 */
export function askPresetName({ title, value = "", action, save }) {
  return new Promise((resolve) => {
    let saved = false;
    const input = privateField(h("input", { type: "text", id: "pose-preset-name", maxLength: MAX_NAME, required: true, value }));
    const message = h("p", { className: "message", id: "pose-preset-message", "aria-live": "polite" });
    const saveButton = h("button", { type: "submit", className: "primary", id: "pose-preset-save" }, action);
    const form = h("form", { method: "dialog" },
      h("label", { htmlFor: "pose-preset-name" }, "Name"), input, message,
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
        await save(name);
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

/**
 * "Manage my presets": each saved preset, body ones then arms ones, with
 * Rename and Delete.
 * @param {() => void} changed called after each rename or delete, so the
 *   poser's menus show it
 * @returns {Promise<void>} once closed
 */
export function managePresets(changed) {
  return new Promise((resolve) => {
    const list = h("div", { className: "preset-list", id: "pose-preset-list" });
    const message = h("p", { className: "message", "aria-live": "polite" });
    const dialog = h("dialog", { "aria-labelledby": "pose-presets-title", onclose: () => { dialog.remove(); resolve(); } },
      h("h2", { id: "pose-presets-title" }, "My presets"), list, message,
      h("div", { className: "dialog-buttons" }, h("button", { type: "button", id: "pose-presets-done", onclick: () => dialog.close() }, "Done")));

    async function draw() {
      const presets = await savedPresets();
      if (presets.length === 0) {
        list.replaceChildren(h("p", { className: "hint" }, "No presets yet. Save one from the Body… or Arms… menu."));
        return;
      }
      list.replaceChildren(...(/** @type {const} */ (["body", "arms"])).flatMap((kind) => {
        const mine = presets.filter((p) => p.kind === kind);
        if (mine.length === 0) return [];
        return [h("h3", { className: "preset-kind" }, KIND_NAMES[kind]), ...mine.map((preset) => h("div", { className: "preset-row" },
          h("span", { className: "preset-name" }, presetLabel(preset)),
          h("button", { type: "button", className: "link", "aria-label": `Rename ${presetLabel(preset)}`, onclick: async () => {
            const done = await askPresetName({
              title: "Rename preset", value: preset.name ?? "", action: "Rename", save: (name) => renamePreset(preset.id, name),
            });
            if (done) {
              changed();
              await draw();
            }
          } }, "Rename"),
          h("button", { type: "button", className: "link", "aria-label": `Delete ${presetLabel(preset)}`, onclick: async () => {
            const choice = await choose({
              title: `Delete "${presetLabel(preset)}"?`,
              message: "Poses already made from it stay as they are.",
              choices: [{ label: "Delete preset", value: "delete", style: "solid-danger" }],
            });
            if (choice !== "delete") return;
            try {
              await deletePreset(preset.id);
              showMessage(message, "");
              changed();
              await draw();
            } catch (err) {
              showMessage(message, `Couldn't delete it: ${errorMessage(err)}`, true);
            }
          } }, "Delete")))];
      }));
    }

    document.body.append(dialog);
    dialog.showModal();
    draw().catch((err) => showMessage(message, `Couldn't load your presets: ${errorMessage(err)}`, true));
  });
}
