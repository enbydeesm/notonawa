// Sign-in flows shared by the sign-in and account pages: signing in with a
// passkey, adding one, making a new recovery code, and "confirm it's you"
// before sensitive changes.

import { api, ApiError } from "./api.js";
import { h } from "./dom.js";
import { choose } from "./dialog.js";
import { createPasskey, usePasskey } from "./webauthn.js";
import { newRecoveryCode, readRecoveryCode, loginSecret } from "./recovery.js";

/** Signs in (or confirms it's you) with one of the user's passkeys. */
export async function signInWithPasskey() {
  const options = await api("/api/auth/login/options", { method: "POST", body: {} });
  const response = await usePasskey(options);
  await api("/api/auth/login/verify", { method: "POST", body: { response } });
}

/**
 * Adds a passkey on this device to the signed-in account.
 * @param {string} name
 */
export async function addPasskey(name) {
  const options = await api("/api/auth/register/options", { method: "POST", body: {} });
  const { response, prfCapable } = await createPasskey(options);
  await api("/api/auth/register/verify", { method: "POST", body: { response, name, prf_capable: prfCapable } });
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

/** Makes a new recovery code, saves it, and shows it to the user once. */
export async function replaceRecoveryCode() {
  const code = newRecoveryCode();
  await api("/api/account/recovery-code", { method: "PUT", body: { recovery_secret: await recoverySecret(code) } });
  await showRecoveryCode(code);
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
 * @returns {Promise<void>}
 */
export function showRecoveryCode(code) {
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
