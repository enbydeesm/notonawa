// Workshops over the journal in memory (format 2): the same functions as
// v1/workshops.js, so the Education view doesn't change. A workshop's
// record from its form, and what deleting or linking one changes, are
// records/edits.js's; its rows are store/queries/workshops.js's.

import { records, record, byId, save } from "./journal.js";
import { newId } from "../../records/ids.js";
import { stamp, BadEdit } from "../../records/parse.js";
import { workshopBody, workshopDeleted, linkedToWorkshop } from "../../records/edits.js";
import { linkTags } from "../../records/tags.js";
import { listWorkshopsIn, workshopRow } from "../queries/workshops.js";

/** @param {string} kind @param {string} id */
function has(kind, id) {
  const entry = record(id);
  return entry?.kind === kind ? entry : null;
}

/** @param {string} id */
function workshopOf(id) {
  const workshop = has("workshop", id);
  if (!workshop) throw new Error("Not found");
  return workshop;
}

/** The ties and plans, which hold their workshop's id. */
const linkable = () => [...records("tie"), ...records("plan")];

/**
 * All my workshops at once, newest first, each with its linked plans and ties.
 * @returns {Promise<any[]>}
 */
export async function listWorkshops() {
  return listWorkshopsIn(records("workshop"), linkable(), byId());
}

/**
 * @param {string} id
 * @returns {Promise<Record<string, any>>}
 */
export async function getWorkshop(id) {
  const workshop = workshopOf(id);
  return workshopRow(workshop, byId(), linkable().filter((i) => i.body?.workshop_id === id));
}

/**
 * Saves a workshop: a new one without an id. New tags are made in the same save.
 * @param {string | null} id
 * @param {Record<string, any>} fields plain
 * @returns {Promise<string>} its id
 */
export async function saveWorkshop(id, fields) {
  const prev = id ? workshopOf(id) : null;
  const now = stamp();
  const workshopId = id ?? newId();
  const tags = linkTags(records("tag"), fields.tags, now);
  const body = workshopBody(fields, prev?.body ?? null, { tagIds: tags.ids, has, now });
  await save({ writes: [...tags.writes, { kind: "workshop", id: workshopId, body, from: prev?.body ?? undefined }] });
  return workshopId;
}

/**
 * Deletes a workshop for good, with its drawings, poses and files; its
 * ties and plans are unlinked.
 * @param {string} id
 */
export async function deleteWorkshop(id) {
  const { writes, deletes } = workshopDeleted(workshopOf(id), linkable(), stamp());
  await save({ writes, deletes: deletes.filter((d) => d.id === id || record(d.id)) });
}

/**
 * Links a tie or plan to a workshop (moving it from any other).
 * @param {string} workshopId
 * @param {{ tie_id: string } | { plan_id: string }} item
 */
export async function linkToWorkshop(workshopId, item) {
  workshopOf(workshopId);
  const [kind, id] = "tie_id" in item ? ["tie", item.tie_id] : ["plan", item.plan_id];
  const target = has(kind, id);
  if (!target) throw new BadEdit("Linked item not found.");
  await save({ writes: [linkedToWorkshop(target, workshopId, stamp())] });
}
