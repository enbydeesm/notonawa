// Formatting helpers. Pure, so they're easy to test.

/** Today as YYYY-MM-DD in the viewer's time zone. */
export function today() {
  return new Date().toLocaleDateString("en-CA");
}

/**
 * "2026-10-12" -> "Oct 12, 2026" (in the viewer's locale).
 * @param {string | null | undefined} isoDate
 * @param {string} [locale]
 */
export function formatDate(isoDate, locale) {
  if (!isoDate) return "No date";
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    year: "numeric", month: "short", day: "numeric",
  });
}

/**
 * A date as a card shows it, without commas: "Oct 12 2026".
 * @param {string | null | undefined} isoDate
 * @param {string} [locale]
 */
export function cardDate(isoDate, locale) {
  return formatDate(isoDate, locale).replace(/,/g, "");
}

/**
 * What's attached to a card, left out where there's none: "4 visuals, 2
 * plans, 6 ties", "1 visual". Empty when nothing is.
 * @param {{ visuals?: number, plans?: number, ties?: number }} counts
 */
export function attachedText({ visuals = 0, plans = 0, ties = 0 }) {
  /** @type {[number, string][]} */
  const parts = [[visuals, "visual"], [plans, "plan"], [ties, "tie"]];
  return parts.filter(([n]) => n > 0).map(([n, word]) => `${n} ${word}${n === 1 ? "" : "s"}`).join(", ");
}

/** @param {string} text */
export function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
