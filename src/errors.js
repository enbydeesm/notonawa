// Turns an error thrown by a route into the response the user sees.

import { BadInput, NeedsReauth, json } from "./http.js";

/**
 * @param {unknown} err
 * @returns {Response}
 */
export function errorResponse(err) {
  if (err instanceof BadInput) {
    return json({ error: err.message }, 400);
  }
  if (err instanceof NeedsReauth) {
    return json({ error: "Please confirm it's you, then try again.", reauth: true }, 403);
  }
  const message = err instanceof Error ? err.message : "";
  // Linking to something that doesn't exist, or that belongs to another user
  // (rejected by the ownership triggers). Same message for both so we don't
  // reveal whether someone else's item exists.
  if (/ownership mismatch|FOREIGN KEY constraint failed/.test(message)) {
    return json({ error: "Linked item not found." }, 400);
  }
  // Two sign-ups racing for one invite: the database lets only one through.
  if (/invite unavailable/.test(message)) {
    return json({ error: "That invite code has already been used or has expired." }, 400);
  }
  if (/UNIQUE constraint failed: passkeys\.id/.test(message)) {
    return json({ error: "That passkey is already registered." }, 400);
  }
  // Two saves racing to make different locations the default.
  if (/UNIQUE constraint failed: locations\.owner_id/.test(message)) {
    return json({ error: "Another location just became your default. Reload and try again." }, 400);
  }
  if (/UNIQUE constraint failed: people\.owner_id/.test(message)) {
    return json({ error: "You already have a profile marked as you." }, 400);
  }
  console.error(err);
  return json({ error: "Something went wrong" }, 500);
}
