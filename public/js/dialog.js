// Confirmation dialogs.

import { h } from "./dom.js";

/**
 * @typedef {{ label: string, value: string, style?: "danger" | "solid-danger" }} Choice
 */

/**
 * Shows a modal with a choice of buttons plus Cancel. Resolves with the chosen
 * button's value, or null if they cancel (Cancel, Esc, or clicking outside).
 * content: anything more under the message (e.g. a tickbox, read by the
 * caller once it resolves). cancelLabel: Cancel's words, if not "Cancel".
 * @param {{ title: string, message?: string, content?: Node, choices: Choice[], cancelLabel?: string }} options
 * @returns {Promise<string | null>}
 */
export function choose({ title, message, content, choices, cancelLabel = "Cancel" }) {
  return new Promise((resolve) => {
    /** @type {string | null} */
    let result = null;
    const dialog = h(
      "dialog",
      { onclose: () => { dialog.remove(); resolve(result); } },
      h("h2", {}, title),
      message ? h("p", {}, message) : null,
      content ?? null,
      h(
        "div",
        { className: "dialog-buttons" },
        choices.map((c) =>
          h(
            "button",
            {
              type: "button",
              className: c.style === "solid-danger" ? "danger solid" : c.style || "",
              onclick: () => { result = c.value; dialog.close(); },
            },
            c.label
          )
        ),
        h("button", { type: "button", onclick: () => dialog.close() }, cancelLabel)
      )
    );
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * The delete dialog for people and locations: delete for good, or (if it's
 * not archived already) archive instead.
 * @param {{ title: string, message: string, archived: boolean }} options
 * @returns {Promise<{ archive: true } | { delete: true } | null>}
 */
export async function confirmDeleteOrArchive({ title, message, archived }) {
  const choice = await choose({
    title,
    message,
    choices: [
      ...(archived ? [] : [{ label: "Archive instead", value: "archive" }]),
      { label: "Delete permanently", value: "delete", style: /** @type {const} */ ("solid-danger") },
    ],
  });
  if (choice === "archive") return { archive: true };
  if (choice === "delete") return { delete: true };
  return null;
}
