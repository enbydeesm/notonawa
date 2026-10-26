// "Shared by me" (on Your data): my live shares, what each is and when it
// ends, with Show code (its key was kept, sealed with mine) and Revoke.

import { api, errorMessage } from "./api.js";
import { h, showMessage } from "./dom.js";
import { open } from "./vault.js";
import { choose } from "./dialog.js";
import { KIND_NAMES, endsText, usesText } from "./share-options.js";
import { showShareCode } from "./share-code.js";

/**
 * Fills the "Shared by me" card's list, and again after a revoke.
 * @param {HTMLElement} list
 * @param {HTMLElement} message
 */
export async function showSharedByMe(list, message) {
  try {
    const shares = await open("share", await api("/api/shares"));
    list.replaceChildren(...(shares.length
      ? shares.map((share) => shareItem(share, () => showSharedByMe(list, message), message))
      : [h("p", { className: "empty" }, "Nothing shared right now.")]));
  } catch (err) {
    showMessage(message, "Couldn't load your shares: " + errorMessage(err), true);
  }
}

/**
 * @param {any} share as GET /api/shares lists it, opened
 * @param {() => void} reload
 * @param {HTMLElement} message
 */
function shareItem(share, reload, message) {
  const kind = KIND_NAMES[/** @type {keyof typeof KIND_NAMES} */ (share.kind)] ?? "Share";
  const title = share.label || (share.kind === "profile" ? "Profile invite" : kind);
  return h("div", { className: "item share-item" },
    h("div", { className: "item-title" }, title),
    h("div", { className: "item-meta" }, [kind, endsText(share.expires_at), usesText(share.use_count, share.max_uses)].join(" · ")),
    h("div", { className: "item-actions" },
      share.link_key
        ? h("button", { type: "button", className: "share-show", onclick: () => showShareCode({ id: share.id, key: share.link_key, title }) }, "Show code")
        : null,
      h("button", {
        type: "button", className: "danger share-revoke",
        onclick: async () => {
          const choice = await choose({
            title: `Revoke "${title}"?`,
            message: "Its code and link stop working at once. Anyone who already added it keeps what they added.",
            choices: [{ label: "Revoke", value: "revoke", style: "solid-danger" }],
          });
          if (choice !== "revoke") return;
          try {
            await api(`/api/shares/${share.id}`, { method: "DELETE" });
            reload();
          } catch (err) {
            showMessage(message, "Couldn't revoke it: " + errorMessage(err), true);
          }
        },
      }, "Revoke")));
}
