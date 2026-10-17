// Messages from us (notices), shown as banners between the nav and the view
// while the journal is open (GET /api/notices; written with
// scripts/notice.mjs). Each can be dismissed for good. Fetched again at most
// every few minutes, and forgotten when the journal locks.

import { api } from "./api.js";
import { h, $ } from "./dom.js";

const REFRESH_MS = 5 * 60 * 1000;

/** @typedef {{ id: string, message: string, level: "info" | "warning", link: "privacy" | null }} Notice */

/** @type {Notice[]} */
let notices = [];
let fetchedAt = 0;
/** @type {HTMLElement | null} */
let box = null;
let visible = false;

/** Makes the banners' place, between the nav and the view. */
export function noticeBox() {
  box = h("div", { id: "notices", className: "notices", role: "region", "aria-label": "Messages", hidden: true });
  $("#view").before(box);
}

/**
 * Shows the banners (fetching them if it's been a while), or hides them.
 * @param {boolean} show
 */
export async function showNotices(show) {
  visible = show;
  draw();
  if (!show || Date.now() - fetchedAt < REFRESH_MS) return;
  fetchedAt = Date.now();
  try {
    notices = await api("/api/notices");
  } catch {
    fetchedAt = 0; // try again next time
    return;
  }
  draw();
}

/** Clears them (the journal locked). */
export function forgetNotices() {
  notices = [];
  fetchedAt = 0;
  draw();
}

function draw() {
  if (!box) return;
  box.hidden = !visible || notices.length === 0;
  box.replaceChildren(...notices.map((notice) => h("div", { className: `notice ${notice.level === "warning" ? "warning" : ""}` },
    h("p", {}, notice.message,
      notice.link === "privacy"
        ? [" ", h("a", { href: "/privacy.html", target: "_blank", rel: "noopener" }, "Read the privacy policy")]
        : null),
    h("button", { type: "button", className: "notice-dismiss", "aria-label": "Dismiss", title: "Dismiss", onclick: () => dismiss(notice) }, "✕"))));
}

/** @param {Notice} notice */
async function dismiss(notice) {
  notices = notices.filter((n) => n !== notice);
  draw();
  try {
    await api(`/api/notices/${encodeURIComponent(notice.id)}/dismiss`, { method: "POST", body: {} });
  } catch {
    // It shows again next time, to dismiss then.
  }
}
