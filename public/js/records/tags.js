// Tags in format 2: each is a record ({ name }), and a tie, plan or
// workshop lists its tags' ids. Saving an item with tag names links the
// tags I have (matched as the server matches them, ignoring capitals) and
// makes records for new ones, in the same batch; deleting a tag takes it
// off everything. Pure.

import { cleanText, BadEdit } from "./parse.js";
import { tagKey, findTag, MAX_TAGS, MAX_TAG_LENGTH } from "../tags.js";
import { newId } from "./ids.js";

/** @typedef {import("./edits.js").Entry} Entry */
/** @typedef {import("./edits.js").Write} Write */

/**
 * An item's tags, as names: trimmed, blanks dropped, and names that differ
 * only by capitals kept once (the first spelling). As src/tags/parse.js.
 * @param {unknown} value
 * @returns {string[]}
 */
export function tagNames(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_TAGS) throw new BadEdit(`Tags should be a list of up to ${MAX_TAGS} tags.`);
  const seen = new Set();
  /** @type {string[]} */
  const names = [];
  for (const item of value) {
    const name = typeof item === "string" ? cleanText(item) : null;
    if (name === null) continue;
    if (name.length > MAX_TAG_LENGTH) throw new BadEdit(`Keep tags to ${MAX_TAG_LENGTH} characters or fewer.`);
    if (seen.has(tagKey(name))) continue;
    seen.add(tagKey(name));
    names.push(name);
  }
  return names;
}

/**
 * The tag ids for an item's names, and the records of the new ones.
 * @param {Entry[]} tags every tag record
 * @param {unknown} names as the form sends them
 * @param {string} now
 * @param {() => string} [makeId]
 * @returns {{ ids: string[], writes: Write[] }}
 */
export function linkTags(tags, names, now, makeId = newId) {
  const existing = tags.filter((t) => t.body?.name).map((t) => ({ id: t.id, name: /** @type {string} */ (t.body?.name) }));
  /** @type {Write[]} */
  const writes = [];
  const ids = tagNames(names).map((name) => {
    const match = findTag(existing, name);
    if (match) return match.id;
    const id = makeId();
    existing.push({ id, name });
    writes.push({ kind: "tag", id, body: { name, created_at: now, updated_at: now } });
    return id;
  });
  return { ids, writes };
}

/**
 * Deleting a tag: off every tie, plan and workshop that has it.
 * @param {string} tagId
 * @param {Entry[]} items every tie, plan and workshop
 * @param {string} now
 * @returns {Write[]}
 */
export function tagDeleted(tagId, items, now) {
  return items.flatMap((item) => {
    const body = item.body;
    if (!body || !Array.isArray(body.tags) || !body.tags.includes(tagId)) return [];
    return [{ kind: /** @type {any} */ (item.kind), id: item.id, from: body,
      body: { ...body, tags: body.tags.filter((/** @type {string} */ t) => t !== tagId), updated_at: now } }];
  });
}
