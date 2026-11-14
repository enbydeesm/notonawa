// Connections (format 2): not here yet. Format 1's connections are rows on
// the server; format 2's become contact records, sealed, with keys of
// their own (phase 6). Until then a format 2 account has none, the Share
// my profile dialog doesn't offer to connect, and an invite's offer to
// connect isn't shown.

/** @returns {Promise<import("../../connection-text.js").Connection[]>} */
export async function listConnections() {
  return [];
}

/** @param {...any} _args */
async function notYet(..._args) {
  throw new Error("Connecting accounts isn't ready in this version yet.");
}

export const acceptConnection = notYet;
export const setConnectionPerson = notYet;
export const markConnectionAnswered = notYet;
export const deleteConnection = notYet;
