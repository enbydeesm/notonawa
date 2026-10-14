// People view.

import { h, $ } from "../dom.js";
import { confirmDeleteOrArchive } from "../dialog.js";
import { setupResourcePage } from "../resource-page.js";
import { capitalise } from "../format.js";
import { ROLES } from "../ties-view.js";

export function mount() {
  // Filled in when they're added to a tie (still changeable there).
  $("#default_role").append(...ROLES.map((role) => h("option", { value: role }, capitalise(role))));

  setupResourcePage({
    resource: "people",
    form: $("#form"),
    list: $("#list"),
    archivedToggle: $("#show-archived"),

    renderItem: (person) => [
      h("div", { className: "item-title" },
        person.name,
        person.is_self ? h("span", { className: "badge" }, "You") : null),
      person.pronouns || person.default_role
        ? h("div", { className: "item-meta" },
          [person.pronouns, person.default_role && `usually ${person.default_role}`].filter(Boolean).join(" · "))
        : null,
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
}
