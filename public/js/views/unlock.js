// Unlock view: shown (by app.js) in place of any view that needs the
// encryption key while the journal is locked. Unlocks with a passkey, or the
// recovery code; sets up the first key for an account from before
// encryption; and, if the recovery code was replaced by the operator, offers
// an older code or a new key.

import { api, ApiError, errorMessage } from "../api.js";
import { forgetPushDevice } from "../push.js";
import { $, showMessage } from "../dom.js";
import { choose } from "../dialog.js";
import { navigate } from "../navigate.js";
import { WrongSecret } from "../vault.js";
import { reloadIfOutdated, watchVersion } from "../version-check.js";
import {
  signInAndUnlock, takeSignInResult, unlockWithCode, recoveryCodeWasReplaced, setUpKey, forgetPending,
} from "../key-flows.js";
import { APP_VERSION } from "../releases.js";

/** @typedef {import("../key-flows.js").UnlockResult} UnlockResult */

const CARDS = ["choose", "code", "setup", "cant"];

const WHY_CODE = {
  "no-prf": "This passkey can't unlock your journal (its device doesn't support it), so use your recovery code.",
  "no-wrap": "This passkey can't unlock your journal yet. Use your recovery code once; after that, this passkey will.",
  chosen: "",
};

/**
 * @param {HTMLElement} _root the view's element
 * @param {{ unlocked: () => void, signal: AbortSignal }} context unlocked: draws the view the address
 *   is for; signal: aborts when the view is left
 */
export async function mount(_root, { unlocked, signal }) {
  // A deploy while the page was open: reload into the new version now,
  // while there's nothing unlocked to lose.
  watchVersion(signal);
  $("#unlock-version").textContent = `Version ${APP_VERSION}`;

  /** @param {string} name */
  function show(name) {
    for (const card of CARDS) $(`#unlock-${card}`).hidden = card !== name;
  }

  /** @param {keyof typeof WHY_CODE} why */
  function showCode(why) {
    $("#unlock-code-why").textContent = WHY_CODE[why];
    show("code");
    $("#unlock-code-input").focus();
  }

  /** @param {UnlockResult} result */
  function next(result) {
    if (result.state === "unlocked") unlocked();
    else if (result.state === "setup") show("setup");
    else showCode(result.reason);
  }

  /**
   * @param {HTMLElement} message
   * @param {() => Promise<void>} step
   */
  async function attempt(message, step) {
    showMessage(message, "Working…");
    try {
      await step();
      showMessage(message, "");
    } catch (err) {
      showMessage(message, errorMessage(err), true);
    }
  }

  for (const link of document.querySelectorAll("[data-unlock-show]")) {
    link.addEventListener("click", () => {
      const name = /** @type {HTMLElement} */ (link).dataset.unlockShow ?? "choose";
      if (name === "code") showCode("chosen");
      else show(name);
    });
  }

  // Asked once more before unlocking: unlocking the old version would only
  // be lost to the reload later. Reloading instead, Unlock is tapped again.
  $("#unlock-passkey").addEventListener("click", () =>
    attempt($("#unlock-passkey-message"), async () => {
      if (await reloadIfOutdated()) return;
      next(await signInAndUnlock());
    }));

  $("#unlock-code-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = /** @type {HTMLInputElement} */ ($("#unlock-code-input"));
    const message = $("#unlock-code-message");
    attempt(message, async () => {
      try {
        await unlockWithCode(input.value);
      } catch (err) {
        if (!(err instanceof WrongSecret)) throw err;
        if (await recoveryCodeWasReplaced()) {
          input.value = "";
          show("cant");
          return;
        }
        throw new Error("That recovery code doesn't unlock your journal.", { cause: err });
      }
      input.value = "";
      unlocked();
    });
  });

  $("#unlock-setup-go").addEventListener("click", () => attempt($("#unlock-setup-message"), async () => {
    await setUpKey();
    unlocked();
  }));

  $("#unlock-new-key").addEventListener("click", () => attempt($("#unlock-new-key-message"), async () => {
    const ok = await choose({
      title: "Start a new encryption key?",
      message: "Anything encrypted with your old key can't be read again, by you or by us. " +
        "You'll use your passkey, then get a new recovery code.",
      choices: [{ label: "Start a new key", value: "new", style: "solid-danger" }],
    });
    if (!ok) return;
    await setUpKey({ replace: true });
    unlocked();
  }));

  $("#unlock-sign-out").addEventListener("click", async () => {
    forgetPending();
    try {
      await forgetPushDevice();
      await api("/api/auth/logout", { method: "POST", body: {} });
    } finally {
      navigate("/signin", { replace: true });
    }
  });

  // Signed out, or only part-way through signing in with a recovery code?
  // Then it's the sign-in view's job. (api() goes there itself on a 401.)
  // Signed out meanwhile (signing out locks, which draws this view, then
  // goes to sign-in), or left: it's no longer this view's to answer.
  const account = await api("/api/account").catch((err) => {
    if (signal.aborted || (err instanceof ApiError && err.status === 401)) return null;
    throw err;
  });
  if (!account) return;
  if (account.session_kind === "recovery") {
    navigate("/signin", { replace: true });
    return;
  }
  const result = takeSignInResult();
  if (result) next(result);
  else show("choose");
}
