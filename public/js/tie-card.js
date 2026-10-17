// A tie drawn as a card, as the Ties list shows it, and opening one in the
// tie form. Shared by the Ties view and the Analytics view's list of the
// ties behind a chart.

import { api } from "./api.js";
import { h, $ } from "./dom.js";
import { openTieForm } from "./tie-form.js";
import { formatDate } from "./format.js";
import { ratingHanks } from "./rope-rating.js";
import { placeLine, participantLabel, peopleThatFit } from "./ties-view.js";
import { open } from "./vault.js";

/** @param {import("./ties-view.js").Label} label */
function renderLabel(label) {
  if (label.rating !== undefined) return ratingHanks(label.rating, label.text);
  return label.deleted ? h("span", { className: "deleted" }, label.text) : label.text;
}

/**
 * A tie as a card: title (tap to edit) and date; type and location, and the
 * rating; who took part, on one line; its tags; and how many photos. Call
 * fitPeople() on its container once it's on the page.
 * @param {Record<string, any>} tie as POST /api/ties/search returns it
 * @param {(id: string) => void} onEdit runs when the title is tapped
 */
export function tieCard(tie, onEdit) {
  const place = placeLine(tie);
  const people = tie.participants.map((/** @type {any} */ p, /** @type {number} */ i) => {
    const { name, role } = participantLabel(p);
    return h("span", { className: "tie-person" }, i > 0 ? ", " : "", renderLabel(name), ` (${role})`);
  });

  return h("article", { className: "tie-card" },
    h("button", { type: "button", className: "tie-title", onclick: () => onEdit(tie.id) }, tie.title || "Untitled tie"),
    h("span", { className: "tie-date" }, formatDate(tie.tie_date)),
    h("div", { className: "tie-place" }, place.flatMap((part, i) => (i === 0 ? [renderLabel(part)] : [" ", renderLabel(part)]))),
    tie.success_rating != null
      ? h("div", { className: "tie-rating" }, ratingHanks(tie.success_rating, `Rating ${tie.success_rating}/5`))
      : null,
    people.length
      ? h("div", { className: "tie-with" }, h("span", { className: "tie-with-label" }, "With: "), people, h("span", { className: "tie-more", hidden: true }))
      : null,
    tie.tags.length
      ? h("div", { className: "tag-row tie-tags" }, tie.tags.map((/** @type {string} */ name) => h("span", { className: "tag outline" }, name)))
      : null,
    tie.photo_count
      ? h("div", { className: "tie-photos" }, tie.photo_count === 1 ? "1 photo" : `${tie.photo_count} photos`)
      : null
  );
}

/**
 * Shows as many people as fit on each card's "With:" line, and "+2" for the
 * rest (its tooltip names them). Run after the cards are drawn and when the
 * container's width changes.
 * @param {HTMLElement} container
 */
export function fitPeople(container) {
  for (const line of container.querySelectorAll(".tie-with")) {
    const people = /** @type {HTMLElement[]} */ ([...line.querySelectorAll(".tie-person")]);
    const more = /** @type {HTMLElement} */ ($(".tie-more", line));
    const label = /** @type {HTMLElement} */ ($(".tie-with-label", line));
    for (const person of people) person.hidden = false;
    more.hidden = false;
    const moreWidth = (/** @type {number} */ n) => { more.textContent = ` +${n}`; return more.offsetWidth; };
    const shown = peopleThatFit(people.map((p) => p.offsetWidth), line.clientWidth - label.offsetWidth, moreWidth);
    people.forEach((person, i) => { person.hidden = i >= shown; });
    const hiddenPeople = people.slice(shown);
    more.hidden = hiddenPeople.length === 0;
    moreWidth(hiddenPeople.length);
    more.title = hiddenPeople.map((p) => (p.textContent ?? "").replace(/^, /, "")).join(", ");
    more.setAttribute("aria-label", `and ${hiddenPeople.length} more: ${more.title}`);
  }
}

/**
 * Opens one of my ties in the tie form to edit or delete it (its notes
 * opened on the device first). Resolves true if it was saved or deleted.
 * Throws if the tie can't be loaded.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function editTie(id) {
  const [tie] = await open("tie", [await api(`/api/ties/${encodeURIComponent(id)}`)]);
  return openTieForm(tie);
}
