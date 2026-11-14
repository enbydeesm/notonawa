// People and locations over the journal in memory (format 2): the same
// functions as v1/resources.js, so the pages don't change. The rules the
// server and the database kept for format 1 (one "Me", one default
// location, deleted ones left on ties and workshops) are records/edits.js's.
// Plans come in the next slice.

import { records, record, save } from "./journal.js";
import { newId } from "../../records/ids.js";
import { stamp, BadEdit } from "../../records/parse.js";
import {
  personBody, locationBody, clearOtherDefaults, archived, restored, personDeleted, locationDeleted,
} from "../../records/edits.js";
import { listPeople, listLocations } from "../queries/resources.js";

/** @typedef {import("../v1/resources.js").ResourceKind} ResourceKind */
/** @typedef {import("../v1/resources.js").Archived} Archived */

/** Each kind's record kind. */
const RECORD = /** @type {const} */ ({ plans: "plan", people: "person", locations: "location" });

/** @param {ResourceKind} kind */
function notYet(kind) {
  if (kind === "plans") throw new Error("Plans aren't ready in this version yet.");
}

/**
 * @param {ResourceKind} kind
 * @param {Archived} archived
 * @returns {Promise<any[]>}
 */
export async function listItems(kind, archived) {
  notYet(kind);
  return kind === "people" ? listPeople(records("person"), archived) : listLocations(records("location"), archived);
}

/**
 * @param {ResourceKind} kind
 * @param {string} id
 */
function existing(kind, id) {
  const entry = record(id);
  if (!entry || entry.kind !== RECORD[kind]) throw new Error("Not found");
  return entry;
}

/**
 * @param {ResourceKind} kind
 * @param {string | null} id null for a new one
 * @param {Record<string, any>} fields plain, as the form gives them
 * @returns {Promise<string>} its id
 */
export async function saveItem(kind, id, fields) {
  notYet(kind);
  const now = stamp();
  const prev = id ? existing(kind, id) : null;
  const itemId = id ?? newId();
  if (kind === "people") {
    const body = personBody(fields, prev?.body ?? null, now);
    if (!prev && body.is_self && records("person").some((p) => p.body?.is_self)) {
      throw new BadEdit("There's already a profile marked as you.");
    }
    await save({ writes: [{ kind: "person", id: itemId, body, from: prev?.body ?? undefined }] });
    return itemId;
  }
  const body = locationBody(fields, prev?.body ?? null, now);
  await save({ writes: [
    ...(body.is_default ? clearOtherDefaults(records("location"), itemId, now) : []),
    { kind: "location", id: itemId, body, from: prev?.body ?? undefined },
  ] });
  return itemId;
}

/**
 * @param {ResourceKind} kind
 * @param {string} id
 */
export async function archiveItem(kind, id) {
  notYet(kind);
  await save({ writes: [archived(existing(kind, id), stamp())] });
}

/**
 * @param {ResourceKind} kind
 * @param {string} id
 */
export async function restoreItem(kind, id) {
  notYet(kind);
  await save({ writes: [restored(existing(kind, id), stamp())] });
}

/**
 * Deletes a person or location for good: the ties and workshops they were
 * on show "(… deleted)", in the same batch.
 * @param {"people" | "locations"} kind
 * @param {string} id
 */
export async function deleteItem(kind, id) {
  const entry = existing(kind, id);
  const items = [...records("tie"), ...records("workshop")];
  const now = stamp();
  const writes = kind === "people" ? personDeleted(entry, items, now) : locationDeleted(entry, items, now);
  await save({ writes, deletes: [{ kind: RECORD[kind], id }] });
}

/**
 * @param {string} _id
 * @param {"remove" | "keep"} _linkedTies
 */
export async function deletePlan(_id, _linkedTies) {
  notYet("plans");
}
