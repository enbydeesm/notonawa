// Opening a share (/open#<id>.<key>): fetches it, opens it here with the
// link's key, and hands it to what adds it to my journal: a profile invite
// (open-profile.js), or a tie, plan or workshop (open-item.js).
//
// The link's key never reaches the server (pending-share.js takes it out of
// the address on load). What was shared comes from another account, so
// it's read strictly and shown as text.

import { api, ApiError, errorMessage } from "../api.js";
import { h, $ } from "../dom.js";
import { openShare, CantOpen } from "../vault.js";
import { toBase64url, fromBase64url } from "../crypto/keys.js";
import { pendingShare, keepOpened, forget } from "../pending-share.js";
import { showProfile } from "../open-profile.js";
import { showItem } from "../open-item.js";

/**
 * @param {HTMLElement} root
 * @param {{ signal: AbortSignal }} options
 */
export async function mount(root, { signal }) {
  const body = $("#open-body", root);
  const say = (/** @type {string} */ text) => body.replaceChildren(h("p", { id: "open-said" }, text));

  const { link, damaged } = pendingShare();
  let { opened } = pendingShare();
  if (!opened && damaged) return say("This link is damaged or incomplete. Ask whoever shared it to send it again.");
  if (!opened && !link) return say("Open a share link to see what was shared with you here.");

  if (!opened && link) {
    body.replaceChildren(h("p", { className: "hint" }, "Opening…"));
    try {
      const res = await api("/api/shares/open", { method: "POST", body: { id: link.id } });
      const data = await openShare(link.id, res.kind, toBase64url(link.key), fromBase64url(res.snapshot).buffer);
      opened = {
        kind: res.kind, own: res.own, data, offer: res.offer ?? null, connectionId: res.connection_id ?? null,
        id: link.id, key: toBase64url(link.key),
      };
      keepOpened(opened);
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof ApiError && err.status === 404) {
        forget();
        return say("This share has ended or doesn't exist. Ask whoever shared it for a new one.");
      }
      if (err instanceof CantOpen) return say("This link is damaged or incomplete. Ask whoever shared it to send it again.");
      return say("Couldn't open it: " + errorMessage(err));
    }
  }
  if (signal.aborted || !opened) return;

  if (opened.kind === "profile") showProfile(body, opened);
  else showItem(body, opened, signal);
}
