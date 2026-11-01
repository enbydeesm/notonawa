// Bug reports and ideas sent from the app (migration 0015). Pure, so it's
// easy to test.
//
// Plain text, not encrypted: they're for us to read (scripts/feedback.mjs).
// The form warns not to put journal details in them.

import { BadInput } from "../http.js";
import { APP_VERSION_FORMAT } from "../parse.js";

export const FEEDBACK_KINDS = ["bug", "idea"];
export const MAX_FEEDBACK_LENGTH = 2000;
/** How many anyone can send in a day, so a stuck button can't fill the table. */
export const FEEDBACK_PER_DAY = 10;

/**
 * @typedef {{ kind: string, message: string, app_version: string }} Feedback
 */

/**
 * The body of POST /api/feedback: kind ("bug" or "idea"), message (up to
 * MAX_FEEDBACK_LENGTH characters) and app_version (the version the page is
 * running, e.g. 2026.10.31.0137, or 2026.10.20.001 in older ones).
 * @param {Record<string, unknown>} body
 * @returns {Feedback}
 */
export function parseFeedback(body) {
  if (typeof body.kind !== "string" || !FEEDBACK_KINDS.includes(body.kind)) {
    throw new BadInput("Say whether it's a bug or an idea.");
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) throw new BadInput("Write a message first.");
  if (message.length > MAX_FEEDBACK_LENGTH) {
    throw new BadInput(`Keep it to ${MAX_FEEDBACK_LENGTH} characters or fewer.`);
  }
  if (typeof body.app_version !== "string" || !APP_VERSION_FORMAT.test(body.app_version)) {
    throw new BadInput("That isn't a version of the app.");
  }
  return { kind: body.kind, message, app_version: body.app_version };
}
