// Light and dark mode. The app follows the device's setting unless the user
// picks the other mode in the nav's menu (☰). That choice is kept in
// localStorage as just "light" or "dark" (never journal data), and
// theme-init.js reads it and applies it before each page draws. Pure (the
// button and saving are in nav.js), so it's easy to test.

export const THEME_KEY = "theme";

/** @typedef {"light" | "dark"} Theme */

/**
 * @param {unknown} value a stored choice
 * @returns {Theme | null} null: no choice, follow the device
 */
export function parseChoice(value) {
  return value === "light" || value === "dark" ? value : null;
}

/**
 * @param {Theme | null} choice
 * @param {boolean} deviceDark
 * @returns {Theme} the mode on screen
 */
export function shownTheme(choice, deviceDark) {
  return choice ?? (deviceDark ? "dark" : "light");
}

/**
 * The choice to keep after the button is tapped: the other mode, or null
 * (follow the device again) when the device would show that mode anyway.
 * @param {Theme} showing
 * @param {boolean} deviceDark
 * @returns {Theme | null}
 */
export function nextChoice(showing, deviceDark) {
  const next = showing === "dark" ? "light" : "dark";
  return (next === "dark") === deviceDark ? null : next;
}
