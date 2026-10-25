// Sign-in view: sign in (and unlock) with a passkey, create an account with
// an invite, or get back in with a recovery code (then add a passkey).
// Anything left to do to unlock (the recovery code, setting up the key) is
// the Unlock view's, which the journal shows next.

import { api, errorMessage } from "../api.js";
import { $, showMessage } from "../dom.js";
import { recoverySecret } from "../auth-flows.js";
import { signInAndUnlock, signUp, finishRecovery } from "../key-flows.js";
import { navigate } from "../navigate.js";
import { pendingShare } from "../pending-share.js";
import { APP_VERSION } from "../releases.js";

// Into the journal. Replacing this entry, so Back doesn't return here (it
// would only send you on again).
const toJournal = () => navigate(pendingShare().link || pendingShare().damaged ? "/open" : "/", { replace: true });

export async function mount() {
  const VIEWS = ["choose", "signup", "recover", "add-passkey"];
  $("#signin-version").textContent = `Version ${APP_VERSION}`;

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
    await signInAndUnlock();
    toJournal();
  }));

  // The recovery code that signed in, until a passkey is added: it unlocks
  // the journal to wrap the key for the new passkey. Only in memory.
  /** @type {string | null} */
  let recoveryCode = null;

  $("#signup-form").addEventListener("submit", (e) => {
    e.preventDefault();
    attempt($("#signup-message"), async () => {
      /** @param {string} id */
      const value = (id) => /** @type {HTMLInputElement} */ ($(id)).value;
      /** @param {string} id */
      const checked = (id) => /** @type {HTMLInputElement} */ ($(id)).checked;
      await signUp({ invite: value("#invite"), adult: checked("#adult"), consent: checked("#consent"), name: value("#passkey-name") });
      showMessage($("#signup-message"), "");
      toJournal();
    });
  });

  $("#recover-form").addEventListener("submit", (e) => {
    e.preventDefault();
    attempt($("#recover-message"), async () => {
      const code = /** @type {HTMLInputElement} */ ($("#code"));
      await api("/api/auth/recover", { method: "POST", body: { recovery_secret: await recoverySecret(code.value) } });
      recoveryCode = code.value;
      code.value = "";
      showMessage($("#recover-message"), "");
      show("add-passkey");
    });
  });

  $("#add-passkey-form").addEventListener("submit", (e) => {
    e.preventDefault();
    attempt($("#add-passkey-message"), async () => {
      if (!recoveryCode) {
        show("recover");
        throw new Error("Enter your recovery code again, please.");
      }
      // Adds the passkey, unlocks with the code, and replaces the code.
      await finishRecovery(recoveryCode, /** @type {HTMLInputElement} */ ($("#new-passkey-name")).value);
      recoveryCode = null;
      toJournal();
    });
  });

  // Already signed in? Go to the journal. Part-way through a recovery (the
  // page was reloaded)? The code is needed again, to unlock.
  try {
    const account = await api("/api/account");
    if (account.session_kind === "recovery") show("recover");
    else toJournal();
  } catch {
    show("choose");
  }
}
