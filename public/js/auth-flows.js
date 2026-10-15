// Sign-in flows shared by the sign-in, unlock and account views: signing in
// with a passkey, recovery codes, and "confirm it's you" before sensitive
// changes. Flows that involve the encryption key are in key-flows.js.

import { api, ApiError } from "./api.js";
import { h, privateField } from "./dom.js";
import { choose } from "./dialog.js";
import { usePasskey } from "./webauthn.js";
import { readRecoveryCode, loginSecret } from "./recovery.js";

/**
 * Signs in (or confirms it's you) with one of the user's passkeys, checked
 * by the server. Returns the passkey's PRF output, for unlocking (null if it
 * can't give it); the server is only told whether it gave it.
 * @returns {Promise<{ prfOutput: ArrayBuffer | null }>}
 */
export async function signInWithPasskey() {
  const options = await api("/api/auth/login/options", { method: "POST", body: {} });
  const { response, prfOutput } = await usePasskey(options);
  await api("/api/auth/login/verify", { method: "POST", body: { response, prf: prfOutput !== null } });
  return { prfOutput };
}

/**
 * The login secret to send for a recovery code (never the code itself).
 * @param {string} code as shown or typed
 */
export function recoverySecret(code) {
  const canonical = readRecoveryCode(code);
  if (!canonical) throw new Error("That doesn't look like a recovery code. It's 32 letters and numbers.");
  return loginSecret(canonical);
}

/**
 * Runs a change; if the server wants a recent sign-in first, asks the user to
 * use their passkey, then tries once more.
 * @template T
 * @param {() => Promise<T>} change
 * @returns {Promise<T>}
 */
export async function withReauth(change) {
  try {
    return await change();
  } catch (err) {
    if (!(err instanceof ApiError && err.reauth)) throw err;
    const go = await choose({
      title: "Confirm it's you",
      message: "For this change, use your passkey again.",
      choices: [{ label: "Use my passkey", value: "go" }],
    });
    if (!go) throw new Error("Cancelled.", { cause: err });
    await signInWithPasskey();
    return change();
  }
}

/**
 * Shows a recovery code once, in a dialog that only closes when the user
 * says they've saved it. The code is never stored by the page.
 * @param {string} code
 * @param {{ intro?: string }} [options] intro: why there's a new one
 * @returns {Promise<void>}
 */
export function showRecoveryCode(code, { intro } = {}) {
  return new Promise((resolve) => {
    const saved = h("input", { type: "checkbox", id: "recovery-saved" });
    const done = h("button", { type: "button", className: "primary", disabled: true, onclick: () => dialog.close() }, "Done");
    const copy = h("button", { type: "button", onclick: copyCode }, "Copy");
    saved.addEventListener("change", () => { done.disabled = !saved.checked; });

    async function copyCode() {
      try {
        await navigator.clipboard.writeText(code);
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Couldn't copy: select it instead";
      }
    }

    const dialog = h("dialog", { className: "form-dialog", "aria-labelledby": "recovery-heading", onclose: () => { dialog.remove(); resolve(); } },
      h("h2", { id: "recovery-heading" }, "Your recovery code"),
      intro ? h("p", {}, intro) : null,
      h("p", {}, "Save it somewhere safe, like a password manager or on paper. If you lose all your passkeys, " +
        "it's the only way back in. It won't be shown again, and we can't see it."),
      h("p", { className: "recovery-code", id: "recovery-code" }, code),
      copy,
      h("label", { className: "inline" }, saved, "I've saved it somewhere safe"),
      done);
    // Esc can't close it: the user must confirm they've saved the code.
    dialog.addEventListener("cancel", (e) => e.preventDefault());
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * Asks for the recovery code in a dialog. null if cancelled.
 * @param {{ title: string, message: string }} text
 * @returns {Promise<string | null>} as typed
 */
export function askRecoveryCode({ title, message }) {
  return new Promise((resolve) => {
    /** @type {string | null} */
    let result = null;
    const input = privateField(h("input", { id: "ask-code", autocapitalize: "characters", "aria-label": "Recovery code" }));
    const form = h("form", { onsubmit: (/** @type {Event} */ e) => { e.preventDefault(); result = input.value; dialog.close(); } },
      input,
      h("div", { className: "dialog-buttons" },
        h("button", { type: "submit", className: "primary" }, "Continue"),
        h("button", { type: "button", onclick: () => dialog.close() }, "Cancel")));
    const dialog = h("dialog", { onclose: () => { dialog.remove(); resolve(result); } }, h("h2", {}, title), h("p", {}, message), form);
    document.body.append(dialog);
    dialog.showModal();
  });
}
