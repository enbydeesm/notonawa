// Choosing one of my people linked to their account, to send something to
// (the Share dialog's "Send to connection"): a search box over them only,
// by name or alias, listing them all until something's typed. Nothing can
// be added here: a connection is made by accepting an invite.

import { h, privateField } from "./dom.js";
import { personMatch, readAliases } from "./aliases.js";

/**
 * @param {{ id: string, people: any[], onPick: (person: any) => void }} picker id: the box's (the list's
 *   and options' start with it); people: mine, opened, each with a connection_id
 * @returns {HTMLElement}
 */
export function connectionPicker({ id, people, onPick }) {
  const box = privateField(h("input", { type: "search", id, placeholder: "Search your connections", "aria-controls": `${id}-list` }));
  const list = h("ul", { className: "connection-choices", id: `${id}-list` });
  const draw = () => {
    const found = people.map((p) => ({ person: p, ...personMatch(p.name, readAliases(p.aliases), box.value) })).filter((m) => m.matches);
    list.replaceChildren(...(found.length
      ? found.map((m) => h("li", {}, h("button", { type: "button", className: "connection-choice", onclick: () => onPick(m.person) }, m.label)))
      : [h("li", { className: "hint" }, "No connection matches.")]));
  };
  box.addEventListener("input", draw);
  draw();
  return h("div", { className: "connection-picker" }, box, list);
}
