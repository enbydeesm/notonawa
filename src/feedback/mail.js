// The email we get when a bug report or idea is sent from the app. Pure, so
// it's easy to test.
//
// It never holds what was written, only its kind, the app's version and
// when it was sent, so nothing typed is copied into our inbox. The report
// itself is read with scripts/feedback.mjs.

export const FEEDBACK_ADDRESS = "contact@notonawa.app";

/** What each kind is called in the email ("idea" is feedback). @type {Record<string, { subject: string, noun: string }>} */
const WORDS = {
  bug: { subject: "new bug report", noun: "A bug report" },
  idea: { subject: "new feedback", noun: "Feedback" },
};

/**
 * The email's subject and text.
 * @param {{ kind: string, app_version: string }} feedback
 * @param {string} sentAt ISO timestamp
 * @returns {{ subject: string, text: string }}
 */
export function feedbackEmail({ kind, app_version }, sentAt) {
  const words = WORDS[kind] ?? WORDS.idea;
  return {
    subject: `NotoNawa: ${words.subject}`,
    text: `${words.noun} was sent from version ${app_version} at ${sentAt}.\n\n` +
      "Read it with: node scripts/feedback.mjs --remote\n",
  };
}
