// "Shared by me" (on Your data): my live shares, what each is and when it
// ends, with Show code (its key was kept, sealed with mine) and Revoke; and
// my connections to other accounts, with who each is on, Add to Person and
// Remove.

import { api, errorMessage } from "./api.js";
import { h, showMessage } from "./dom.js";
import { open } from "./vault.js";
import { choose } from "./dialog.js";
import { KIND_NAMES, expiresIn, usesText } from "./share-options.js";
import { dataGrid } from "./data-grid.js";
import { showShareCode } from "./share-code.js";
import { loadConnections, chooseConnectionPerson, removeConnection, linkIcon, CONNECTIONS_CHANGED } from "./connections.js";
import { connectionVia } from "./connection-text.js";
import { formatDate } from "./format.js";
import { listItems, connectingShares, inviteRevoked } from "./store/index.js";

/**
 * Fills the "Shared by me" card's list, and again after a revoke.
 * @param {HTMLElement} list
 * @param {HTMLElement} message
 */
export async function showSharedByMe(list, message) {
  try {
    const shares = await open("share", await api("/api/shares"));
    const connecting = connectingShares();
    list.replaceChildren(shares.length
      ? dataGrid({
        className: "shares-grid", label: "Shared by me", columns: ["Tag", "Type", "Expires in"],
        rows: shares.map((share) => shareRow(share, connecting, () => showSharedByMe(list, message), message)),
      })
      : h("p", { className: "empty" }, "Nothing shared right now."));
  } catch (err) {
    showMessage(message, "Couldn't load your shares: " + errorMessage(err), true);
  }
}

/**
 * A share's row: its tag (with how much it's been used, and whether it
 * connects accounts, under it), its type and how long it has left; Show
 * code (an eye) and Revoke (a red trash can).
 * @param {any} share as GET /api/shares lists it, opened
 * @param {Set<string>} connecting format 2's invites that offer to connect (format 1's say so themselves)
 * @param {() => void} reload
 * @param {HTMLElement} message
 * @returns {import("./data-grid.js").GridRow}
 */
function shareRow(share, connecting, reload, message) {
  const kind = KIND_NAMES[/** @type {keyof typeof KIND_NAMES} */ (share.kind)] ?? "Share";
  const title = share.label || (share.kind === "profile" ? "Profile invite" : kind);
  const connects = share.connect || connecting.has(share.id);
  const revoke = async () => {
    const choice = await choose({
      title: `Revoke "${title}"?`,
      message: "Its code and link stop working at once. Anyone who already added it keeps what they added.",
      choices: [{ label: "Revoke", value: "revoke", style: "solid-danger" }],
    });
    if (choice !== "revoke") return;
    try {
      await api(`/api/shares/${share.id}`, { method: "DELETE" });
      await inviteRevoked(share.id);
      reload();
    } catch (err) {
      showMessage(message, "Couldn't revoke it: " + errorMessage(err), true);
    }
  };
  return {
    className: "share-row",
    cells: [
      h("div", {}, h("div", { className: "grid-title share-tag" }, title),
        h("div", { className: "grid-meta share-uses" }, usesText(share.use_count, share.max_uses) + (connects ? " · connects accounts" : ""))),
      h("span", { className: "share-type" }, kind),
      h("span", { className: "share-expires" }, expiresIn(share.expires_at)),
    ],
    actions: [
      share.link_key
        ? { icon: "show", label: `Show the code for "${title}"`, className: "share-show", onclick: () => showShareCode({ id: share.id, key: share.link_key, title }) }
        : null,
      { icon: "delete", label: `Revoke "${title}"`, className: "share-revoke", onclick: revoke },
    ],
  };
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
    list.replaceChildren(connections.length
      ? dataGrid({
        className: "connections-grid", label: "Connections", columns: ["Person", "Via", "Since"],
        rows: connections.map((c) => connectionRow(c, c.person_id ? names.get(c.person_id) ?? null : null, message)),
      })
      : h("p", { className: "empty" }, "No connections. You can offer one when you share your profile, from your own card in People."));
  } catch (err) {
    showMessage(message, "Couldn't load your connections: " + errorMessage(err), true);
  }
}

/**
 * A connection's row: who it's on (or "Not on any Person"), how it was
 * made and when; Add to Person (a person with a +) if it's on no one, and
 * Remove (a red trash can).
 * @param {import("./connection-text.js").Connection} connection opened
 * @param {string | null} name who it's on
 * @param {HTMLElement} message
 * @returns {import("./data-grid.js").GridRow}
 */
function connectionRow(connection, name, message) {
  /** @param {() => Promise<unknown>} action @param {string} failed */
  const run = async (action, failed) => {
    try {
      await action();
    } catch (err) {
      showMessage(message, `${failed}: ${errorMessage(err)}`, true);
    }
  };
  return {
    className: "connection-row",
    cells: [
      h("div", { className: "grid-title connection-title" }, linkIcon(null), name ?? h("span", { className: "muted" }, "Not on any Person")),
      h("span", { className: "connection-via" }, connectionVia(connection)),
      h("span", { className: "connection-since" }, formatDate(connection.created_at.slice(0, 10))),
    ],
    actions: [
      name ? null : {
        icon: "addperson", label: "Add to a Person", className: "connection-add",
        onclick: () => run(() => chooseConnectionPerson(connection.id, { suggested: connection.invited ? null : connection.label }),
          "Couldn't link it"),
      },
      {
        icon: "delete", label: name ? `Remove your connection with ${name}` : "Remove this connection", className: "connection-remove",
        onclick: () => run(() => removeConnection(connection.id, name ?? undefined), "Couldn't remove it"),
      },
    ],
  };
}
