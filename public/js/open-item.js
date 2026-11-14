// Adding a shared tie, plan or workshop from /open: a preview, then who's
// who (Me, one of my people, or a new person, for everyone on it) and
// which of my locations and plans its own are, then Add to my journal,
// which saves it through the import (share-to-import.js). See
// considerations.md, "Sharing between accounts": "Who's who on the
// recipient's side".
//
// Nothing is matched silently: each choice starts from a suggestion
// (share-people.js), shown for the recipient to confirm or change. One
// that looks like it's already in my journal says so, and offers to add
// another copy.
//
// Its photos and videos are fetched and opened in the crypto Worker, and
// sealed there again as mine (adoptShareFile): only their thumbnails come
// out, for the preview.

import { api, errorMessage } from "./api.js";
import { h, showMessage, privateField } from "./dom.js";
import { seal, open, forgetSearch, openShareThumb, adoptShareFile } from "./vault.js";
import { forget } from "./pending-share.js";
import { readItemShare, isMedia, visualCounts } from "./share-item.js";
import { uploadSealed } from "./photo-upload.js";
import { photoUrl } from "./photo-urls.js";
import { suggestPeople, peopleProblem, suggestItem, plansProblem } from "./share-people.js";
import { shareToImport, addsItems, withKnown, duplicatePlan } from "./share-to-import.js";
import { itemsBody, remapTies, remapWorkshops } from "./import-steps.js";
import { convertJournal } from "./journal-fields.js";
import { duplicateMatches } from "./import-dedupe.js";
import { saveDrawing } from "./drawings-ui.js";
import { savePose } from "./poses-ui.js";
import { albumLink } from "./tie-card.js";
import { isWebLink } from "./links.js";
import { readCost, formatMoney } from "./currency.js";
import { ratingHanks } from "./rope-rating.js";
import { roleName } from "./roles.js";
import { capitalise, formatDate } from "./format.js";
import { placeText } from "./list-order.js";
import { dateRangeText } from "./workshops-view.js";
import { PLAN_TYPE_NAMES } from "./plans-view.js";
import { listItems } from "./store/index.js";

/** @typedef {import("./share-item.js").ItemKind} ItemKind */
/** @typedef {import("./share-item.js").SharedItem} SharedItem */
/** @typedef {import("./share-people.js").PersonChoice} PersonChoice */
/** @typedef {import("./share-people.js").ItemChoice} ItemChoice */
/** @typedef {import("./pending-share.js").OpenedShare} OpenedShare */

const NOUNS = /** @type {Record<ItemKind, string>} */ ({ tie: "tie", plan: "plan", workshop: "workshop" });
// Where each kind is listed, once it's added.
const VIEWS = /** @type {Record<ItemKind, [string, string]>} */ ({
  tie: ["/", "Go to Ties"], plan: ["/plans", "Go to Plans"], workshop: ["/education", "Go to Education"],
});

/**
 * Shows an opened tie, plan or workshop, and adding it.
 * @param {HTMLElement} body
 * @param {OpenedShare} opened
 * @param {AbortSignal} signal
 */
