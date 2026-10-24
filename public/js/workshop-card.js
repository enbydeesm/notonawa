// A workshop drawn as a card in the Education view's lists, like a tie's
// card (the same classes, so fitPeople() fits its people lines too).

import { h, opensOnTap } from "./dom.js";
import { ratingHanks } from "./rope-rating.js";
import { participantLabel } from "./ties-view.js";
import { roleName } from "./roles.js";
import { albumLink } from "./tie-card.js";
import { dateRangeText } from "./workshops-view.js";

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
 * A workshop as a card (tap it to edit; its title is the button): title and dates; location and how
 * many attended, and the rating; its educators and participants, a line
 * each; its tags; how many photos, and its album link.
 * @param {Record<string, any>} workshop as GET /api/workshops lists it, opened
 * @param {(id: string) => void} onEdit runs when the card is tapped
 */
export function workshopCard(workshop, onEdit) {
  const place = workshop.location_name
    ? workshop.location_name
    : workshop.location_deleted ? h("span", { className: "deleted" }, "(location deleted)") : null;
  const attendees = workshop.attendee_count != null
    ? `${workshop.attendee_count} ${workshop.attendee_count === 1 ? "attendee" : "attendees"}` : null;

  return opensOnTap(h("article", { className: "tie-card workshop-card" },
    h("button", { type: "button", className: "tie-title", onclick: () => onEdit(workshop.id) }, workshop.title),
    h("span", { className: "tie-date" }, dateRangeText(/** @type {any} */ (workshop))),
    h("div", { className: "tie-place" }, place, place && attendees ? " · " : null, attendees),
    workshop.rating != null
      ? h("div", { className: "tie-rating" }, ratingHanks(workshop.rating, `Rating ${workshop.rating}/5`))
      : null,
    peopleLine("Educators", workshop.educators),
    peopleLine("With", workshop.participants),
    workshop.tags.length
      ? h("div", { className: "tag-row tie-tags" }, workshop.tags.map((/** @type {string} */ name) => h("span", { className: "tag outline" }, name)))
      : null,
    workshop.photo_count
      ? h("div", { className: "tie-photos" }, workshop.photo_count === 1 ? "1 photo" : `${workshop.photo_count} photos`)
      : null,
    albumLink(workshop.album_url, "tie-album")
  ), () => onEdit(workshop.id));
}
