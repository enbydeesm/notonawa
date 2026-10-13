// Locations page.

import { h, $ } from "../dom.js";
import { renderNav } from "../nav.js";
import { confirmDeleteOrArchive } from "../dialog.js";
import { setupResourcePage } from "../resource-page.js";

renderNav("/locations");

setupResourcePage({
  resource: "locations",
  form: $("#form"),
  list: $("#list"),
  archivedToggle: $("#show-archived"),

  renderItem: (loc) => [
    h("div", { className: "item-title" }, loc.name),
    loc.hard_points ? h("div", { className: "item-notes" }, loc.hard_points) : null,
    loc.notes ? h("div", { className: "item-notes item-meta" }, loc.notes) : null,
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
