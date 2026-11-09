// A workshop drawn as a card in the Education view's lists, like a tie's
// card (the same classes, so fitPeople() fits its people lines too).

import { h, opensOnTap } from "./dom.js";
import { isWebLink } from "./links.js";
import { attachedText } from "./format.js";
import { participantLabel } from "./ties-view.js";
import { roleName } from "./roles.js";
import { visualsRow } from "./tie-card.js";
import { dateRangeLines } from "./workshops-view.js";

/**
 * The participants on one line ("With: …"), as many as fit.
 * @param {any[]} people
 */
function withLine(people) {
  if (!people.length) return null;
  const names = people.map((p, i) => {
    const { name, role } = participantLabel(p);
    return h("span", { className: "tie-person" }, i > 0 ? ", " : "",
      name.deleted ? h("span", { className: "deleted" }, name.text) : name.text, ` (${roleName(role)})`);
  });
  return h("div", { className: "tie-with" }, h("span", { className: "tie-with-label" }, "With: "), names,
    h("span", { className: "tie-more", hidden: true }));
}

/**
 * Who taught it and where: "Alex & Lily at Studio", the location linking
 * to the event's page when there is one; just the names, or just the
 * location, when it has only one of them.
 * @param {Record<string, any>} workshop
 * @param {boolean} linked whether the location links to the event
 */
function teachersLine(workshop, linked) {
  /** @type {(string | HTMLElement)[]} */
  const parts = [];
  workshop.educators.forEach((/** @type {any} */ p, /** @type {number} */ i) => {
    const { name } = participantLabel(p);
    if (i > 0) parts.push(" & ");
    parts.push(name.deleted ? h("span", { className: "deleted" }, name.text) : name.text);
  });
  const place = workshop.location_name
    ? (linked
      ? h("a", { href: workshop.event_url, target: "_blank", rel: "noopener noreferrer", className: "workshop-event" }, workshop.location_name)
      : workshop.location_name)
    : workshop.location_deleted ? h("span", { className: "deleted" }, "(location deleted)") : null;
  if (place) parts.push(...(parts.length ? [" at ", place] : [place]));
  return parts;
}

/**
 * A workshop as a card (tap it to edit; its title is the button): title
 * and its days; who taught it at which location, and the year (or across
 * years, the end date); its participants on a line; its tags; how many
 * visuals, plans and ties it has, then its links, and on the right, if I
 * taught it, how many came.
 * @param {Record<string, any>} workshop as GET /api/workshops lists it, opened
 * @param {(id: string) => void} onEdit runs when the card is tapped
 * @param {{ taught?: boolean }} [options]
 */
export function workshopCard(workshop, onEdit, { taught = false } = {}) {
  const [days, second] = dateRangeLines(/** @type {any} */ (workshop));
  // The event's page is the location's link; with no location to link, it's "Open link" below.
  const event = isWebLink(workshop.event_url);
  const linked = event && Boolean(workshop.location_name);
  const counts = attachedText({
    visuals: workshop.visual_count,
    plans: workshop.linked.filter((/** @type {any} */ l) => l.kind === "plan").length,
    ties: workshop.linked.filter((/** @type {any} */ l) => l.kind === "tie").length,
  });
  const attendees = taught && workshop.attendee_count != null
    ? h("span", { className: "workshop-attendees" }, `Attendees: ${workshop.attendee_count}`)
    : null;

  return opensOnTap(h("article", { className: "tie-card workshop-card" },
    h("button", { type: "button", className: "tie-title", onclick: () => onEdit(workshop.id) }, workshop.title),
    h("span", { className: "tie-date" }, days),
    h("div", { className: "tie-place" }, teachersLine(workshop, linked)),
    h("span", { className: "tie-year" }, second),
    withLine(workshop.participants),
    workshop.tags.length
      ? h("div", { className: "tag-row tie-tags" }, workshop.tags.map((/** @type {string} */ name) => h("span", { className: "tag outline" }, name)))
      : null,
    visualsRow(counts, workshop.album_url, {
      links: event && !linked ? [eventLink(/** @type {string} */ (workshop.event_url))] : [],
      end: attendees,
    })
  ), () => onEdit(workshop.id));
}

/**
 * "Open link": the workshop's event page, in a new tab, for one with no
 * location to link it from (checked before it was sealed, and again here).
 * @param {string} url opened
 */
function eventLink(url) {
  return h("span", { className: "tie-album workshop-event" },
    h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, "Open link"));
}
