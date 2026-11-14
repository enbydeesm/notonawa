// "Shared by me" (on Your data): my live shares, what each is and when it
// ends, with Show code (its key was kept, sealed with mine) and Revoke; and
// my connections to other accounts, with who each is on, Add to Person and
// Remove.

import { api, errorMessage } from "./api.js";
import { h, showMessage } from "./dom.js";
import { open } from "./vault.js";
import { choose } from "./dialog.js";
import { KIND_NAMES, endsText, usesText } from "./share-options.js";
import { showShareCode } from "./share-code.js";
import { loadConnections, chooseConnectionPerson, removeConnection, linkIcon, CONNECTIONS_CHANGED } from "./connections.js";
import { connectionTitle, connectionDetail } from "./connection-text.js";
import { listItems } from "./store/index.js";

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
    share.connect ? h("div", { className: "item-meta share-connects" }, "Connects accounts") : null,
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

/**
 * Fills the Connections card's list, and again whenever one changes.
 * @param {HTMLElement} list
 * @param {HTMLElement} message
 * @param {AbortSignal} signal
 */
export async function showConnections(list, message, signal) {
  const reload = () => showConnections(list, message, signal);
  if (!list.dataset.listening) {
    list.dataset.listening = "1";
    window.addEventListener(CONNECTIONS_CHANGED, reload, { signal });
  }
  try {
    // Archived people too (a connection can be on one); names aren't sealed.
    const [connections, people] = await Promise.all([loadConnections(), listItems("people", "all")]);
    const names = new Map(people.map((/** @type {any} */ p) => [p.id, p.name]));
    list.replaceChildren(...(connections.length
      ? connections.map((c) => connectionItem(c, c.person_id ? names.get(c.person_id) ?? null : null, message))
      : [h("p", { className: "empty" }, "No connections. You can offer one when you share your profile, from your own card in People.")]));
  } catch (err) {
    showMessage(message, "Couldn't load your connections: " + errorMessage(err), true);
  }
}

/**
 * @param {import("./connection-text.js").Connection} connection opened
 * @param {string | null} name who it's on
 * @param {HTMLElement} message
 */
function connectionItem(connection, name, message) {
  /** @param {() => Promise<unknown>} action @param {string} failed */
  const run = async (action, failed) => {
    try {
      await action();
    } catch (err) {
      showMessage(message, `${failed}: ${errorMessage(err)}`, true);
    }
  };
  return h("div", { className: "item connection-item" },
    h("div", { className: "item-title connection-title" }, linkIcon(null), connectionTitle(name)),
    h("div", { className: "item-meta" }, connectionDetail(connection)),
    h("div", { className: "item-actions" },
      name ? null : h("button", {
        type: "button", className: "connection-add",
        onclick: () => run(() => chooseConnectionPerson(connection.id, { suggested: connection.invited ? null : connection.label }),
          "Couldn't link it"),
      }, "Add to Person"),
      h("button", {
        type: "button", className: "danger connection-remove",
        onclick: () => run(() => removeConnection(connection.id, name ?? undefined), "Couldn't remove it"),
      }, "Remove")));
}
