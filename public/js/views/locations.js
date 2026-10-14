// Locations view.

import { h, $ } from "../dom.js";
import { api, errorMessage } from "../api.js";
import { confirmDeleteOrArchive } from "../dialog.js";
import { setupResourcePage } from "../resource-page.js";

/**
 * @param {HTMLElement} _root the view's element
 * @param {{ signal: AbortSignal }} context signal: fires when the view is left
 */
export function mount(_root, { signal }) {
  setupResourcePage({
    resource: "locations",
    form: $("#form"),
    list: $("#list"),
    archivedToggle: $("#show-archived"),

    renderItem: (loc) => [
      h("div", { className: "item-title" }, loc.name),
      loc.notes ? h("div", { className: "item-notes" }, loc.notes) : null,
      // The API only accepts http(s) links; check again before making one clickable.
      /^https?:\/\//.test(loc.maps_url || "")
        ? h("div", {}, h("a", { href: loc.maps_url, target: "_blank", rel: "noopener noreferrer" }, "Open in Maps"))
        : null,
    ],

    confirmDelete: (loc) =>
      confirmDeleteOrArchive({
        title: `Delete ${loc.name}?`,
        message: `This can't be undone. Ties here will show "(location deleted)".` +
          (loc.archived_at ? "" : " If you just won't tie here again, archive it instead."),
        archived: !!loc.archived_at,
      }),
  });

  // Pasting a Google Maps link fills in the coordinates, which can still be
  // edited. The server reads them (following a short link to Google if needed),
  // as the page itself can't reach Google.
  const mapsUrl = /** @type {HTMLInputElement} */ ($("#maps_url"));
  const latitude = /** @type {HTMLInputElement} */ ($("#latitude"));
  const longitude = /** @type {HTMLInputElement} */ ($("#longitude"));
  const mapsHint = $("#maps-hint");
  const HINT = mapsHint.textContent;
  let lookup = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  mapsUrl.addEventListener("input", () => {
    clearTimeout(timer);
    const link = mapsUrl.value.trim();
    const current = ++lookup;
    if (!/^https?:\/\/\S+$/.test(link)) {
      mapsHint.textContent = HINT;
      return;
    }
    timer = setTimeout(() => findCoords(link, current), 400);
  });
  signal.addEventListener("abort", () => clearTimeout(timer));

  // Saving, editing another location or cancelling resets the form, and the hint.
  $("#form").addEventListener("reset", () => {
    clearTimeout(timer);
    lookup++;
    mapsHint.textContent = HINT;
  });

  /**
   * @param {string} link
   * @param {number} current which lookup this is; a newer one wins
   */
  async function findCoords(link, current) {
    mapsHint.textContent = "Finding coordinates…";
    let text;
    try {
      const coords = await api("/api/locations/coords", { method: "POST", body: { url: link } });
      if (current !== lookup) return;
      if (coords.latitude === null) {
        text = "Couldn't find coordinates in that link. Enter them yourself.";
      } else {
        latitude.value = String(coords.latitude);
        longitude.value = String(coords.longitude);
        text = "Coordinates filled in from the link.";
      }
    } catch (err) {
      if (current !== lookup) return;
      text = errorMessage(err);
    }
    mapsHint.textContent = text;
  }
}
