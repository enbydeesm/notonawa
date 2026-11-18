// Settings' "Notifications on this device" (settings-dialog.js): turn them
// on (the browser asks), choose the kinds (Connections, Announcements),
// or turn them off. Per device: each is kept with this device's
// subscription (src/push/). What shows depends on push-rules.js's state.
// Ids are prefixed settings-push-.

import { h, showMessage } from "./dom.js";
import { pushStatus, turnOnPush, setPushKinds, turnOffPush } from "./push.js";
import { blockedText, installFirstText } from "./push-rules.js";
import { platformOf } from "./install-rules.js";
import { isInstalled } from "./install-banner.js";
import { errorMessage } from "./api.js";

/** The section, filled in once this device's state is known. */
export function pushSettings() {
  const body = h("div", { id: "settings-push" }, h("p", { className: "hint" }, "Checking…"));
  const message = h("p", { className: "message", id: "settings-push-message", role: "status" });
  const section = h("div", { className: "settings-push" },
    h("h3", { className: "settings-heading" }, "Notifications on this device"), body, message);

  /** @param {import("./push.js").PushStatus} status */
  function draw(status) {
    const hint = (/** @type {string} */ text) => h("p", { className: "hint", id: "settings-push-hint" }, text);
    const device = { platform: platformOf(navigator.userAgent, navigator.maxTouchPoints), installed: isInstalled(), userAgent: navigator.userAgent };
    if (status.state === "unsupported") return body.replaceChildren(hint("This browser can't show notifications from NōtoNawa."));
    if (status.state === "install-first") return body.replaceChildren(hint(installFirstText()));
    if (status.state === "blocked") return body.replaceChildren(hint(blockedText(device)));
    if (status.state === "off") {
      return body.replaceChildren(
        hint("Get a notification when a connection sends you something, or when we post an announcement."),
        h("button", { type: "button", id: "settings-push-on", onclick: on }, "Turn on notifications"));
    }
    const kinds = { connections: status.connections, announcements: status.announcements };
    /**
     * @param {"connections" | "announcements"} kind
     * @param {string} label
     */
    const toggle = (kind, label) => {
      const id = `settings-push-${kind}`;
      const button = h("button", {
        type: "button", id, className: "switch", role: "switch", "aria-checked": String(kinds[kind]),
        "aria-labelledby": `${id}-label`, onclick: () => change(kind, button),
      }, h("span", { className: "switch-track", "aria-hidden": "true" }, h("span", { className: "switch-knob" })));
      return h("div", { className: "settings-row" }, h("label", { htmlFor: id, id: `${id}-label` }, label), button);
    };
    body.replaceChildren(
      toggle("connections", "Connections"),
      toggle("announcements", "Announcements from NōtoNawa"),
      h("button", { type: "button", id: "settings-push-off", onclick: off }, "Turn off on this device"));

    /**
     * @param {"connections" | "announcements"} kind
     * @param {HTMLButtonElement} button
     */
    async function change(kind, button) {
      const next = { ...kinds, [kind]: !kinds[kind] };
      button.setAttribute("aria-checked", String(next[kind]));
      try {
        await setPushKinds(next);
        kinds[kind] = next[kind];
        showMessage(message, "");
      } catch (err) {
        button.setAttribute("aria-checked", String(kinds[kind]));
        showMessage(message, "Couldn't save: " + errorMessage(err), true);
      }
    }
  }

  async function on() {
    showMessage(message, "");
    try {
      draw(await turnOnPush());
    } catch (err) {
      showMessage(message, "Couldn't turn notifications on: " + errorMessage(err), true);
    }
  }

  async function off() {
    try {
      await turnOffPush();
      draw(await pushStatus());
      showMessage(message, "Notifications are off on this device.");
    } catch (err) {
      showMessage(message, "Couldn't turn them off: " + errorMessage(err), true);
    }
  }

  pushStatus().then(draw, (err) => showMessage(message, "Couldn't check notifications: " + errorMessage(err), true));
  return section;
}
