// The inviter's banner: someone accepted my profile invite and connected
// our accounts, so which of my People is it? Add to a Person, New Person,
// or Not now (it stays in Shared by me). On format 2 they may have shared
// their profile back: New Person makes their card from it, and Add to a
// Person merges it into one I have, field by field. Shown between the notices and the
// view while the journal is open; fetched again at most every few minutes
// and after a change, and forgotten when the journal locks.

import { h, $ } from "./dom.js";
import { loadConnections, answerLater, chooseConnectionPerson, linkIcon, CONNECTIONS_CHANGED } from "./connections.js";
import { bannerText, unanswered, sentText } from "./connection-text.js";
import { receivedShares, receivedShareDone } from "./store/index.js";
import { openSentShare } from "./pending-share.js";
import { navigate } from "./navigate.js";

const REFRESH_MS = 5 * 60 * 1000;

/** @typedef {import("./connection-text.js").Connection} Connection */

/** @type {Connection[]} */
let waiting = [];
/** @typedef {ReturnType<typeof receivedShares>[number]} Sent */
/** @type {Sent[]} ties, plans and workshops my connections sent me */
let sent = [];
/** @type {Set<string>} the ones I said Not now to, until the journal locks */
const later = new Set();
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
  sent = [];
  later.clear();
  fetchedAt = 0;
  draw();
}

async function refresh() {
  fetchedAt = Date.now();
  try {
    waiting = unanswered(await loadConnections());
    sent = receivedShares().filter((s) => !later.has(s.share_id));
  } catch {
    fetchedAt = 0; // try again next time
    return;
  }
  draw();
}

function draw() {
  if (!box) return;
  box.hidden = !visible || waiting.length + sent.length === 0;
  box.replaceChildren(...sent.map((s) => h("div", { className: "notice sent-notice" },
    linkIcon(null),
    h("p", {}, sentText(s.from, s.kind)),
    h("div", { className: "notice-actions" },
      h("button", { type: "button", className: "sent-open", onclick: () => openSent(s) }, "Open"),
      h("button", { type: "button", className: "link sent-later", onclick: () => notNow(s) }, "Not now")))),
  ...waiting.map((c) => h("div", { className: "notice connection-notice" },
    linkIcon(null),
    h("p", {}, bannerText(c.label, c.shared?.name ?? null)),
    h("div", { className: "notice-actions" },
      h("button", { type: "button", className: "connection-pick", onclick: () => answer(c, false) }, "Add to a Person"),
      h("button", { type: "button", className: "connection-new", onclick: () => answer(c, true) }, "New Person"),
      h("button", { type: "button", className: "link connection-later", onclick: () => answerNotNow(c) }, "Not now")))));
}

/**
 * @param {Connection} connection
 * @param {boolean} newPerson
 */
async function answer(connection, newPerson) {
  // Linking marks it answered and tells everything (this included) to look again.
  await chooseConnectionPerson(connection.id, { newPerson, shared: connection.shared ?? null });
}

/**
 * Opens one sent to me, as a link would open (it can be opened once, so it
 * stops waiting now: if that fails, /open says it's ended).
 * @param {Sent} share
 */
async function openSent(share) {
  sent = sent.filter((s) => s !== share);
  draw();
  openSentShare({ id: share.share_id, key: share.link_key });
  navigate("/open");
  await receivedShareDone(share.contactId, share.share_id).catch(() => {});
}

/** @param {Sent} share */
function notNow(share) {
  later.add(share.share_id);
  sent = sent.filter((s) => s !== share);
  draw();
}

/** @param {Connection} connection */
async function answerNotNow(connection) {
  waiting = waiting.filter((c) => c !== connection);
  draw();
  try {
    await answerLater(connection.id);
  } catch {
    // It shows again next time, to answer then.
  }
}
