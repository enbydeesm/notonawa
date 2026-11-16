// Tabs open on the same journal (format 2) tell each other what changed,
// so each reads it again from the shared cache, and lock together. One
// BroadcastChannel per account; nothing journal-related goes over it but
// record ids.

/**
 * @typedef {{ type: "changed", changed: string[], removed: string[] } | { type: "lock" }} TabMessage
 * @typedef {{ tellChanged: (changed: string[], removed: string[]) => void, tellLock: () => void, close: () => void }} Tabs
 */

/**
 * Starts listening to the account's other tabs.
 * @param {string} userId
 * @param {{ onChanged: (changed: string[], removed: string[]) => void, onLock: () => void }} handlers
 * @returns {Tabs}
 */
export function openTabs(userId, { onChanged, onLock }) {
  if (typeof BroadcastChannel === "undefined") return { tellChanged() {}, tellLock() {}, close() {} };
  const channel = new BroadcastChannel(`notonawa-${userId}`);
  channel.onmessage = (event) => {
    const message = /** @type {TabMessage} */ (event.data);
    if (message?.type === "changed" && Array.isArray(message.changed) && Array.isArray(message.removed)) {
      onChanged(message.changed.filter((id) => typeof id === "string"), message.removed.filter((id) => typeof id === "string"));
    } else if (message?.type === "lock") {
      onLock();
    }
  };
  /** @param {TabMessage} message */
  const post = (message) => {
    try {
      channel.postMessage(message);
    } catch {
      // Closed already: nothing to tell.
    }
  };
  return {
    tellChanged: (changed, removed) => {
      if (changed.length || removed.length) post({ type: "changed", changed, removed });
    },
    tellLock: () => post({ type: "lock" }),
    close: () => channel.close(),
  };
}
