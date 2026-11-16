// Importing into a format 2 journal: what format 1's server did
// (src/data/import-parse.js, import-plan.js and import-db.js), done on the
// device over the journal in memory, with the same requests and answers,
// so the Your data view runs the same steps for both formats:
//
// - items: the file's people, locations and plans, matched to mine by name
//   (an exact spelling first, then ignoring capitals; active before
//   archived; the file's "me" is mine; `match: false` always added) and the
//   rest made new, with their tags.
// - ties and workshops, in batches, their links already my ids (the page
//   swaps them, import-steps.js). With preview, the ones of mine that are
//   the same in everything but their notes (the page compares those,
//   import-dedupe.js); otherwise the writes that add them, leaving out the
//   positions the page skips as duplicates.
//
// A matched item is used as it is: an import never changes what's there.
// Connections come with contacts: every person's connection_id is dropped
// (counted in links_dropped). Pure: new ids come from a function passed in.

import { BadEdit, cleanText, flag, intOrNull, numberOrNull, dateOrNull, roleOrNull, choiceOrNull, urlOrNull, compact } from "./parse.js";
import { TIE_TYPES, PLAN_STAGES, PLAN_TYPES, PROFILE_NOTE_TYPES, WORKSHOP_ROLES } from "./schema.js";
import { tagKey, findTag } from "../tags.js";
import { tagNames } from "./tags.js";
import { readAliases } from "../aliases.js";

/** @typedef {import("./edits.js").Entry} Entry */
/** @typedef {import("./edits.js").Write} Write */
/** @typedef {{ file_id: string, name: string, id: string | null, matched: boolean }} ItemResult */

export const MAX_ITEMS = 5000;
export const MAX_BATCH = 500;
const MAX_LINKS = 20;
const MAX_WORKSHOP_PEOPLE = 40;
const MAX_LINKED = 2000;
const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

/**
 * Runs a parser, naming the item in any message, as the server did.
 * @template T
 * @param {string} where
 * @param {unknown} name
 * @param {() => T} parse
 * @returns {T}
 */
function withContext(where, name, parse) {
  try {
    return parse();
  } catch (err) {
    if (!(err instanceof BadEdit)) throw err;
    const named = typeof name === "string" && name.trim() ? ` ("${name.trim().slice(0, 60)}")` : "";
    throw new BadEdit(`${where}${named}: ${err.message}`);
  }
}

/**
 * @param {unknown} value
 * @param {string} what
 * @param {number} [max]
 * @returns {any[]}
 */
function list(value, what, max = MAX_LINKS) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) throw new BadEdit(`${what} should be a list of up to ${max}.`);
  return value;
}

/** @param {unknown} value @returns {Record<string, any>} */
function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadEdit("Expected an object.");
  return /** @type {Record<string, any>} */ (value);
}

/**
 * @param {unknown} value
 * @param {boolean} [nullable]
 * @returns {string | null}
 */
