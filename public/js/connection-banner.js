// The inviter's banner: someone accepted my profile invite and connected
// our accounts, so which of my People is it? Add to a Person, New Person,
// or Not now (it stays in Shared by me). Shown between the notices and the
// view while the journal is open; fetched again at most every few minutes
// and after a change, and forgotten when the journal locks.

import { h, $ } from "./dom.js";
import { loadConnections, answerLater, chooseConnectionPerson, linkIcon, CONNECTIONS_CHANGED } from "./connections.js";
import { bannerText, unanswered } from "./connection-text.js";

const REFRESH_MS = 5 * 60 * 1000;

/** @typedef {import("./connection-text.js").Connection} Connection */

/** @type {Connection[]} */
let waiting = [];
let fetchedAt = 0;
/** @type {HTMLElement | null} */
let box = null;
let visible = false;

/** Makes the banners' place, after the notices. */
export function connectionBox() {
  box = h("div", { id: "connection-banners", className: "notices", role: "region", "aria-label": "New connections", hidden: true });
  $("#view").before(box);
  // Answered from Shared by me, or a connection removed: ask again.
  window.addEventListener(CONNECTIONS_CHANGED, () => {
    fetchedAt = 0;
    if (visible) refresh();
  });
}

/**
 * Shows the banners (fetching them if it's been a while), or hides them.
 * @param {boolean} show
 */
export function showConnectionBanners(show) {
  visible = show;
  draw();
  if (show && Date.now() - fetchedAt >= REFRESH_MS) refresh();
}

/** Clears them (the journal locked). */
export function forgetConnectionBanners() {
  waiting = [];
  fetchedAt = 0;
  draw();
}

async function refresh() {
  fetchedAt = Date.now();
  try {
    waiting = unanswered(await loadConnections());
  } catch {
    fetchedAt = 0; // try again next time
    return;
  }
  draw();
}

function draw() {
  if (!box) return;
  box.hidden = !visible || waiting.length === 0;
  box.replaceChildren(...waiting.map((c) => h("div", { className: "notice connection-notice" },
    linkIcon(null),
    h("p", {}, bannerText(c.label)),
    h("div", { className: "notice-actions" },
      h("button", { type: "button", className: "connection-pick", onclick: () => answer(c, false) }, "Add to a Person"),
      h("button", { type: "button", className: "connection-new", onclick: () => answer(c, true) }, "New Person"),
      h("button", { type: "button", className: "link connection-later", onclick: () => later(c) }, "Not now")))));
}

/**
 * @param {Connection} connection
 * @param {boolean} newPerson
 */
async function answer(connection, newPerson) {
  // Linking marks it answered and tells everything (this included) to look again.
  await chooseConnectionPerson(connection.id, { newPerson });
}

/** @param {Connection} connection */
async function later(connection) {
  waiting = waiting.filter((c) => c !== connection);
  draw();
  try {
    await answerLater(connection.id);
  } catch {
    // It shows again next time, to answer then.
  }
}
