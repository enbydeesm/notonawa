// Sign-in view: sign in with a passkey, create an account with an invite,
// or get back in with a recovery code (then add a passkey).

import { api, errorMessage } from "../api.js";
import { $, showMessage } from "../dom.js";
import { createPasskey } from "../webauthn.js";
import { newRecoveryCode } from "../recovery.js";
import { signInWithPasskey, addPasskey, recoverySecret, replaceRecoveryCode, showRecoveryCode } from "../auth-flows.js";
import { navigate } from "../navigate.js";

// Into the journal. Replacing this entry, so Back doesn't return here (it
// would only send you on again).
const toJournal = () => navigate("/", { replace: true });

export async function mount() {
  const VIEWS = ["choose", "signup", "recover", "add-passkey"];

  /** @param {string} name */
  function show(name) {
    for (const view of VIEWS) $(`#${view}`).hidden = view !== name;
  }

  for (const link of document.querySelectorAll("[data-show]")) {
    link.addEventListener("click", () => show(/** @type {HTMLElement} */ (link).dataset.show ?? "choose"));
  }

  /**
   * Runs a step, showing "Working…" and then any error under it.
   * @param {HTMLElement} message
   * @param {() => Promise<void>} step
   */
  async function attempt(message, step) {
    showMessage(message, "Working…");
    try {
      await step();
    } catch (err) {
      showMessage(message, errorMessage(err), true);
    }
  }

  $("#sign-in").addEventListener("click", () => attempt($("#sign-in-message"), async () => {
    await signInWithPasskey();
    toJournal();
  }));

  $("#signup-form").addEventListener("submit", (e) => {
    e.preventDefault();
    attempt($("#signup-message"), async () => {
      /** @param {string} id */
      const value = (id) => /** @type {HTMLInputElement} */ ($(id)).value;
      /** @param {string} id */
      const checked = (id) => /** @type {HTMLInputElement} */ ($(id)).checked;
      // The recovery code is made here and never sent: only a secret derived from it.
      const code = newRecoveryCode();
      const options = await api("/api/auth/register/options", {
        method: "POST", body: { invite: value("#invite"), adult: checked("#adult"), consent: checked("#consent") },
      });
      const { response, prfCapable } = await createPasskey(options);
      await api("/api/auth/register/verify", {
        method: "POST",
        body: { response, name: value("#passkey-name"), prf_capable: prfCapable, recovery_secret: await recoverySecret(code) },
      });
      showMessage($("#signup-message"), "");
      await showRecoveryCode(code);
      toJournal();
    });
  });

  $("#recover-form").addEventListener("submit", (e) => {
    e.preventDefault();
    attempt($("#recover-message"), async () => {
      const code = /** @type {HTMLInputElement} */ ($("#code"));
      await api("/api/auth/recover", { method: "POST", body: { recovery_secret: await recoverySecret(code.value) } });
      code.value = "";
      show("add-passkey");
    });
  });

  $("#add-passkey-form").addEventListener("submit", (e) => {
    e.preventDefault();
    attempt($("#add-passkey-message"), async () => {
      await addPasskey(/** @type {HTMLInputElement} */ ($("#new-passkey-name")).value);
      // The old code got you in; replace it now that there's a passkey.
      await replaceRecoveryCode();
      toJournal();
    });
  });

  // Already signed in? Go to the journal, or finish a recovery.
  try {
    const account = await api("/api/account");
    if (account.session_kind === "recovery") show("add-passkey");
    else toJournal();
  } catch {
    show("choose");
  }
}
