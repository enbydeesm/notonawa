// Going to another view without loading a new page. app.js provides the real
// thing when it starts; until then (or on a page without the app) it's an
// ordinary page load. Kept apart from app.js so api.js and the views can use
// it without importing the whole app.

/** @type {(path: string, replace: boolean) => void} */
let go = (path, replace) => (replace ? location.replace(path) : location.assign(path));

/**
 * @param {string} path e.g. "/signin"
 * @param {{ replace?: boolean }} [options] replace: don't add a history entry
 *   (so Back doesn't return to a page that would only send you on again)
 */
export function navigate(path, { replace = false } = {}) {
  go(path, replace);
}

/** @param {(path: string, replace: boolean) => void} navigator */
export function setNavigator(navigator) {
  go = navigator;
}
