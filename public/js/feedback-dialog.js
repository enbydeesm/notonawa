// "Bug and feedback": a short form, opened from the menu, that sends a bug
// report or an idea to us (POST /api/feedback, read with
// scripts/feedback.mjs), or an email link for anyone who wants to attach
// a screenshot or hear back. What's sent isn't encrypted (we have to read
// it), so the form says not to put journal details in it.

import { api, errorMessage } from "./api.js";
import { h, showMessage, privateField } from "./dom.js";
import { APP_VERSION } from "./releases.js";

/** The longest message the server takes (src/feedback/parse.js). */
export const MAX_FEEDBACK_LENGTH = 2000;
export const CONTACT_EMAIL = "contact@notonawa.app";

/**
 * Opens the form. Resolves when it's closed.
 * @returns {Promise<void>}
 */
export function openFeedback() {
  return new Promise((resolve) => {
    // Ids start with "feedback-": this opens over a view.
    const kind = h("select", { id: "feedback-kind", name: "kind", required: true },
      h("option", { value: "" }, ""),
      h("option", { value: "bug" }, "Bug"),
      h("option", { value: "idea" }, "Idea"));
    const text = privateField(h("textarea", {
      id: "feedback-message", name: "message", required: true, maxLength: MAX_FEEDBACK_LENGTH,
      oninput: () => { count.textContent = `${text.value.length} / ${MAX_FEEDBACK_LENGTH}`; },
    }));
    const count = h("p", { className: "hint feedback-count", id: "feedback-count" }, `0 / ${MAX_FEEDBACK_LENGTH}`);
    const message = h("p", { className: "message", id: "feedback-status" });
    const submit = h("button", { type: "submit", className: "primary", id: "feedback-submit" }, "Submit");
    // Only the version goes in the subject: never anything typed.
    const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`nōtonawa feedback (version ${APP_VERSION})`)}`;

    const form = h("form", { onsubmit: send },
      h("p", { className: "warning-note", id: "feedback-warning" },
        h("strong", {}, "Please don't include journal details"),
        " (names, notes, places): this message isn't encrypted, so we can read it."),
      h("label", { htmlFor: "feedback-kind" }, "Bug or idea?"),
      kind,
      h("label", { htmlFor: "feedback-message" }, "Message"),
      text,
      count,
      h("p", { className: "hint", id: "feedback-email" },
        "Want to attach a screenshot, or hear back from us? Email ",
        h("a", { href: mailto, id: "feedback-mailto" }, CONTACT_EMAIL), " instead."),
      submit,
      h("button", { type: "button", className: "dialog-cancel", id: "feedback-cancel", onclick: () => dialog.close() }, "Cancel"),
      message);

    // Like the tie form, a stray tap outside doesn't close it; Esc does.
    const dialog = h("dialog", { className: "form-dialog feedback", "aria-labelledby": "feedback-heading" },
      h("h2", { id: "feedback-heading" }, "Bug and feedback"),
      form);
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve();
    });

    /** @param {SubmitEvent} event */
    async function send(event) {
      event.preventDefault();
      submit.disabled = true;
      showMessage(message, "Sending…");
      try {
        await api("/api/feedback", { method: "POST", body: { kind: kind.value, message: text.value, app_version: APP_VERSION } });
        dialog.replaceChildren(
          h("h2", { id: "feedback-heading" }, "Thank you!"),
          h("p", { id: "feedback-thanks" }, "We got your message."),
          h("div", { className: "dialog-footer" },
            h("button", { type: "button", id: "feedback-done", onclick: () => dialog.close() }, "OK")));
      } catch (err) {
        showMessage(message, "Couldn't send: " + errorMessage(err), true);
        submit.disabled = false;
      }
    }

    document.body.append(dialog);
    dialog.showModal();
  });
}
