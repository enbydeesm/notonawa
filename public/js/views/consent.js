// Consent view: shown in place of the journal when the privacy policy has
// changed in a way that needs agreeing to again (src/consent/). Until then
// nothing new can be saved, but Your data (export) and Account (delete)
// still open, so someone who doesn't agree can take their journal and go.

import { $, showMessage } from "../dom.js";
import { forgetPushDevice } from "../push.js";
import { api, errorMessage } from "../api.js";
import { navigate } from "../navigate.js";
import { lock } from "../vault.js";
import { consentState, setConsentState } from "../consent-state.js";

/**
 * @param {HTMLElement} _root
 * @param {{ signal: AbortSignal, unlocked: () => void }} context unlocked:
 *   draws the view the address is for
 */
export function mount(_root, { unlocked }) {
  const state = consentState();
  if (state?.summary) $("#consent-summary").textContent = state.summary;
  const box = /** @type {HTMLInputElement} */ ($("#consent-agree"));
  const go = /** @type {HTMLButtonElement} */ ($("#consent-go"));
  const message = $("#consent-message");
  box.addEventListener("change", () => { go.disabled = !box.checked; });

  go.addEventListener("click", async () => {
    if (!state) return;
    go.disabled = true;
    showMessage(message, "Saving…");
    try {
      await api("/api/consent", { method: "POST", body: { version: state.version, agree: true } });
      setConsentState({ ...state, needed: false, summary: null });
      unlocked();
    } catch (err) {
      showMessage(message, "Couldn't save: " + errorMessage(err), true);
      go.disabled = !box.checked;
    }
  });

  $("#consent-sign-out").addEventListener("click", async () => {
    try {
      await forgetPushDevice();
      await api("/api/auth/logout", { method: "POST", body: {} });
    } finally {
      lock();
      navigate("/signin", { replace: true });
    }
  });
}