export async function showItem(body, opened, signal) {
  const kind = /** @type {ItemKind} */ (opened.kind);
  const read = readItemShare(kind, opened.data);
  const noun = NOUNS[kind] ?? "share";
  if (!read) {
    body.replaceChildren(h("p", { id: "open-said" }, `This ${noun} couldn't be read. Ask whoever shared it for a new one.`));
    return;
  }
  const item = read;
  const preview = itemCard(kind, item);
  showThumbs(preview, opened, item, signal);
  if (opened.own) {
    body.replaceChildren(preview,
      h("p", { id: "open-own" }, `This is your own ${noun}. Share its code with someone else to let them add it.`));
    return;
  }

  body.replaceChildren(h("p", { className: "hint" }, "Shared with you:"), preview, h("p", { className: "hint" }, "Loading…"));
  let mine;
  try {
    mine = await loadMine(kind, item);
  } catch (err) {
    if (!signal.aborted) body.replaceChildren(preview, h("p", { className: "message error" }, "Couldn't load your journal: " + errorMessage(err)));
    return;
  }
  if (signal.aborted) return;
  const selfId = mine.people.find((p) => p.is_self)?.id ?? null;

  const people = suggestPeople(kind === "workshop" ? "workshop" : "tie", item.people, mine.people, opened.connectionId);
  const others = mine.people.filter((p) => !p.is_self);
  const personRows = item.people.map((person, i) => personChoice(person, i, people[i], others, kind));
  const location = item.location
    ? itemChoice("open-location", item.location.name, "New location", suggestItem(item.location.name, mine.locations), mine.locations)
    : null;
  const plans = item.plans.map((title, i) => itemChoice(`open-plan-${i}`, title, "New plan", suggestItem(title, mine.plans), mine.plans));

  const message = h("p", { className: "message", id: "open-message" });
  const add = h("button", { type: "button", className: "primary", id: "open-add", onclick: () => adding(false) }, "Add to my journal");
  body.replaceChildren(...[
    h("p", { className: "hint" }, "Shared with you:"),
    preview,
    h("p", { className: "hint", id: "open-once" }, "Add it before you leave: the link may not work again."),
    personRows.length ? h("h2", { className: "open-heading" }, "Who is this?") : null,
    personRows.length ? h("p", { className: "hint" }, "Who each person is in your journal. Choose Me for yourself.") : null,
    ...personRows.map((r) => r.element),
    location ? h("h2", { className: "open-heading" }, "Location") : null,
    location?.element ?? null,
    plans.length ? h("h2", { className: "open-heading" }, "Plans") : null,
    ...plans.map((p) => p.element),
    add, message,
  ].filter((el) => el !== null));

  /**
   * Checks the choices, then adds it: first checking it isn't already in
   * my journal, unless I've said to add another copy.
   * @param {boolean} anotherCopy
   */
  async function adding(anotherCopy) {
    const choices = {
      people: personRows.map((r) => r.choice()),
      location: location?.choice() ?? null,
      plans: plans.map((p) => p.choice()),
    };
    const problem = peopleProblem(kind === "workshop" ? "workshop" : "tie", item.people, choices.people, selfId)
      ?? plansProblem(item.plans, choices.plans);
    if (problem) return showMessage(message, problem, true);
    if (!selfId && choices.people.some((c) => c.type === "me")) return showMessage(message, "Your journal has no profile for you.", true);
    add.disabled = true;
    body.querySelector("#open-add-copy")?.remove();
    showMessage(message, "Adding…");
    try {
      const { doc, known } = shareToImport(kind, item, choices, selfId ?? "");
      const sealed = await convertJournal(doc, seal);
      if (!anotherCopy && await alreadyThere(kind, item, doc, sealed, known)) {
        showMessage(message, `This ${noun} looks like one already in your journal.`);
        add.disabled = false;
        message.after(h("button", { type: "button", id: "open-add-copy", onclick: () => adding(true) }, "Add another copy"));
        return;
      }
      const target = await save(kind, doc, sealed, known);
      forgetSearch();
      const visuals = await saveVisuals(target, item.visuals, opened, (text) => showMessage(message, text));
      done(body, kind, visuals);
    } catch (err) {
      showMessage(message, "Couldn't add it: " + errorMessage(err), true);
      add.disabled = false;
    }
  }
}

/**
 * My active people, locations and plans, as far as the choices need them.
 * @param {ItemKind} kind
 * @param {SharedItem} item
 */
async function loadMine(kind, item) {
  const [people, locations, plans] = await Promise.all([
    item.people.length ? listItems("people", false) : [],
    item.location ? listItems("locations", false) : [],
    kind === "tie" && item.plans.length ? listItems("plans", false) : [],
  ]);
  return {
    people: /** @type {import("./share-people.js").MyPerson[]} */ (people),
    locations: /** @type {{ id: string, name: string }[]} */ (locations),
    plans: plans.map((/** @type {any} */ p) => ({ id: p.id, name: p.title })),
  };
}

