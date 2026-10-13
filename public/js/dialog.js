// Confirmation dialogs.

import { h } from "./dom.js";

/**
 * @typedef {{ label: string, value: string, style?: "danger" | "solid-danger" }} Choice
 */

/**
 * Shows a modal with a choice of buttons plus Cancel. Resolves with the chosen
 * button's value, or null if they cancel (Cancel, Esc, or clicking outside).
 * @param {{ title: string, message?: string, choices: Choice[] }} options
 * @returns {Promise<string | null>}
 */
export function choose({ title, message, choices }) {
  return new Promise((resolve) => {
    /** @type {string | null} */
    let result = null;
    const dialog = h(
      "dialog",
      { onclose: () => { dialog.remove(); resolve(result); } },
      h("h2", {}, title),
      message ? h("p", {}, message) : null,
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
        h("button", { type: "button", onclick: () => dialog.close() }, "Cancel")
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
 * @returns {Promise<{ archive: true } | { query: string } | null>}
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
  if (choice === "delete") return { query: "" };
  return null;
}
