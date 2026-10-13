// People page.

import { h, $ } from "../dom.js";
import { renderNav } from "../nav.js";
import { confirmDeleteOrArchive } from "../dialog.js";
import { setupResourcePage } from "../resource-page.js";

renderNav("/people");

setupResourcePage({
  resource: "people",
  form: $("#form"),
  list: $("#list"),
  archivedToggle: $("#show-archived"),

  renderItem: (person) => [
    h("div", { className: "item-title" },
      person.name,
      person.is_self ? h("span", { className: "badge" }, "You") : null),
    person.pronouns ? h("div", { className: "item-meta" }, person.pronouns) : null,
    person.notes ? h("div", { className: "item-notes" }, person.notes) : null,
  ],

  confirmDelete: (person) =>
    confirmDeleteOrArchive({
      title: `Delete ${person.name}?`,
      message: `This can't be undone. Ties they were in will show "(person deleted)".` +
        (person.archived_at ? "" : " If you just won't tie with them again, archive them instead."),
      archived: !!person.archived_at,
    }),
});
