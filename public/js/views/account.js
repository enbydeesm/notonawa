// Account page: my passkeys, where I'm signed in, my recovery code and
// recovery email, and signing out.

import { api, errorMessage } from "../api.js";
import { h, $, showMessage, privateField, infoButton } from "../dom.js";
import { renderNav } from "../nav.js";
import { choose } from "../dialog.js";
import { formatDate } from "../format.js";
import { addPasskey, replaceRecoveryCode, withReauth } from "../auth-flows.js";
import { forgetPasskeys } from "../webauthn.js";
import { readRecoveryEmail, newRecoveryEmailHash } from "../recovery-email.js";

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
  showRecoveryEmail(account.has_recovery_email);
}

/**
 * Shows the recovery email card: the form when there's none, otherwise
 * Change and Remove (the address itself can't be shown: we never have it).
 * @param {boolean} isSet
 * @param {boolean} [changing] showing the form to replace one that's set
 */
function showRecoveryEmail(isSet, changing = false) {
  $("#email-status").textContent = isSet
    ? "A recovery email is set. We can't see it. If you ever lose every passkey and your recovery code, contact us from that address."
    : "None set. Add one so we can check it's you if you ever lose every passkey and your recovery code.";
  $("#email-form").hidden = isSet && !changing;
  $("#email-cancel").hidden = !changing;
  $("#email-actions").hidden = !isSet || changing;
}

infoButton($("#email-info-button"));

$("#email-form").addEventListener("submit", (e) => {
  e.preventDefault();
  /** @type {HTMLInputElement} */
  const field = $("#recovery-email");
  /** @type {HTMLInputElement} */
  const again = $("#recovery-email-again");
  const message = $("#email-message");
  attempt(message, async () => {
    const email = readRecoveryEmail(field.value);
    if (!email) throw new Error("That doesn't look like an email address.");
    if (readRecoveryEmail(again.value) !== email) throw new Error("The two addresses don't match.");
    showMessage(message, "Saving…");
    // Hashed once, before asking to confirm it's you, as it takes a moment.
    const body = await newRecoveryEmailHash(email);
    await withReauth(() => api("/api/account/recovery-email", { method: "PUT", body }));
    field.value = "";
    again.value = "";
    showMessage(message, "Saved.");
  });
});

$("#email-change").addEventListener("click", () => {
  showMessage($("#email-message"), "");
  showRecoveryEmail(true, true);
});
$("#email-cancel").addEventListener("click", () => {
  showMessage($("#email-message"), "");
  showRecoveryEmail(true);
});

$("#email-remove").addEventListener("click", () => attempt($("#email-message"), async () => {
  const ok = await choose({
    title: "Remove your recovery email?",
    message: "If you lose every passkey and your recovery code, we won't be able to check the account is yours.",
    choices: [{ label: "Remove", value: "remove", style: "solid-danger" }],
  });
  if (ok) await withReauth(() => api("/api/account/recovery-email", { method: "DELETE" }));
}));

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

$("#delete-account").addEventListener("click", async () => {
  const message = $("#delete-message");
  showMessage(message, "");
  if (!(await confirmDeleteAccount())) return;
  try {
    const { passkey_ids } = await withReauth(() => api("/api/account", { method: "DELETE" }));
    await forgetPasskeys(passkey_ids);
    $("main").replaceChildren(
      h("h1", {}, "Account deleted"),
      h("section", { className: "card" },
        h("p", {}, "Your account and everything in your journal have been deleted."),
        h("p", { className: "hint" }, "Your device may still list a passkey for Rope Journal. You can remove it in your " +
          "device's or password manager's settings."),
        h("a", { href: "/signin" }, "Back to the sign-in page")));
  } catch (err) {
    showMessage(message, "Couldn't delete your account: " + errorMessage(err), true);
  }
});

/**
 * Asks the user to type "delete" before the final button works, so it can't
 * be done with a slip of the finger.
 * @returns {Promise<boolean>}
 */
function confirmDeleteAccount() {
  return new Promise((resolve) => {
    let confirmed = false;
    const input = privateField(h("input", { id: "delete-confirm", "aria-describedby": "delete-confirm-hint" }));
    const button = h("button", { type: "submit", className: "danger solid", disabled: true }, "Delete everything");
    input.addEventListener("input", () => { button.disabled = input.value.trim().toLowerCase() !== "delete"; });
    const form = h("form", { onsubmit: (/** @type {Event} */ e) => { e.preventDefault(); confirmed = true; dialog.close(); } },
      h("label", { for: "delete-confirm", id: "delete-confirm-hint" }, "Type delete to confirm"),
      input,
      h("div", { className: "dialog-buttons" },
        button,
        h("button", { type: "button", onclick: () => dialog.close() }, "Cancel")));
    const dialog = h("dialog", { onclose: () => { dialog.remove(); resolve(confirmed); } },
      h("h2", {}, "Delete your account?"),
      h("p", {}, "Your journal (every tie, plan, person, location and tag), your passkeys and your recovery code " +
        "will be deleted straight away. This can't be undone."),
      form);
    document.body.append(dialog);
    dialog.showModal();
  });
}

load().catch((err) => showMessage($("#passkey-message"), "Couldn't load your account: " + errorMessage(err), true));
