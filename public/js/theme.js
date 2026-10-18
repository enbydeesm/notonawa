// Light and dark mode. The mode is an account setting (users.theme), the
// same on every device: new accounts start dark, and picking light in
// Settings makes light the mode everywhere until it's changed again. The
// device's own light/dark setting isn't followed.
//
// The page also keeps the last mode it showed in localStorage (just "light"
// or "dark", never journal data), so theme-init.js can apply it before the
// page draws, and so pages shown before signing in (sign-in, the privacy
// policy) use it. Pure (applying and saving are in settings.js), so it's
// easy to test.

export const THEME_KEY = "theme";
/** The mode before any is chosen, and where none is stored on this device. */
export const DEFAULT_THEME = "dark";

/** @typedef {"light" | "dark"} Theme */

/**
 * @param {unknown} value a stored or saved choice
 * @returns {Theme | null}
 */
export function parseChoice(value) {
  return value === "light" || value === "dark" ? value : null;
}

/**
 * @param {Theme | null} choice
 * @returns {Theme} the mode on screen
 */
export function shownTheme(choice) {
  return choice ?? DEFAULT_THEME;
}

/**
 * @param {Theme} theme
 * @returns {Theme}
 */
export function otherTheme(theme) {
  return theme === "dark" ? "light" : "dark";
}
