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

/** @param {string} text */
export function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
