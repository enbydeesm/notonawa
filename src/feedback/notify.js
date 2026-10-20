// Emails us that a bug report or idea was sent (one email each, for now:
// a daily digest may replace it once there are more). Sent from and to our
// own address, through Email Routing (the FEEDBACK_EMAIL binding).

import { FEEDBACK_ADDRESS, feedbackEmail } from "./mail.js";

/**
 * Sends the email. Never throws: the report is already saved, so a failed
 * email shouldn't fail the request (it shows in `wrangler tail`).
 * @param {SendEmail | undefined} binding none: not set up, so nothing is sent
 * @param {{ kind: string, app_version: string }} feedback
 * @param {string} sentAt ISO timestamp
 * @returns {Promise<boolean>} whether it was sent
 */
export async function notifyFeedback(binding, feedback, sentAt) {
  if (!binding) return false;
  try {
    await binding.send({ from: FEEDBACK_ADDRESS, to: FEEDBACK_ADDRESS, ...feedbackEmail(feedback, sentAt) });
    return true;
  } catch (err) {
    console.error("Couldn't email about new feedback:", err instanceof Error ? err.message : err);
    return false;
  }
}
