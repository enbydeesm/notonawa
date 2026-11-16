// Convert view: shown in place of the journal while a format 1 account
// converts to format 2 (store/convert.js), after unlocking. One step, then
// the journal opens as it was, now kept as sealed records. Your data and
// Account still open meanwhile, as for Consent: someone can export first.
//
// A conversion that has already started (a tab that closed, or another
// device) is carried on from where it got to: the ids are worked out the
// same everywhere, and every save is checked, so carrying on is safe even
// if another device is at it too.

import { $, showMessage } from "../dom.js";
import { convertJournal } from "../store/convert.js";
import { restartJournal } from "../store/v2/journal.js";
import { progressText } from "../convert/offer.js";
import { noteActivity } from "../lock.js";
import { api, errorMessage } from "../api.js";

/**
 * @param {HTMLElement} _root
 * @param {{ signal: AbortSignal, unlocked: () => void }} context unlocked:
 *   draws the view the address is for
 */
export async function mount(_root, { signal, unlocked }) {
  const go = /** @type {HTMLButtonElement} */ ($("#convert-go"));
  const message = $("#convert-message");
  const started = !!(await api("/api/keys")).converting;
  $("#convert-started").hidden = !started;
  go.textContent = started ? "Continue on this device" : "Update now";

  go.addEventListener("click", async () => {
    go.disabled = true;
    showMessage(message, "Starting…");
    try {
      const result = await convertJournal({
        progress: (p) => {
          noteActivity();
          if (!signal.aborted) showMessage(message, progressText(p));
        },
      });
      await restartJournal();
      const lost = [
        result.unreadable ? `${result.unreadable} notes or captions couldn't be decrypted, as before, and are left out.` : "",
        result.unconverted ? `${result.unconverted} entries had something that couldn't be carried over; it's kept with them.` : "",
      ].filter(Boolean).join(" ");
      if (lost) alertOnce(lost);
      unlocked();
    } catch (err) {
      showMessage(message, "Couldn't finish updating: " + errorMessage(err) + " Nothing is lost: try again.", true);
      go.textContent = "Try again";
      go.disabled = false;
    }
  }, { signal });
}

/**
 * Says what didn't come across, once, over the journal.
 * @param {string} text
 */
function alertOnce(text) {
  const note = document.createElement("p");
  note.className = "toast";
  note.setAttribute("role", "status");
  note.textContent = text;
  document.body.append(note);
  setTimeout(() => note.remove(), 8000);
}
