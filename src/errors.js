// Turns an error thrown by a route into the response the user sees.

import { BadInput, json } from "./http.js";

/**
 * @param {unknown} err
 * @returns {Response}
 */
export function errorResponse(err) {
  if (err instanceof BadInput) {
    return json({ error: err.message }, 400);
  }
  const message = err instanceof Error ? err.message : "";
  // Linking to something that doesn't exist, or that belongs to another user
  // (rejected by the ownership triggers). Same message for both so we don't
  // reveal whether someone else's item exists.
  if (/ownership mismatch|FOREIGN KEY constraint failed/.test(message)) {
    return json({ error: "Linked item not found." }, 400);
  }
  if (/UNIQUE constraint failed: people\.owner_id/.test(message)) {
    return json({ error: "You already have a profile marked as you." }, 400);
  }
  console.error(err);
  return json({ error: "Something went wrong" }, 500);
}
