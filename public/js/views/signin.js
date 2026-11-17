// Sign-in view: sign in (and unlock) with a passkey, create an account with
// an invite, get back in with a recovery code (then add a passkey), or sign
// in with another device that's signed in, by its camera scanning a code
// shown here (link-flows.js; then add a passkey).
// Anything left to do to unlock (the recovery code, setting up the key) is
// the Unlock view's, which the journal shows next.

import { api, errorMessage } from "../api.js";
import { $, showMessage } from "../dom.js";
import { tell } from "../dialog.js";
import { recoverySecret } from "../auth-flows.js";
import { signInAndUnlock, signUp, finishRecovery } from "../key-flows.js";
import { startLink, checkLink, finishLink } from "../link-flows.js";
import { qrCode } from "../share-code.js";
import { navigate } from "../navigate.js";
import { pendingShare } from "../pending-share.js";
import { pendingLink } from "../pending-link.js";
import { APP_VERSION } from "../releases.js";
import { reloadIfOutdated, watchVersion } from "../version-check.js";

// Into the journal. Replacing this entry, so Back doesn't return here (it
// would only send you on again).
// A share link or a new device's sign-in request waiting goes there.
function toJournal() {
  const waiting = pendingShare().link || pendingShare().damaged ? "/open"
    : pendingLink().scanned || pendingLink().damaged ? "/link" : "/";
  navigate(waiting, { replace: true });
}

const CHECK_EVERY_MS = 3000; // asking whether the other device has approved

/** @param {HTMLElement} _root @param {{ signal: AbortSignal }} context */
export async function mount(_root, { signal }) {
  const VIEWS = ["choose", "signup", "recover", "add-passkey", "link-wait", "link-passkey"];
  // A deploy while the page was open: reload into the new version (see
  // version-check.js), and once more before signing in.
  watchVersion(signal);
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
    if (await reloadIfOutdated()) return;
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

  // Signing in with another device: show the code, then ask every few
  // seconds whether it's been approved, until it is, it ends, or Back.
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let checking;
  const stopChecking = () => clearInterval(checking);
  signal.addEventListener("abort", stopChecking);
  $("#link-back").addEventListener("click", stopChecking);

  $("#link-start").addEventListener("click", () => attempt($("#sign-in-message"), async () => {
    if (await reloadIfOutdated()) return;
    stopChecking();
    const link = await startLink();
    if (signal.aborted) return;
    $("#link-number").textContent = String(link.number);
    $("#link-code").replaceChildren(qrCode(link.link, "QR code to scan with your other device"));
    /** @type {HTMLInputElement} */ ($("#link-address")).value = link.link;
    showMessage($("#sign-in-message"), "");
    const status = $("#link-status");
    showMessage(status, "Waiting for your other device… This code works for 5 minutes.");
    show("link-wait");

    const ends = Date.parse(link.expiresAt);
    let asking = false;
    checking = setInterval(async () => {
      if (asking) return;
      if (Date.now() > ends) {
        stopChecking();
        return showMessage(status, "This code has expired. Go back and start again.", true);
      }
      asking = true;
      try {
        if (await checkLink(link)) {
          stopChecking();
          show("link-passkey");
        }
      } catch (err) {
        stopChecking();
        showMessage(status, errorMessage(err), true);
      } finally {
        asking = false;
      }
    }, CHECK_EVERY_MS);
  }));

  $("#link-copy").addEventListener("click", async () => {
    const address = /** @type {HTMLInputElement} */ ($("#link-address"));
    try {
      await navigator.clipboard.writeText(address.value);
      showMessage($("#link-status"), "Link copied. Open it on your other device.");
    } catch {
      address.select();
      showMessage($("#link-status"), "Couldn't copy: select the link and copy it yourself.", true);
    }
  });

  $("#link-passkey-form").addEventListener("submit", (e) => {
    e.preventDefault();
    attempt($("#link-passkey-message"), async () => {
      const { canUnlock } = await finishLink(/** @type {HTMLInputElement} */ ($("#link-passkey-name")).value);
      showMessage($("#link-passkey-message"), "");
      if (!canUnlock) {
        await tell({
          title: "Signed in",
          message: "This device's passkey can't unlock your journal by itself, so it will ask for your recovery code next time.",
        });
      }
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
