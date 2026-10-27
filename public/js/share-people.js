// Who's who on a shared tie or workshop, and which of my locations and
// plans its own are: the suggestions the recipient starts from, and whether
// a set of choices can be saved. Pure, so it's easy to test. See
// considerations.md, "Sharing between accounts": "Who's who on the
// recipient's side".
//
// A person is on an item once, so no two shared people can be the same
// one of mine. Names are never matched silently: every person, the location and each
// plan is shown with a choice, suggested here:
// - the sender: my card linked to them, when we're connected;
// - a name the same as one of mine (ignoring capitals and spaces at the
//   ends): that one (my own profile included, as Me);
// - anything else: new.

import { tagKey } from "./tags.js";

/** A name as it's compared: ignoring capitals and spaces at the ends. @param {string} name */
const nameKey = (name) => tagKey(name.trim());

/**
 * @typedef {{ type: "me" } | { type: "person", id: string } | { type: "new", name: string }} PersonChoice
 * @typedef {{ type: "existing", id: string } | { type: "new", name: string }} ItemChoice
 * @typedef {{ id: string, name: string, is_self?: unknown, connection_id?: string | null }} MyPerson
 * @typedef {{ id: string, name: string }} MyItem
 * @typedef {import("./share-item.js").SharedPerson} SharedPerson
 */

/**
 * Which of my people a choice is, as one key ("me" for my own profile).
 * @param {PersonChoice} choice
 * @param {string | null} selfId
 */
function personKey(choice, selfId) {
  if (choice.type === "me") return "me";
  if (choice.type === "person") return choice.id === selfId ? "me" : choice.id;
  return null;
}

/**
 * The suggested choice for each person on a shared item.
 * @param {"tie" | "workshop"} kind
 * @param {SharedPerson[]} shared
 * @param {MyPerson[]} mine my active people, my own profile among them
 * @param {string | null} connectionId my side of a connection with the sender, if there is one
 * @returns {PersonChoice[]}
 */
export function suggestPeople(kind, shared, mine, connectionId) {
  const selfId = mine.find((p) => p.is_self)?.id ?? null;
  const linked = connectionId ? mine.find((p) => p.connection_id === connectionId && !p.is_self) ?? null : null;
  /** @type {PersonChoice[]} */
  const choices = [];
  for (const person of shared) {
    const match = person.sender && linked ? linked : mine.find((p) => nameKey(p.name) === nameKey(person.name));
    const key = match ? (match.is_self ? "me" : match.id) : null;
    // Already suggested for someone else (a person is on an item once): this one is new.
    const taken = choices.some((c) => personKey(c, selfId) === key);
    choices.push(match && !taken ? (match.is_self ? { type: "me" } : { type: "person", id: match.id }) : { type: "new", name: person.name });
  }
  return choices;
}

/**
 * Why these choices can't be saved, or null if they can.
 * @param {"tie" | "workshop"} kind
 * @param {SharedPerson[]} shared
 * @param {PersonChoice[]} choices one for each shared person
 * @param {string | null} selfId my own profile's id
 * @returns {string | null}
 */
export function peopleProblem(kind, shared, choices, selfId) {
  for (const [i, choice] of choices.entries()) {
    if (choice.type === "new" && !choice.name.trim()) return `Type a name for the new person in place of ${shared[i].name}.`;
    const key = personKey(choice, selfId);
    if (key === null) continue;
    const j = choices.findIndex((c, n) => n < i && personKey(c, selfId) === key);
    if (j === -1) continue;
    const who = key === "me" ? "you" : "the same person";
    return `${shared[j].name} and ${shared[i].name} can't both be ${who}: someone is on a ${kind} once.`;
  }
  return null;
}

/**
 * The suggested choice for a shared location or plan: mine with the same
 * name, or a new one.
 * @param {string} name
 * @param {MyItem[]} mine my active ones (plans' titles as name)
 * @returns {ItemChoice}
 */
export function suggestItem(name, mine) {
  const match = mine.find((m) => nameKey(m.name) === nameKey(name));
  return match ? { type: "existing", id: match.id } : { type: "new", name };
}

/**
 * Why a tie's plan choices can't be saved, or null: two shared plans
 * can't become the same one of mine (a plan is on a tie once).
 * @param {string[]} shared
 * @param {ItemChoice[]} choices
 * @returns {string | null}
 */
export function plansProblem(shared, choices) {
  for (const [i, choice] of choices.entries()) {
    if (choice.type === "new" && !choice.name.trim()) return `Type a title for the new plan in place of ${shared[i]}.`;
    if (choice.type !== "existing") continue;
    const j = choices.findIndex((c, n) => n < i && c.type === "existing" && c.id === choice.id);
    if (j !== -1) return `${shared[j]} and ${shared[i]} can't both be the same plan.`;
  }
  return null;
}
