// The welcome: a short guide to the app (WELCOME.md, built into
// welcome-text.js), in a dialog. Shown the first time the journal is shown
// after each unlock, before "What's new", until "Don't show this again" is
// ticked (saved on my account, so my other devices stop showing it too).
// Every account starts with it showing, those made before it existed too.

import { h, $ } from "./dom.js";
import { WELCOME } from "./welcome-text.js";
import { loadSettings, saveHideWelcome } from "./settings.js";

/** @typedef {import("./welcome-text.js").Span} Span */

/** @param {Span} span */
function renderSpan(span) {
  if (span.bold) return h("strong", {}, span.text);
  if (span.italic) return h("em", {}, span.text);
  if (span.email) return h("a", { href: `mailto:${span.text}` }, span.text);
  return span.text;
}

/** The welcome's text, as elements. */
function welcomeContent() {
  return WELCOME.map((block) => {
    if (block.kind === "list") return h("ul", {}, block.items.map((item) => h("li", {}, item.map(renderSpan))));
    return h(block.kind === "heading" ? "h2" : "p", block.kind === "heading" ? { id: "welcome-heading" } : {},
      block.spans.map(renderSpan));
  });
}

/**
 * Opens the welcome. Resolves with whether "Don't show this again" was
 * ticked; however it closes (OK or Esc) counts.
 * @returns {Promise<boolean>}
 */
export function openWelcome() {
  return new Promise((resolve) => {
    const dontShow = h("input", { type: "checkbox", id: "welcome-hide" });
    const dialog = h("dialog", { className: "form-dialog welcome", "aria-labelledby": "welcome-heading" },
      welcomeContent(),
      h("div", { className: "dialog-footer welcome-footer" },
        h("label", { className: "inline", htmlFor: "welcome-hide" }, dontShow, " Don't show this again"),
        h("button", { type: "button", className: "primary", id: "welcome-ok", onclick: () => dialog.close() }, "OK")));
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(dontShow.checked);
    });
    document.body.append(dialog);
    dialog.showModal();
    // Start at the top, not on the first link in the text.
    $("#welcome-ok", dialog).focus();
    dialog.scrollTop = 0;
  });
}

/**
 * Shows the welcome unless I've asked not to see it again, and saves my
 * choice if I tick the box.
 */
export async function showWelcome() {
  const { hide_welcome: hidden } = await loadSettings();
  if (hidden) return;
  if (await openWelcome()) await saveHideWelcome();
}
