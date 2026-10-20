// "What's new": the release notes (RELEASES.md, built into releases.js), in
// a dialog. Opened from the menu, and once after an update: the first
// time the journal is shown after unlocking, if there are releases I
// haven't seen, one dialog lists them all, newest first.

import { h } from "./dom.js";
import { APP_VERSION, RELEASES } from "./releases.js";
import { unseenReleases, MAX_SHOWN } from "./release-notes.js";
import { loadSettings, saveSeenRelease } from "./settings.js";

/**
 * Opens the dialog with these releases (all the recent ones, from the menu).
 * Resolves when it's closed.
 * @param {{ version: string, notes: string[] }[]} [releases] newest first
 * @returns {Promise<void>}
 */
export function openWhatsNew(releases = RELEASES.slice(0, MAX_SHOWN)) {
  return new Promise((resolve) => {
    const dialog = h("dialog", { className: "form-dialog whats-new", "aria-labelledby": "whats-new-heading" },
      h("h2", { id: "whats-new-heading" }, "What's new"),
      releases.map((release) => h("section", { className: "release" },
        h("h3", {}, release.version),
        h("ul", {}, release.notes.map((note) => h("li", {}, note))))),
      h("div", { className: "dialog-footer" },
        h("button", { type: "button", className: "primary", id: "whats-new-ok", onclick: () => dialog.close() }, "OK")));
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * Shows the releases I haven't seen, if any, then remembers that I've seen
 * this version (on my account, so my other devices don't show them again).
 * However the dialog closes counts as seen.
 */
export async function showUnseenReleases() {
  const { seen_release: seen } = await loadSettings();
  const unseen = unseenReleases(RELEASES, seen);
  if (!unseen.length) return;
  await openWhatsNew(unseen);
  await saveSeenRelease(APP_VERSION);
}