/**
 * One person's row of Who is this?: Me, New person (a name to type) or one
 * of my people.
 * @param {import("./share-item.js").SharedPerson} person
 * @param {number} i
 * @param {PersonChoice} suggested
 * @param {{ id: string, name: string }[]} others my people but me
 * @param {ItemKind} kind
 */
function personChoice(person, i, suggested, others, kind) {
  const id = `open-person-${i}`;
  const select = h("select", { id },
    h("option", { value: "me", selected: suggested.type === "me" }, "Me"),
    h("option", { value: "new", selected: suggested.type === "new" }, "New person"),
    others.map((p) => h("option", { value: `person:${p.id}`, selected: suggested.type === "person" && suggested.id === p.id }, p.name)));
  const name = privateField(h("input", {
    id: `${id}-name`, maxLength: 200, value: person.name, "aria-label": `Name for the new person in place of ${person.name}`,
  }));
  const showName = () => { name.hidden = select.value !== "new"; };
  select.addEventListener("change", showName);
  showName();
  const about = [
    capitalise(roleName(person.role)),
    kind === "workshop" ? (person.kind === "educator" ? "educator" : "participant") : null,
    person.sender ? "shared this" : null,
  ].filter(Boolean).join(" · ");
  return {
    element: h("div", { className: "open-choice" },
      h("label", { htmlFor: id }, h("strong", {}, person.name), " ", h("span", { className: "item-meta" }, about)),
      select, name),
    /** @returns {PersonChoice} */
    choice: () => select.value === "me" ? { type: "me" }
      : select.value === "new" ? { type: "new", name: name.value }
      : { type: "person", id: select.value.slice("person:".length) },
  };
}

/**
 * A location's or plan's choice: a new one (named as shared) or one of mine.
 * @param {string} id
 * @param {string} shared its name or title as shared
 * @param {string} newWord "New location" or "New plan"
 * @param {ItemChoice} suggested
 * @param {{ id: string, name: string }[]} mine
 */
function itemChoice(id, shared, newWord, suggested, mine) {
  const label = `${newWord}: ${shared}`;
  const select = h("select", { id },
    h("option", { value: "new", selected: suggested.type === "new" }, label),
    mine.map((m) => h("option", { value: m.id, selected: suggested.type === "existing" && suggested.id === m.id }, m.name)));
  return {
    element: h("div", { className: "open-choice" }, h("label", { htmlFor: id }, h("strong", {}, shared)), select),
    /** @returns {ItemChoice} */
    choice: () => (select.value === "new" ? { type: "new", name: shared } : { type: "existing", id: select.value }),
  };
}

/**
 * Whether it looks like it's already in my journal: a plan with the same
 * title, description and notes; a tie or workshop as the import finds
 * duplicates (one with a new person, location or plan can't be).
 * @param {ItemKind} kind
 * @param {SharedItem} item
 * @param {import("./import-steps.js").ImportDoc} doc plain
 * @param {import("./import-steps.js").ImportDoc} sealed
 * @param {import("./share-to-import.js").Known} known
 */
async function alreadyThere(kind, item, doc, sealed, known) {
  if (kind === "plan") return duplicatePlan(item, await listItems("plans", "all")) !== null;
  if (addsItems(doc)) return false;
  const items = withKnown({ people: [], locations: [], plans: [] }, known);
  if (kind === "tie") {
    const result = await api("/api/data/import/ties", { method: "POST", body: { preview: true, ties: remapTies(sealed.ties, items) } });
    return duplicateMatches(doc.ties, await open("tie", result.candidates)).size > 0;
  }
  const result = await api("/api/data/import/workshops", {
    method: "POST", body: { preview: true, workshops: remapWorkshops(sealed.workshops, items) },
  });
  return duplicateMatches(doc.workshops, await open("workshop", result.candidates), ["description", "notes"]).size > 0;
}

/**
 * Saves it: its new people, location and plans, then the tie or workshop
 * itself (a plan is one of the items).
 * @param {ItemKind} kind
 * @param {import("./import-steps.js").ImportDoc} doc plain
 * @param {import("./import-steps.js").ImportDoc} sealed
 * @param {import("./share-to-import.js").Known} known
 * @returns {Promise<{ tie_id: string } | { plan_id: string } | { workshop_id: string }>} where its visuals go
 */
