// Tags over the journal in memory (format 2): the same functions as
// v1/tags.js. Tags are made by saving a tie, plan or workshop with them
// (records/tags.js).

import { records, record, save } from "./journal.js";
import { stamp } from "../../records/parse.js";
import { tagDeleted } from "../../records/tags.js";
import { listTags as tagRows } from "../queries/tags.js";

/** @typedef {import("../v1/tags.js").Tag} Tag */

/**
 * My tags, most recently used on a tie first, with how many ties, plans and
 * workshops each is on.
 * @returns {Promise<Tag[]>}
 */
export async function listTags() {
  return tagRows({ tags: records("tag"), ties: records("tie"), plans: records("plan"), workshops: records("workshop") });
}

/**
 * Deletes a tag for good, from every tie, plan and workshop it's on, in
 * the same batch.
 * @param {string} id
 */
export async function deleteTag(id) {
  if (record(id)?.kind !== "tag") throw new Error("Not found");
  const items = [...records("tie"), ...records("plan"), ...records("workshop")];
  await save({ writes: tagDeleted(id, items, stamp()), deletes: [{ kind: "tag", id }] });
}
