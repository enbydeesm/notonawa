// The welcome tour's words and where each stop points (tour.js draws it).
// Pure, so the order and wording are easy to test.
//
// The tour is a welcome card, then one stop for each of the nav's tabs, the
// poser, + and the menu (a ring round its button, the card under the nav),
// then Account Recovery (a card in the middle, pointing at nothing), then
// "That's a wrap!". Stops are numbered from 1 ("3 of 11"); the welcome is 0
// and the wrap-up is after the last.

/**
 * Part of a paragraph: plain text, text in italics, or a line break (where
 * a line would otherwise wrap awkwardly).
 * @typedef {string | { em: string } | { br: true }} Span
 */

/**
 * @typedef {{ title: string, body: Span[][], target: string | null }} Stop
 *   body: paragraphs, each a list of spans. target: a selector for what the
 *   ring goes round, or null for a card in the middle.
 */

/** @type {readonly Stop[]} */
export const STOPS = Object.freeze([
  {
    title: "Ties", target: 'nav a[href="/"]',
    body: [["Your scenes and labbing sessions. Log what you tied, who with, where, and make any notes you want to remember. "
      + "Add tags to help you find ties and filter charts (e.g. where you used a certain harness)."]],
  },
  {
    title: "Plans", target: 'nav a[href="/plans"]',
    body: [["Ties and ideas you are noodling on: a quick idea, harness steps or a suspension sequence. "
      + "Link a plan to ties to track attempts or iterations."]],
  },
  {
    title: "Education", target: 'nav a[href="/education"]',
    body: [["Workshops you take and teach: who taught, who you tied with, what it cost and what you learned. "
      + "Link the sequence you learned as a Plan, attach photos or handouts, and more."]],
  },
  {
    title: "People", target: 'nav a[href="/people"]',
    body: [["Tying partners, photographers, spotters and educators. Add someone once, then pick them whenever you log. "
      + "Connect your accounts to securely share ties and plans. Add notes about boundaries or share your personal operating manual."]],
  },
  {
    title: "Locations", target: 'nav a[href="/locations"]',
    body: [["Where you tie. Save a maps link or coordinates and your ties show up on the global map", { br: true }, "(if that's your kink)."]],
  },
  {
    title: "Calendar", target: 'nav a[href="/calendar"]',
    body: [["Your monthly tie frequency at a glance. Tap a day to see what happened on it."]],
  },
  {
    title: "Analytics", target: 'nav a[href="/analytics"]',
    body: [["The nerdy charts: tie counts by partner, place, type and tag, workshop stats, and that super cool map."]],
  },
  {
    title: "Model Poser", target: "#nav-poser",
    body: [["AKA the Sick Flip Simulator. A 3D figure you can pose, tie up and suspend. "
      + "Save a screenshot or pose to any tie, plan or workshop."]],
  },
  {
    title: "Add a tie", target: "nav .nav-add",
    body: [["Quickly log a tie from wherever you are in the app."]],
  },
  {
    title: "Menu", target: "nav .nav-menu",
    body: [["Everything else lives in here: Settings, your Account and passkeys, Your data for exports and imports, "
      + "this Tutorial, Bug and feedback, release updates, the Privacy Policy and Sign Out."]],
  },
  {
    title: "Account Recovery", target: null,
    body: [
      ["Because everything is encrypted,", { br: true }, { em: "we cannot restore your data if you lose it" }, "."],
      ["We strongly recommend adding additional passkeys, using a password manager that syncs passkeys across devices, "
        + "and storing your recovery code there to avoid losing access to your account. You also can periodically "
        + "download a decrypted copy of your data to backup in a secure location of your choice."],
    ],
  },
]);

/** Where the wrap-up comes: the step after the last stop. */
export const FINISH = STOPS.length + 1;

/**
 * What to show at a step: 0 the welcome, 1 to STOPS.length a stop, FINISH
 * the wrap-up. Steps outside that are kept to it.
 * @param {number} step
 * @returns {{ kind: "welcome", step: 0 } | { kind: "finish", step: number }
 *   | { kind: "stop", step: number, stop: Stop, count: string, last: boolean }}
 */
export function stepAt(step) {
  const at = Math.max(0, Math.min(FINISH, Math.trunc(step) || 0));
  if (at === 0) return { kind: "welcome", step: 0 };
  if (at === FINISH) return { kind: "finish", step: at };
  return { kind: "stop", step: at, stop: STOPS[at - 1], count: `${at} of ${STOPS.length}`, last: at === STOPS.length };
}

/** The buy-us-a-coffee page, the wrap-up's last line. */
export const COFFEE_URL = "https://buymeacoffee.com/mx_piggie";

/** Where to write to us, on the wrap-up. */
export const CONTACT_EMAIL = "contact@notonawa.app";
