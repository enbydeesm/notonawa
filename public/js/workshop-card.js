// A workshop drawn as a card in the Education view's lists, like a tie's
// card (the same classes, so fitPeople() fits its people lines too).

import { h, opensOnTap } from "./dom.js";
import { isWebLink } from "./links.js";
import { ratingHanks } from "./rope-rating.js";
import { participantLabel } from "./ties-view.js";
import { roleName } from "./roles.js";
import { visualsRow, albumLink } from "./tie-card.js";
import { dateRangeLines } from "./workshops-view.js";

/**
 * People on one line ("Educators: …" or "With: …"), as many as fit.
 * @param {string} label
 * @param {any[]} people
 */
function peopleLine(label, people) {
  if (!people.length) return null;
  const names = people.map((p, i) => {
    const { name, role } = participantLabel(p);
    return h("span", { className: "tie-person" }, i > 0 ? ", " : "",
      name.deleted ? h("span", { className: "deleted" }, name.text) : name.text, ` (${roleName(role)})`);
  });
  return h("div", { className: "tie-with" }, h("span", { className: "tie-with-label" }, `${label}: `), names,
    h("span", { className: "tie-more", hidden: true }));
}

/**
 * A workshop as a card (tap it to edit; its title is the button): title and
 * dates (two lines across years); its location, and the rating; its
 * educators and participants, a line each; its tags; how many photos, with
 * its event and album links on the right ("Open link", "Open album").
 * @param {Record<string, any>} workshop as GET /api/workshops lists it, opened
 * @param {(id: string) => void} onEdit runs when the card is tapped
 */
export function workshopCard(workshop, onEdit) {
  const place = workshop.location_name
    ? workshop.location_name
    : workshop.location_deleted ? h("span", { className: "deleted" }, "(location deleted)") : null;
  const dates = dateRangeLines(/** @type {any} */ (workshop));

  return opensOnTap(h("article", { className: "tie-card workshop-card" },
    h("button", { type: "button", className: "tie-title", onclick: () => onEdit(workshop.id) }, workshop.title),
    h("span", { className: "tie-date" }, dates.length > 1 ? dates.map((line) => h("span", { className: "date-line" }, line)) : dates[0]),
    h("div", { className: "tie-place" }, place),
    workshop.rating != null
      ? h("div", { className: "tie-rating" }, ratingHanks(workshop.rating, `Rating ${workshop.rating}/5`))
      : null,
    peopleLine("Educators", workshop.educators),
    peopleLine("With", workshop.participants),
    workshop.tags.length
      ? h("div", { className: "tag-row tie-tags" }, workshop.tags.map((/** @type {string} */ name) => h("span", { className: "tag outline" }, name)))
      : null,
    // The event link first, so "Open link" sits left of "Open album".
    visualsRow(workshop.photo_count, null, ...eventLink(workshop.event_url), albumLink(workshop.album_url, "tie-album"))
  ), () => onEdit(workshop.id));
}

/**
 * "Open link": the workshop's event page, in a new tab, only for a web link
 * (checked before it was sealed, and again here). Before the album's.
 * @param {unknown} url opened
 * @returns {HTMLElement[]}
 */
function eventLink(url) {
  if (!isWebLink(url)) return [];
  return [h("span", { className: "tie-album workshop-event" },
    h("a", { href: /** @type {string} */ (url), target: "_blank", rel: "noopener noreferrer" }, "Open link"))];
}
