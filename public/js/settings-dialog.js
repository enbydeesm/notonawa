// The Settings dialog, opened from the menu: light/dark mode, this device's
// notifications (push-settings.js), and the words used for the top and
// bottom roles (see settings.js and roles.js).
// The mode changes as soon as the switch is tapped; the role names wait for
// Save. Ids are prefixed settings- so they don't clash with the view.

import { h, privateField, showMessage } from "./dom.js";
import { loadSettings, saveRoleNames, saveTheme, currentTheme } from "./settings.js";
import { otherTheme } from "./theme.js";
import { DEFAULT_NAMES } from "./roles.js";
import { errorMessage } from "./api.js";
import { pushSettings } from "./push-settings.js";

/** Opens the dialog. Resolves once it's closed. */
export async function openSettings() {
  const message = h("p", { className: "message", id: "settings-message", role: "alert" });
  const darkSwitch = h("button", {
    type: "button", id: "settings-dark", className: "switch", role: "switch",
    "aria-checked": String(currentTheme() === "dark"), onclick: toggleTheme,
  }, h("span", { className: "switch-track", "aria-hidden": "true" }, h("span", { className: "switch-knob" })));
  const top = privateField(h("input", { id: "settings-top", type: "text", maxLength: 24, placeholder: DEFAULT_NAMES.top }));
  const bottom = privateField(h("input", { id: "settings-bottom", type: "text", maxLength: 24, placeholder: DEFAULT_NAMES.bottom }));
  const save = h("button", { type: "submit", className: "primary", id: "settings-save" }, "Save");

  const form = h("form", { className: "settings-form", onsubmit: submit },
    h("div", { className: "settings-row" },
      h("label", { htmlFor: "settings-dark", id: "settings-dark-label" }, "Dark mode"), darkSwitch),
    pushSettings(),
    h("h3", { className: "settings-heading" }, "Customize role names"),
    h("label", { htmlFor: "settings-top" }, "Person tying is called:"), top,
    h("label", { htmlFor: "settings-bottom" }, "Person being tied is called:"), bottom,
    message,
    save,
    h("button", { type: "button", className: "dialog-cancel", onclick: () => dialog.close() }, "Cancel"));
  darkSwitch.setAttribute("aria-labelledby", "settings-dark-label");

  const dialog = h("dialog", { className: "form-dialog settings-dialog", "aria-labelledby": "settings-title" },
    h("h2", { id: "settings-title" }, "Settings"), form);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  document.body.append(dialog);
  const closed = new Promise((resolve) => dialog.addEventListener("close", () => { dialog.remove(); resolve(undefined); }));
  dialog.showModal();

  // Fill in the names already chosen (blank: the default, shown muted).
  save.disabled = true;
  try {
    const settings = await loadSettings();
    top.value = settings.top_label ?? "";
    bottom.value = settings.bottom_label ?? "";
    save.disabled = false;
  } catch (err) {
    showMessage(message, "Couldn't load your settings: " + errorMessage(err), true);
  }

  async function toggleTheme() {
    const next = otherTheme(currentTheme());
    darkSwitch.setAttribute("aria-checked", String(next === "dark"));
    try {
      await saveTheme(next);
    } catch (err) {
      showMessage(message, "Changed here, but couldn't save it for your other devices: " + errorMessage(err), true);
    }
  }

  /** @param {SubmitEvent} event */
  async function submit(event) {
    event.preventDefault();
    save.disabled = true;
    try {
      await saveRoleNames(top.value, bottom.value);
      dialog.close();
    } catch (err) {
      showMessage(message, "Couldn't save: " + errorMessage(err), true);
      save.disabled = false;
    }
  }

  return closed;
}