async function save(kind, doc, sealed, known) {
  const added = addsItems(doc)
    ? await api("/api/data/import/items", { method: "POST", body: itemsBody(sealed, false) })
    : { people: [], locations: [], plans: [] };
  if (kind === "plan") return { plan_id: added.plans[0].id };
  const items = withKnown(added, known);
  if (kind === "tie") {
    const result = await api("/api/data/import/ties", { method: "POST", body: { ties: remapTies(sealed.ties, items), skip: [] } });
    return { tie_id: result.ids[0] };
  }
  const result = await api("/api/data/import/workshops", {
    method: "POST", body: { workshops: remapWorkshops(sealed.workshops, items), skip: [] },
  });
  return { workshop_id: result.ids[0] };
}

/**
 * Saves its visuals, one by one, in the shared order (each goes last among
 * the item's visuals as it's saved): drawings and poses from the snapshot,
 * photos and videos fetched from the share and sealed again as mine.
 * @param {{ tie_id: string } | { plan_id: string } | { workshop_id: string }} target
 * @param {import("./share-item.js").SharedVisual[]} visuals
 * @param {OpenedShare} opened
 * @param {(text: string) => void} progress
 * @returns {Promise<{ added: number, failed: number }>}
 */
async function saveVisuals(target, visuals, opened, progress) {
  let added = 0;
  let failed = 0;
  for (const [i, visual] of visuals.entries()) {
    progress(`Adding its visuals… ${i + 1} of ${visuals.length}`);
    try {
      if (isMedia(visual)) {
        const id = crypto.randomUUID();
        const sealed = await adoptShareFile({ shareId: opened.id, key: opened.key, fileId: visual.file, kind: visual.kind, mediaId: id });
        await uploadSealed({ item: target, id, kind: visual.kind, mime: visual.mime, ...sealed, caption: visual.caption });
      } else {
        const entry = { data: /** @type {any} */ (visual.data), caption: visual.caption };
        await (visual.kind === "drawing" ? saveDrawing(target, entry) : savePose(target, entry));
      }
      added++;
    } catch {
      failed++;
    }
  }
  return { added, failed };
}

/**
 * Adds its photos' and videos' thumbnails to the preview, opened as they
 * arrive. One that can't be fetched or opened stays an empty square.
 * @param {HTMLElement} preview
 * @param {OpenedShare} opened
 * @param {SharedItem} item
 * @param {AbortSignal} signal
 */
function showThumbs(preview, opened, item, signal) {
  const media = item.visuals.filter(isMedia);
  if (!media.length) return;
  const tiles = media.map((v) => {
    const label = `${v.kind === "video" ? "Video" : "Photo"}${v.caption ? `: ${v.caption}` : ""}`;
    const thumb = h("div", { className: "photo-thumb", role: "img", "aria-label": label },
      v.kind === "video" ? h("span", { className: "video-badge", "aria-hidden": "true" }, "▶") : null);
    return { v, thumb, tile: h("figure", { className: `photo-tile visual-${v.kind}` }, thumb,
      v.caption ? h("figcaption", {}, v.caption) : null) };
  });
  preview.append(h("div", { className: "photo-grid shared-thumbs", id: "open-thumbs" }, tiles.map((t) => t.tile)));
  (async () => {
    for (const { v, thumb } of tiles) {
      if (signal.aborted) return;
      try {
        const bytes = await openShareThumb({ shareId: opened.id, key: opened.key, fileId: v.file, kind: v.kind });
        if (signal.aborted) return;
        thumb.prepend(h("img", { src: photoUrl(bytes, v.kind === "video" ? "image/jpeg" : v.mime), alt: "" }));
      } catch {
        // Left empty: Add to my journal says if it can't be added either.
      }
    }
  })();
}

/**
 * Added: the share's done with.
 * @param {HTMLElement} body
 * @param {ItemKind} kind
 * @param {{ added: number, failed: number }} visuals
 */
