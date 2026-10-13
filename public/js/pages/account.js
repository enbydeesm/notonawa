// Account page: my passkeys, where I'm signed in, my recovery code, and
// signing out.

import { api, errorMessage } from "../api.js";
import { h, $, showMessage, privateField } from "../dom.js";
import { renderNav } from "../nav.js";
import { choose } from "../dialog.js";
import { formatDate } from "../format.js";
import { addPasskey, replaceRecoveryCode, withReauth } from "../auth-flows.js";

renderNav("/account");

/** @param {string | null} iso a timestamp */
const day = (iso) => (iso ? formatDate(iso.slice(0, 10)) : "never");

/**
 * Runs an action, then reloads the page's lists; errors show under it.
 * @param {HTMLElement} message
 * @param {() => Promise<unknown>} action
 */
async function attempt(message, action) {
  showMessage(message, "");
  try {
    await action();
    await load();
  } catch (err) {
    showMessage(message, errorMessage(err), true);
  }
}

/**
 * @param {Record<string, any>} passkey
 * @param {number} count how many I have
 */
function renderPasskey(passkey, count) {
  const message = $("#passkey-message");
  const rename = () => attempt(message, async () => {
    const name = await askName(passkey.name);
    if (name !== null) await api(`/api/account/passkeys/${passkey.id}`, { method: "PATCH", body: { name } });
  });
  const remove = () => attempt(message, async () => {
    const ok = await choose({
      title: `Remove "${passkey.name}"?`,
      message: "You won't be able to sign in with it any more, and anywhere signed in with it will be signed out.",
      choices: [{ label: "Remove passkey", value: "remove", style: "solid-danger" }],
    });
    if (ok) await withReauth(() => api(`/api/account/passkeys/${passkey.id}`, { method: "DELETE" }));
  });
  return h("div", { className: "item" },
    h("div", { className: "item-title" }, passkey.name),
    h("div", { className: "item-meta" }, `Added ${day(passkey.created_at)} · Last used ${day(passkey.last_used_at)}`),
    h("div", { className: "item-actions" },
      h("button", { type: "button", onclick: rename }, "Rename"),
      count > 1 ? h("button", { type: "button", className: "danger", onclick: remove }, "Remove") : null));
}

/** @param {Record<string, any>} session */
function renderSession(session) {
  const end = () => attempt($("#session-message"), () => api(`/api/account/sessions/${session.id}`, { method: "DELETE" }));
  return h("div", { className: "item" },
    h("div", { className: "item-title" },
      session.passkey_name ? `Signed in with ${session.passkey_name}` : "Signed in with a recovery code",
      session.current ? h("span", { className: "badge" }, "This device") : null),
    h("div", { className: "item-meta" }, `Since ${day(session.created_at)} · Last active ${day(session.last_used_at)}`),
    session.current ? null : h("div", { className: "item-actions" }, h("button", { type: "button", onclick: end }, "Sign out")));
}

/**
 * A small dialog asking for a passkey's name. null if cancelled.
 * @param {string} current
 * @returns {Promise<string | null>}
 */
function askName(current) {
  return new Promise((resolve) => {
    /** @type {string | null} */
    let result = null;
    const input = privateField(h("input", { id: "rename-input", value: current, maxLength: 60, "aria-label": "Passkey name" }));
    const form = h("form", { onsubmit: (/** @type {Event} */ e) => { e.preventDefault(); result = input.value; dialog.close(); } },
      input,
      h("div", { className: "dialog-buttons" },
        h("button", { type: "submit", className: "primary" }, "Save"),
        h("button", { type: "button", onclick: () => dialog.close() }, "Cancel")));
    const dialog = h("dialog", { onclose: () => { dialog.remove(); resolve(result); } }, h("h2", {}, "Rename passkey"), form);
    document.body.append(dialog);
    dialog.showModal();
  });
}

async function load() {
  const account = await api("/api/account");
  $("#passkeys").replaceChildren(...account.passkeys.map((/** @type {any} */ p) => renderPasskey(p, account.passkeys.length)));
  $("#sessions").replaceChildren(...account.sessions.map(renderSession));
  /** @type {HTMLButtonElement} */ ($("#end-others")).hidden = account.sessions.length < 2;
  $("#recovery-status").textContent = account.has_recovery_code
    ? "You have a recovery code. Making a new one replaces it."
    : "You don't have a recovery code. Make one so you can get back in if you lose your passkeys.";
}

$("#add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = /** @type {HTMLInputElement} */ ($("#add-name"));
  attempt($("#passkey-message"), async () => {
    await withReauth(() => addPasskey(name.value));
    name.value = "";
  });
});

$("#end-others").addEventListener("click", () =>
  attempt($("#session-message"), () => api("/api/account/sessions/end-others", { method: "POST" })));

$("#new-code").addEventListener("click", () => attempt($("#recovery-message"), async () => {
  const ok = await choose({
    title: "Make a new recovery code?",
    message: "Your current code will stop working.",
    choices: [{ label: "Make a new code", value: "new" }],
  });
  if (ok) await withReauth(replaceRecoveryCode);
}));

$("#sign-out").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST", body: {} });
    location.href = "/signin";
  } catch (err) {
    showMessage($("#sign-out-message"), errorMessage(err), true);
  }
});

load().catch((err) => showMessage($("#passkey-message"), "Couldn't load your account: " + errorMessage(err), true));
