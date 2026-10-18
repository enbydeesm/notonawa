// People view.

import { h, $ } from "../dom.js";
import { confirmDeleteOrArchive } from "../dialog.js";
import { setupResourcePage } from "../resource-page.js";
import { roleName, roleOptions } from "../roles.js";

export function mount() {
  // Filled in when they're added to a tie (still changeable there).
  $("#default_role").append(...roleOptions().map((r) => h("option", { value: r.value }, r.label)));

  setupResourcePage({
    resource: "people",
    form: $("#form"),
    list: $("#list"),
    archivedToggle: $("#show-archived"),
    // My own profile stays at the top, whatever the order.
    searchable: { noun: "people", pinned: (person) => !!person.is_self },

    // "This is me" is shown only on my own profile, and can't be changed
    // (who is me is set at sign-up). Nor can that profile be archived or
    // deleted: the API refuses, so its buttons aren't shown.
    onEdit: (person) => { $("#self-flag").hidden = !person?.is_self; },
    canRemove: (person) => !person.is_self,

    renderItem: (person) => [
      h("div", { className: "item-title" },
        person.name,
        person.is_self ? h("span", { className: "badge" }, "You") : null),
      person.pronouns || person.default_role
        ? h("div", { className: "item-meta" },
          [person.pronouns, person.default_role && `usually ${roleName(person.default_role)}`].filter(Boolean).join(" · "))
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
