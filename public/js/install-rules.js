// Whether to offer installing the app, and how (install-banner.js shows
// it). Pure, so it's easy to test.
//
// Chrome and Edge (and other Chromium browsers) let the page open their own
// install window, by handing it a "beforeinstallprompt" event. Safari and
// Firefox don't, so there the banner says where to find it instead. Once
// installed, the app runs in a window of its own (its display mode isn't
// "browser"), and nothing is offered.

/** localStorage: "1" once "Not now" is chosen on this device. */
export const DISMISSED_KEY = "install-dismissed";

/** The display modes of an installed app (manifest.webmanifest asks for standalone). */
export const INSTALLED_MODES = ["standalone", "minimal-ui", "fullscreen", "window-controls-overlay"];

/** @typedef {"ios" | "mac-safari" | "android-firefox" | "other"} Platform */

export const PROMPT_TEXT = "Install NōtoNawa as an app: it opens in a window of its own, with an icon on your home screen or dock.";

/** Where to find installing, in browsers that can't be asked to show it. @type {Record<Platform, string | null>} */
export const STEPS = {
  ios: "Install NōtoNawa as an app: tap the Share button (in some browsers it's under ⋯), then Add to Home Screen.",
  "mac-safari": "Install NōtoNawa as an app: in Safari, choose File, then Add to Dock.",
  "android-firefox": "Install NōtoNawa as an app: open Firefox's ⋮ menu, then choose Install or Add to Home screen.",
  other: null,
};

/**
 * Which browser instructions apply, from the browser's user agent.
 * @param {string} userAgent
 * @param {number} touchPoints navigator.maxTouchPoints
 * @returns {Platform}
 */
export function platformOf(userAgent, touchPoints) {
  // iPadOS says it's a Mac: only its touch screen tells it apart. Every
  // browser on an iPhone or iPad adds to the home screen through Share.
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) return "ios";
  if (/Android/.test(userAgent) && /Firefox\//.test(userAgent)) return "android-firefox";
  // Safari 17 (macOS Sonoma) and later add sites to the Dock. Other Mac
  // browsers mention Safari too, so they're ruled out by name.
  const safari = /Macintosh/.test(userAgent) ? /Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari\//.exec(userAgent) : null;
  if (safari && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|OPR/.test(userAgent) && Number(safari[1]) >= 17) return "mac-safari";
  return "other";
}

/**
 * @param {unknown} value what localStorage holds under DISMISSED_KEY
 */
export function isDismissed(value) {
  return value === "1";
}

/**
 * @typedef {{ kind: "button" | "steps", text: string }} InstallOffer
 * button: the browser's own install window is ready to open. steps: say
 * where to find installing.
 */

/**
 * What to offer, if anything.
 * @param {{ installed: boolean, dismissed: boolean, canPrompt: boolean, platform: Platform }} situation
 *   canPrompt: the browser handed over its install window (and it's unused)
 * @returns {InstallOffer | null}
 */
export function installOffer({ installed, dismissed, canPrompt, platform }) {
  if (installed || dismissed) return null;
  if (canPrompt) return { kind: "button", text: PROMPT_TEXT };
  const text = STEPS[platform];
  return text ? { kind: "steps", text } : null;
}