function done(body, kind, visuals) {
  forget();
  const [href, label] = VIEWS[kind];
  const failed = visuals.failed
    ? h("p", { className: "message error", id: "open-visuals-failed" },
      `${visuals.failed} of its visuals couldn't be added.`)
    : null;
  body.replaceChildren(...[h("p", { id: "open-done" }, `The ${NOUNS[kind]} is in your journal.`), failed,
    h("a", { href, id: "open-to-view" }, label)].filter((el) => el !== null));
}

/**
 * What was shared, as a card.
 * @param {ItemKind} kind
 * @param {SharedItem} item
 */
function itemCard(kind, item) {
  /** @param {string | null | false | undefined} text @param {string} [id] */
  const line = (text, id) => (text ? h("div", { className: "item-meta", id }, text) : null);
  /** @param {import("./share-item.js").SharedPerson[]} list */
  const names = (list) => list.map((p) => `${p.name} (${roleName(p.role)})`).join(", ");
  const heading = kind === "tie" ? item.title ?? `${capitalise(item.tie_type ?? "")} tie` : item.title;
  const when = kind === "tie"
    ? [formatDate(item.tie_date), capitalise(item.tie_type ?? ""), item.duration_minutes !== null ? `${item.duration_minutes} mins` : null]
    : kind === "workshop"
      ? [dateRangeText({ start_date: /** @type {string} */ (item.start_date), end_date: item.end_date }),
        item.attendee_count !== null ? `${item.attendee_count} attended` : null]
      : [PLAN_TYPE_NAMES[/** @type {keyof typeof PLAN_TYPE_NAMES} */ (item.plan_type)] ?? null,
        item.tie_type ? capitalise(item.tie_type) : null];
  const rating = kind === "tie" ? item.success_rating : kind === "workshop" ? item.rating : item.est_difficulty;
  const ratingWords = kind === "plan" ? "Difficulty" : kind === "tie" ? "How it went" : "Rating";
  const place = item.location ? [item.location.name, placeText(item.location)].filter(Boolean).join(" · ") : null;
  const visuals = visualCounts(item.visuals, ["photo", "video", "drawing", "pose"]);
  const educators = item.people.filter((p) => p.kind === "educator");
  const attendees = item.people.filter((p) => p.kind !== "educator");
  return h("div", { className: "item shared-item", id: "open-item" },
    h("div", { className: "item-title", id: "open-title" }, heading),
    line(when.filter(Boolean).join(" · "), "open-when"),
    rating !== null ? h("div", { className: "item-meta" }, `${ratingWords}: `, ratingHanks(rating, `${rating}/5`)) : null,
    line(place && `At ${place}`, "open-place"),
    line(item.plans.length > 0 && `Plans: ${item.plans.join(", ")}`, "open-plans"),
    kind === "workshop"
      ? [line(educators.length > 0 && `Educators: ${names(educators)}`, "open-educators"),
        line(attendees.length > 0 && `People: ${names(attendees)}`, "open-people")]
      : line(item.people.length > 0 && `With: ${names(item.people)}`, "open-people"),
    item.description ? h("p", { className: "item-notes", id: "open-description" }, item.description) : null,
    item.notes ? h("p", { className: "item-notes", id: "open-notes" }, item.notes) : null,
    kind === "workshop" ? line(costLine(item.cost), "open-cost") : null,
    eventLink(item.event_url),
    albumLink(item.album_url, "item-meta"),
    line(visuals, "open-visuals"),
    item.tags.length ? h("div", { className: "tag-row" }, item.tags.map((t) => h("span", { className: "tag outline" }, t))) : null);
}

/**
 * A shared workshop's cost: "Cost: €180".
 * @param {string | null} cost as shared ("EUR 180.00")
 */
function costLine(cost) {
  const read = readCost(cost);
  return read ? `Cost: ${formatMoney(read.minor, read.currency)}` : null;
}

/**
 * A shared workshop's event link, as its album link shows: "Open link".
 * @param {string | null} url checked as a web link when read
 */
function eventLink(url) {
  if (!isWebLink(url)) return null;
  return h("span", { className: "item-meta", id: "open-event" },
    h("a", { href: /** @type {string} */ (url), target: "_blank", rel: "noopener noreferrer" }, "Open link"));
}