function idOf(value, nullable = false) {
  const id = typeof value === "string" || typeof value === "number" ? cleanText(value) : null;
  if (id === null) {
    if (nullable) return null;
    throw new BadEdit("Each item needs an id.");
  }
  if (id.length > 100) throw new BadEdit("That id is too long.");
  return id;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function timeOf(value) {
  const text = cleanText(value);
  if (text === null) return null;
  const time = TIMESTAMP.test(text) ? new Date(text) : null;
  if (!time || Number.isNaN(time.getTime()) || time.toISOString().replace(/\.\d{3}Z$/, "Z") !== text) {
    throw new BadEdit("Expected a time like 2026-10-12T21:51:00Z.");
  }
  return text;
}

/** @param {Record<string, any>} item @param {string} now */
function times(item, now) {
  const created = timeOf(item.created_at) ?? now;
  return { archived_at: timeOf(item.archived_at), created_at: created, updated_at: timeOf(item.updated_at) ?? created };
}

/**
 * The file's items of one kind, each with its file id once.
 * @template T
 * @param {unknown} value
 * @param {string} what
 * @param {string} label
 * @param {(item: Record<string, any>) => T & { file_id: string }} parse
 */
function eachItem(value, what, label, parse) {
  const ids = new Set();
  return list(value, what, MAX_ITEMS).map((item, i) => {
    const parsed = withContext(`${what} ${i + 1}`, item?.[label], () => parse(asObject(item)));
    if (ids.has(parsed.file_id)) throw new BadEdit(`${what} ${i + 1}: the id ${parsed.file_id} is used twice.`);
    ids.add(parsed.file_id);
    return parsed;
  });
}

/**
 * Mine with this name: an exact spelling first, then ignoring capitals;
 * active before archived.
 * @param {{ id: string, name: string, archived: boolean }[]} items
 * @param {string} name
 */
function byName(items, name) {
  const ordered = [...items.filter((i) => !i.archived), ...items.filter((i) => i.archived)];
  return ordered.find((i) => i.name === name) ?? ordered.find((i) => tagKey(i.name) === tagKey(name));
}

/**
 * Tag names matched to my tags; the rest new tags, each once (the first spelling).
 * @param {Entry[]} tags my tag records
 * @param {string[]} names
 * @param {() => string} newId
 * @param {string} now
 */
function tagsFor(tags, names, newId, now) {
  /** @type {{ id: string, name: string }[]} */
  const known = tags.map((t) => ({ id: t.id, name: /** @type {string} */ (t.body?.name) }));
  /** @type {Write[]} */
  const writes = [];
  /** @param {string} name */
  const resolve = (name) => {
    const found = findTag(known, name);
    if (found) return found.id;
    const id = newId();
    known.push({ id, name });
    writes.push({ kind: "tag", id, body: { name, created_at: now, updated_at: now } });
    return id;
  };
  for (const name of names) resolve(name);
  // Read when asked: a batch's ties and workshops resolve their tags after this.
  return { writes, resolve, newNames: () => writes.map((w) => /** @type {string} */ (w.body.name)) };
}

/**
 * POST /api/data/import/items, on the device: matches the file's people,
 * locations and plans to mine and makes the rest.
 * @param {Record<string, any>} body { people, locations, plans, tags, preview }
 * @param {Record<string, Entry[]>} mine my records by kind (person, location, plan, tag)
 * @param {() => string} newId
 * @param {string} now
 * @returns {{ result: { people: ItemResult[], locations: ItemResult[], plans: ItemResult[], new_tags: string[], links_dropped: number },
 *   writes: Write[] }}
 */
export function importItems(body, mine, newId, now) {
  const people = eachItem(body.people, "People", "name", (p) => ({
    file_id: /** @type {string} */ (idOf(p.id)), p,
    name: /** @type {string} */ (cleanText(p.name) ?? (() => { throw new BadEdit("Give the person a name."); })()),
    is_self: flag(p.is_self), always_new: p.match === false,
  }));
  if (people.filter((p) => p.is_self).length > 1) throw new BadEdit("Only one person can be marked as you.");
  const locations = eachItem(body.locations, "Locations", "name", (l) => ({
    file_id: /** @type {string} */ (idOf(l.id)), l,
    name: /** @type {string} */ (cleanText(l.name) ?? (() => { throw new BadEdit("Give the location a name."); })()),
    always_new: l.match === false,
  }));
  const plans = eachItem(body.plans, "Plans", "title", (p) => ({
    file_id: /** @type {string} */ (idOf(p.id)), p,
    title: /** @type {string} */ (cleanText(p.title) ?? (() => { throw new BadEdit("Give the plan a title."); })()),
    variation_of: idOf(p.variation_of, true), tags: tagNames(p.tags), always_new: p.match === false,
  }));
  const planFileIds = new Set(plans.map((p) => p.file_id));
  for (const plan of plans) {
    if (plan.variation_of === plan.file_id) throw new BadEdit(`Plan "${plan.title}" can't be a variation of itself.`);
    if (plan.variation_of !== null && !planFileIds.has(plan.variation_of)) {
      throw new BadEdit(`Plan "${plan.title}" is a variation of a plan that isn't in the file.`);
    }
  }
  // The file's own list of tags (an export lists every tag, used or not).
  const fileTags = list(body.tags, "Tags", MAX_ITEMS).flatMap((name) => {
    const text = typeof name === "string" ? cleanText(name) : null;
    if (text !== null && text.length > 40) throw new BadEdit("Keep tags to 40 characters or fewer.");
    return text === null ? [] : [text];
  });

  const named = (/** @type {Entry[]} */ entries, /** @type {string} */ field) =>
    entries.map((e) => ({ id: e.id, name: /** @type {string} */ (e.body?.[field] ?? ""), archived: !!e.body?.archived_at, body: e.body }));
  const myPeople = named(mine.person ?? [], "name");
  const myLocations = named(mine.location ?? [], "name");
  const myPlans = named(mine.plan ?? [], "title");
  const mySelf = myPeople.find((p) => p.body?.is_self);

  /** @param {string} fileId @param {string} name @param {{ id: string } | undefined} match */
  const result = (fileId, name, match) => (match
    ? { file_id: fileId, name, id: match.id, matched: true } : { file_id: fileId, name, id: newId(), matched: false });
  const peopleResults = people.map((p) => result(p.file_id, p.name,
    p.always_new ? undefined : p.is_self && mySelf ? mySelf : byName(myPeople, p.name)));
  const locationResults = locations.map((l) => result(l.file_id, l.name, l.always_new ? undefined : byName(myLocations, l.name)));
  const planResults = plans.map((p) => result(p.file_id, p.title, p.always_new ? undefined : byName(myPlans, p.title)));
  const planIds = new Map(planResults.map((r) => [r.file_id, r.id]));

  const newPlans = plans.filter((_, i) => !planResults[i].matched);
  const tags = tagsFor(mine.tag ?? [], [...fileTags, ...newPlans.flatMap((p) => p.tags)], newId, now);
  const hasDefault = myLocations.some((l) => l.body?.is_default);
  const defaultFile = hasDefault ? null
    : locations.find((l, i) => flag(l.l.is_default) && !l.l.archived_at && !locationResults[i].matched)?.file_id ?? null;
  let linksDropped = 0;

  /** @type {Write[]} */
  const writes = [...tags.writes];
  people.forEach(({ p, is_self: isSelf }, i) => {
    if (peopleResults[i].matched) return;
    withContext(`People ${i + 1}`, p.name, () => {
      if (cleanText(p.connection_id)) linksDropped++;
      writes.push({ kind: "person", id: peopleResults[i].id, body: compact({
        name: people[i].name, pronouns: cleanText(p.pronouns), notes: cleanText(p.notes),
        is_self: isSelf && !mySelf ? true : null, default_role: roleOrNull(p.default_role), is_educator: flag(p.is_educator),
        based_in: cleanText(p.based_in), aliases: (() => { const a = readAliases(cleanText(p.aliases)); return a.length ? a : null; })(),
        about: cleanText(p.about), about_shared_on: dateOrNull(p.about_shared_on),
        profile_notes: (() => {
          const notes = list(p.profile_notes, "Profile notes", MAX_ITEMS).map((n) => {
            const note = asObject(n);
            const type = choiceOrNull(note.type, PROFILE_NOTE_TYPES);
            const description = cleanText(note.description);
            if (!type || !description) throw new BadEdit("Each profile note needs a type and a description.");
            return compact({
              id: newId(), type, description, noted_on: dateOrNull(note.noted_on),
              is_current: note.is_current === undefined || note.is_current === null ? true : flag(note.is_current),
              created_at: timeOf(note.created_at), updated_at: timeOf(note.updated_at),
            });
          });
          return notes.length ? notes : null;
        })(),
        ...times(p, now),
      }) });
    });
  });
  locations.forEach(({ l }, i) => {
    if (locationResults[i].matched) return;
    withContext(`Locations ${i + 1}`, l.name, () => {
      writes.push({ kind: "location", id: locationResults[i].id, body: compact({
        name: locations[i].name, notes: cleanText(l.notes), maps_url: urlOrNull(l.maps_url),
        city: cleanText(l.city), state_province: cleanText(l.state_province), country: cleanText(l.country),
        latitude: numberOrNull(l.latitude, -90, 90), longitude: numberOrNull(l.longitude, -180, 180),
        is_default: locations[i].file_id === defaultFile, ...times(l, now),
      }) });
    });
  });
  plans.forEach(({ p, tags: names, variation_of: variationOf }, i) => {
    if (planResults[i].matched) return;
    withContext(`Plans ${i + 1}`, p.title, () => {
      const tagIds = names.map(tags.resolve);
      writes.push({ kind: "plan", id: planResults[i].id, body: compact({
        title: plans[i].title, stage: choiceOrNull(p.stage, PLAN_STAGES) ?? "idea", plan_type: choiceOrNull(p.plan_type, PLAN_TYPES) ?? "idea",
        tie_type: choiceOrNull(p.tie_type, TIE_TYPES), description: cleanText(p.description), notes: cleanText(p.notes),
        album_url: cleanText(p.album_url), est_difficulty: intOrNull(p.est_difficulty, 1, 5),
        variation_of: variationOf === null ? null : planIds.get(variationOf), version: intOrNull(p.version, 1, 1_000_000) ?? 1,
        tags: tagIds.length ? tagIds : null, ...times(p, now),
      }) });
    });
  });

  const preview = flag(body.preview);
  /** @param {ItemResult[]} results */
  const shown = (results) => results.map((r) => ({ ...r, id: preview && !r.matched ? null : r.id }));
  return {
    result: { people: shown(peopleResults), locations: shown(locationResults), plans: shown(planResults), new_tags: tags.newNames(),
      links_dropped: linksDropped },
    writes: preview ? [] : writes,
  };
}

/**
 * Positions to leave out (the duplicates the page found).
 * @param {unknown} value
 * @param {number} count
 */
function skipOf(value, count) {
  if (value === undefined || value === null) return new Set();
  if (!Array.isArray(value) || value.some((i) => !Number.isInteger(i) || i < 0 || i >= count)) {
    throw new BadEdit("Couldn't import: reload the page and try again.");
  }
  return new Set(/** @type {number[]} */ (value));
}

/**
 * Sorted, joined: the same lists in any order give the same text.
 * @param {string[]} items
 */
const sortedList = (items) => [...items].sort().join(",");

/**
 * A tie's people with roles, plans and tags as one text, to tell a
 * duplicate from a different tie (import-plan.js's linksKey).
 * @param {Record<string, any>} b
 */
function tieLinks(b) {
  return [
    sortedList((b.participants ?? []).map((/** @type {any} */ p) => `${p.person_id ?? ""}|${p.role}`)),
    sortedList((b.plans ?? []).map((/** @type {any} */ p) => p.plan_id ?? "")),
    sortedList(b.tags ?? []),
  ].join(";");
}

/** @param {Record<string, any>} b */
function workshopLinks(b) {
  return [
    sortedList((b.people ?? []).map((/** @type {any} */ p) => `${p.person_id ?? ""}|${p.kind}|${p.role}`)),
    sortedList(b.tags ?? []),
  ].join(";");
}

/**
 * @param {Map<string, Entry>} byId
 * @param {string | null} id
 * @param {string} kind
 */
function mustBe(byId, id, kind) {
  if (id !== null && byId.get(id)?.kind !== kind) throw new BadEdit("Linked item not found.");
}

/**
 * POST /api/data/import/ties, on the device.
 * @param {Record<string, any>} body { ties, skip, preview }
 * @param {Record<string, Entry[]>} mine my records by kind
 * @param {() => string} newId
 * @param {string} now
 * @returns {{ result: any, writes: Write[] }}
 */
export function importTies(body, mine, newId, now) {
  const byId = new Map(Object.values(mine).flat().map((e) => [e.id, e]));
  if (!Array.isArray(body.ties) || body.ties.length > MAX_BATCH) throw new BadEdit(`Send ties as a list of up to ${MAX_BATCH}.`);
  const input = body.ties;
  const preview = flag(body.preview);
  // A preview's links can be to people and places the items' preview made
  // up (not saved yet), as format 1's preview allowed: only saving checks them.
  const must = (/** @type {string | null} */ id, /** @type {string} */ kind) => { if (!preview) mustBe(byId, id, kind); };
  const tags = tagsFor(mine.tag ?? [], [], preview ? () => "" : newId, now);
  const ties = input.map((item, i) => withContext(`Tie ${i + 1}`, item?.title, () => {
    const t = asObject(item);
    const tieDate = dateOrNull(t.tie_date);
    if (!tieDate) throw new BadEdit("Add a date.");
    const tieType = choiceOrNull(t.tie_type, TIE_TYPES);
    if (!tieType) throw new BadEdit("Choose a tie type: suspension, partial suspension, floor or hashira.");
    const locationId = idOf(t.location_id, true);
    must(locationId, "location");
    const seenPeople = new Set();
    const participants = list(t.participants, "Participants").flatMap((x) => {
      const p = asObject(x);
      const personId = idOf(p.person_id, true);
      const role = roleOrNull(p.role);
      if (!role) throw new BadEdit("Each participant needs a role.");
      if (personId !== null) {
        if (seenPeople.has(`${personId}|${role}`)) return [];
        seenPeople.add(`${personId}|${role}`);
        must(personId, "person");
      }
      return [compact({ person_id: personId, role, difficulty_rating: intOrNull(p.difficulty_rating, 1, 5),
        experience_rating: intOrNull(p.experience_rating, 1, 5), notes: cleanText(p.notes) })];
    });
    const seenPlans = new Set();
    const plans = list(t.plans, "Plans").flatMap((x) => {
      const p = asObject(x);
      const planId = idOf(p.plan_id, true);
      if (planId !== null) {
        if (seenPlans.has(planId)) return [];
        seenPlans.add(planId);
        must(planId, "plan");
      }
      const version = intOrNull(p.plan_version, 1, 1_000_000) ?? (planId ? byId.get(planId)?.body?.version ?? 1 : 1);
      return [{ plan_id: planId, plan_version: version }];
    });
    const tagIds = tagNames(t.tags).map(tags.resolve);
    return compact({
      title: cleanText(t.title), tie_date: tieDate, tie_type: tieType, notes: cleanText(t.notes), album_url: cleanText(t.album_url),
      duration_minutes: intOrNull(t.duration_minutes, 0, 1440), success_rating: intOrNull(t.success_rating, 1, 5),
      location_id: locationId, location_deleted: locationId === null && flag(t.location_deleted) ? true : null,
      participants: participants.length ? participants : null, plans: plans.length ? plans : null, tags: tagIds.length ? tagIds : null,
      ...times(t, now), archived_at: null,
    });
  }));

  if (preview) {
    const mineTies = mine.tie ?? [];
    const candidates = ties.flatMap((t, i) => mineTies.filter((x) => sameTie(x.body ?? {}, t)).map((x) => ({ i, id: x.id, notes: x.body?.notes ?? null })));
    return { result: { candidates, new_tags: tags.newNames() }, writes: [] };
  }
  const skip = skipOf(body.skip, ties.length);
  /** @type {(string | null)[]} */
  const ids = ties.map((_, i) => (skip.has(i) ? null : newId()));
  // Only the tags the added ties use.
  const used = new Set(ties.filter((_, i) => !skip.has(i)).flatMap((t) => t.tags ?? []));
  return {
    result: { added: ties.length - skip.size, skipped: skip.size, ids },
    writes: [
      ...tags.writes.filter((w) => used.has(w.id)),
      ...ties.flatMap((t, i) => (ids[i] ? [{ kind: /** @type {const} */ ("tie"), id: /** @type {string} */ (ids[i]), body: t }] : [])),
    ],
  };
}

/**
 * Whether my tie is the same as the file's in everything but its notes
 * (and album link): date, title, type, location, duration, rating,
 * people, plans and tags. As import-db.js's SAME_BUT_NOTES.
 * @param {Record<string, any>} x mine
 * @param {Record<string, any>} t the file's
 */
function sameTie(x, t) {
  return x.tie_date === t.tie_date && (x.title ?? null) === (t.title ?? null) && x.tie_type === t.tie_type
    && (x.location_id ?? null) === (t.location_id ?? null) && !!x.location_deleted === !!t.location_deleted
    && (x.duration_minutes ?? null) === (t.duration_minutes ?? null) && (x.success_rating ?? null) === (t.success_rating ?? null)
    && tieLinks(x) === tieLinks(t);
}

/**
 * POST /api/data/import/workshops, on the device. Its linked ties and
 * plans (mine already) are moved onto it.
 * @param {Record<string, any>} body { workshops, skip, preview }
 * @param {Record<string, Entry[]>} mine
 * @param {() => string} newId
 * @param {string} now
 * @returns {{ result: any, writes: Write[] }}
 */
export function importWorkshops(body, mine, newId, now) {
  const byId = new Map(Object.values(mine).flat().map((e) => [e.id, e]));
  if (!Array.isArray(body.workshops) || body.workshops.length > MAX_BATCH) throw new BadEdit(`Send workshops as a list of up to ${MAX_BATCH}.`);
  const preview = flag(body.preview);
  const must = (/** @type {string | null} */ id, /** @type {string} */ kind) => { if (!preview) mustBe(byId, id, kind); };
  const tags = tagsFor(mine.tag ?? [], [], preview ? () => "" : newId, now);
  const workshops = body.workshops.map((item, i) => withContext(`Workshop ${i + 1}`, item?.title, () => {
    const w = asObject(item);
    const title = cleanText(w.title);
    if (!title) throw new BadEdit("Add a title.");
    const start = dateOrNull(w.start_date);
    if (!start) throw new BadEdit("Add a start date.");
    let end = dateOrNull(w.end_date);
    if (end !== null && end < start) throw new BadEdit("The end date is before the start date.");
    if (end === start) end = null;
    const locationId = idOf(w.location_id, true);
    must(locationId, "location");
    /** @type {{ person_id: string | null, kind: string, role: string }[]} */
    const people = [];
    const seen = new Set();
    for (const kind of ["educator", "participant"]) {
      for (const x of list(w[`${kind}s`], kind === "educator" ? "Educators" : "Participants", MAX_WORKSHOP_PEOPLE)) {
        const p = asObject(x);
        const personId = idOf(p.person_id, true);
        const role = roleOrNull(p.role, WORKSHOP_ROLES);
        if (!role) throw new BadEdit(`Each ${kind} needs a role.`);
        if (personId !== null) {
          if (seen.has(personId)) continue;
          seen.add(personId);
          must(personId, "person");
        }
        people.push({ person_id: personId, kind, role });
      }
    }
    if (people.length > MAX_WORKSHOP_PEOPLE) throw new BadEdit(`A workshop can have up to ${MAX_WORKSHOP_PEOPLE} people.`);
    /** @param {unknown} value @param {string} what @param {string} kind */
    const linked = (value, what, kind) => [...new Set(list(value, `Its ${what}`, MAX_LINKED).map((x) => {
      const id = /** @type {string} */ (idOf(x));
      must(id, kind);
      return id;
    }))];
    const tagIds = tagNames(w.tags).map(tags.resolve);
    return {
      body: compact({
        title, start_date: start, end_date: end, location_id: locationId,
        location_deleted: locationId === null && flag(w.location_deleted) ? true : null,
        attendee_count: intOrNull(w.attendee_count, 0, 100_000), rating: intOrNull(w.rating, 1, 5), difficulty: intOrNull(w.difficulty, 1, 5),
        rating_content: intOrNull(w.rating_content, 1, 5), rating_teaching: intOrNull(w.rating_teaching, 1, 5),
        rating_value: intOrNull(w.rating_value, 1, 5), cost: cleanText(w.cost), event_url: cleanText(w.event_url),
        description: cleanText(w.description), notes: cleanText(w.notes), album_url: cleanText(w.album_url),
        people: people.length ? people : null, tags: tagIds.length ? tagIds : null, ...times(w, now), archived_at: null,
      }),
      ties: linked(w.ties, "ties", "tie"),
      plans: linked(w.plans, "plans", "plan"),
    };
  }));

  if (preview) {
    const mineWorkshops = mine.workshop ?? [];
    const candidates = workshops.flatMap((w, i) => mineWorkshops.filter((x) => sameWorkshop(x.body ?? {}, w.body))
      .map((x) => ({ i, id: x.id, description: x.body?.description ?? null, notes: x.body?.notes ?? null })));
    return { result: { candidates, new_tags: tags.newNames() }, writes: [] };
  }
  const skip = skipOf(body.skip, workshops.length);
  /** @type {(string | null)[]} */
  const ids = workshops.map((_, i) => (skip.has(i) ? null : newId()));
  const used = new Set(workshops.filter((_, i) => !skip.has(i)).flatMap((w) => w.body.tags ?? []));
  /** @type {Map<string, Write>} */
  const moved = new Map();
  workshops.forEach((w, i) => {
    if (!ids[i]) return;
    for (const id of [...w.ties, ...w.plans]) {
      const item = /** @type {Entry} */ (byId.get(id));
      const prev = moved.get(id)?.body ?? item.body ?? {};
      // Its updated_at left as it was, as format 1's import left it: the
      // link is the file's, not a change made now.
      moved.set(id, { kind: /** @type {any} */ (item.kind), id, from: item.body ?? undefined, body: { ...prev, workshop_id: ids[i] } });
    }
  });
  return {
    result: { added: workshops.length - skip.size, skipped: skip.size, ids },
    writes: [
      ...tags.writes.filter((w) => used.has(w.id)),
      ...workshops.flatMap((w, i) => (ids[i] ? [{ kind: /** @type {const} */ ("workshop"), id: /** @type {string} */ (ids[i]), body: w.body }] : [])),
      ...moved.values(),
    ],
  };
}

/**
 * Whether my workshop is the same as the file's in everything but what
 * format 1 kept encrypted. As import-db.js's SAME_WORKSHOP.
 * @param {Record<string, any>} x
 * @param {Record<string, any>} w
 */
function sameWorkshop(x, w) {
  const same = (/** @type {string} */ f) => (x[f] ?? null) === (w[f] ?? null);
  return x.start_date === w.start_date && x.title === w.title
    && ["end_date", "location_id", "attendee_count", "rating", "difficulty", "rating_content", "rating_teaching", "rating_value"].every(same)
    && !!x.location_deleted === !!w.location_deleted && workshopLinks(x) === workshopLinks(w);
}
