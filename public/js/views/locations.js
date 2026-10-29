// Locations view: "Add a Location" (the + opens the form in a dialog, as
// tapping a name does), a search over them, and the list. The dialog holds
// Archive (or Restore) and Delete; the cards have no buttons.

import { h, $ } from "../dom.js";
import { api, errorMessage } from "../api.js";
import { choose, confirmDeleteOrArchive } from "../dialog.js";
import { setupResourcePage } from "../resource-page.js";
import { placeText } from "../list-order.js";

/**
 * @param {HTMLElement} _root the view's element
 * @param {{ signal: AbortSignal }} context signal: fires when the view is left
 */
export function mount(_root, { signal }) {
  // "Default on new ties": one location at most. Ticking it when another is
  // the default asks first; the server moves it from that one on saving.
  // Not offered for a location being archived as it's added.
  /** @type {string | null} */
  let editingId = null;
  const isDefault = /** @type {HTMLInputElement} */ ($("#location-is_default"));
  const archiveNow = /** @type {HTMLInputElement} */ ($("#location-archive_now"));
  function showDefaultFlag() {
    const archiving = !editingId && archiveNow.checked;
    if (archiving) isDefault.checked = false;
    $("#location-default-flag").hidden = archiving;
  }
  archiveNow.addEventListener("change", showDefaultFlag);
  isDefault.addEventListener("change", async () => {
    if (!isDefault.checked) return;
    let current;
    try {
      /** @type {Record<string, any>[]} */
      const active = await api("/api/locations?archived=false");
      current = active.find((loc) => loc.is_default && loc.id !== editingId);
    } catch {
      return; // the server still keeps just one
    }
    if (!current) return;
    const choice = await choose({
      title: `Replace ${current.name} as your default location?`,
      message: "New ties will start at this location instead.",
      choices: [{ label: "Replace", value: "replace" }],
    });
    if (choice !== "replace") isDefault.checked = false;
  });

  const page = setupResourcePage({
    resource: "locations",
    signal,
    form: $("#form"),
    list: $("#list"),
    archivedToggle: $("#show-archived"),
    dialog: $("#location-dialog"),
    actionsInDialog: true,
    // The default location stays at the top, whatever the order.
    searchable: { noun: "locations", pinned: (loc) => !!loc.is_default, slot: $("#locations-search") },
    onEdit: (loc) => { editingId = loc?.id ?? null; showDefaultFlag(); },

    // The name (which opens the dialog), then where it is and its notes.
    renderItem: (loc, _locations, edit) => {
      const place = placeText({ city: loc.city, state_province: loc.state_province, country: loc.country });
      // The API only accepts http(s) links; check again before making one clickable.
      const maps = /^https?:\/\//.test(loc.maps_url || "");
      return [
        h("div", { className: "item-title name-title" },
          h("button", { type: "button", className: "name-button", onclick: edit }, loc.name),
          loc.is_default ? h("span", { className: "badge" }, "Default") : null),
        // Where it is, with Open in Maps at the right of the same row.
        place || maps ? h("div", { className: "place-row" },
          place ? h("span", { className: "item-meta" }, place) : null,
          maps ? h("a", { className: "maps-link", href: loc.maps_url, target: "_blank", rel: "noopener noreferrer" }, "Open in Maps") : null) : null,
        loc.notes ? h("div", { className: "item-notes" }, loc.notes) : null,
      ];
    },

    confirmDelete: (loc) =>
      confirmDeleteOrArchive({
        title: `Delete ${loc.name}?`,
        message: `This can't be undone. Ties here will show "(location deleted)".` +
          (loc.archived_at ? "" : " If you just won't tie here again, archive it instead."),
        archived: !!loc.archived_at,
      }),
  });

  $("#add-location").addEventListener("click", () => page.add(), { signal });

  // Pasting a Google Maps link fills in the coordinates, which can still be
  // edited. The server reads them (following a short link to Google if needed),
  // as the page itself can't reach Google.
  const mapsUrl = /** @type {HTMLInputElement} */ ($("#location-maps_url"));
  const latitude = /** @type {HTMLInputElement} */ ($("#location-latitude"));
  const longitude = /** @type {HTMLInputElement} */ ($("#location-longitude"));
  const mapsHint = $("#location-maps-hint");
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
    $("#location-default-flag").hidden = false;
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
