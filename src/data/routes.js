// Routes for "Your data": exporting everything, and importing.

import { BadInput, json, readJson } from "../http.js";
import { toFlag } from "../parse.js";
import { isoAt } from "../auth/session.js";
import { readAccount } from "./db.js";
import { exportDocument, exportFileName } from "./shape.js";
import { parseImportItems, parseImportTies } from "./import-parse.js";
import { planItems, planTies } from "./import-plan.js";
import { existingItems, insertItems, insertTies, duplicateCandidates } from "./import-db.js";
import { tagNames } from "../tags/db.js";

// An import request's largest body. The page sends ties in batches of 200.
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/** @typedef {import("../auth/user.js").User} User */

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleData(request, env, user, url) {
  // GET /api/data/export -> everything in my account as one JSON document
  //   (see shape.js). The page saves it as a file; opened directly, it
  //   downloads. Never cached (no-store, like every API response).
  if (url.pathname === "/api/data/export" && request.method === "GET") {
    const exportedAt = isoAt(Date.now());
    const doc = exportDocument(await readAccount(env.DB, user.id), exportedAt);
    return json(doc, 200, { "content-disposition": `attachment; filename="${exportFileName(exportedAt)}"` });
  }

  // POST /api/data/import/items  body { preview, people, locations, plans, tags }
  //   -> { people, locations, plans: [{ file_id, name, id, matched }], new_tags }
  //   Matches the file's people, locations and plans to mine by name and adds
  //   the rest (see import-plan.js). id is the item's id in my journal (null
  //   for a new one in a preview). With preview: true, nothing is saved.
  if (url.pathname === "/api/data/import/items" && request.method === "POST") {
    const body = await readImport(request);
    const items = parseImportItems(body);
    const plan = planItems(items, await existingItems(env.DB, user.id), () => crypto.randomUUID());
    const preview = toFlag(body.preview) === 1;
    if (!preview) await insertItems(env.DB, user.id, plan.rows);
    const shown = (/** @type {import("./import-plan.js").ItemResult[]} */ list) =>
      list.map((r) => ({ ...r, id: preview && !r.matched ? null : r.id }));
    return json({
      people: shown(plan.people), locations: shown(plan.locations), plans: shown(plan.plans), new_tags: plan.newTags,
    });
  }

  // POST /api/data/import/ties  body { preview, ties, skip }
  //   preview: true -> { candidates: [{ i, id, notes }], new_tags }: for each
  //     tie (by position) my ties that are the same in everything but the
  //     notes (date, title, type, location, duration, rating, people, plans
  //     and tags), with their ids and notes, encrypted. The page opens those
  //     and decides which ties are exact duplicates. Saves nothing.
  //   otherwise     -> { added, skipped, ids }: adds up to 500 ties (links
  //     must be my ids, from the items request), leaving out the positions
  //     in skip (the duplicates the page found), all in one transaction.
  //     ids: each tie's new id by position (null for a skipped one), for
  //     the page to add its photos to
  if (url.pathname === "/api/data/import/ties" && request.method === "POST") {
    const body = await readImport(request);
    const ties = parseImportTies(body);
    const existingTags = await tagNames(env.DB, user.id);
    if (toFlag(body.preview) === 1) {
      // Placeholder ids: nothing is saved. New tags' ids then match no tie of
      // mine, which is right: a tie with a new tag can't be a duplicate.
      const plan = planTies(ties, existingTags, () => "");
      return json({
        candidates: await duplicateCandidates(env.DB, user.id, plan.rows.ties),
        new_tags: plan.newTags,
      });
    }
    const skip = parseSkip(body.skip, ties.length);
    const plan = planTies(ties.filter((_, i) => !skip.has(i)), existingTags, () => crypto.randomUUID());
    const added = await insertTies(env.DB, user.id, plan.rows);
    const newIds = plan.rows.ties.map((t) => t.id);
    return json({ added, skipped: skip.size, ids: ties.map((_, i) => (skip.has(i) ? null : newIds.shift())) });
  }

  return null;
}

/**
 * An import request's JSON body, refused if it's too big.
 * @param {Request} request
 */
async function readImport(request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_IMPORT_BYTES) throw new BadInput("That's too much to import at once.");
  return readJson(request);
}

/**
 * Positions of ties to leave out (duplicates the page found).
 * @param {unknown} value
 * @param {number} count how many ties there are
 * @returns {Set<number>}
 */
function parseSkip(value, count) {
  if (value === undefined || value === null) return new Set();
  if (!Array.isArray(value) || value.some((i) => !Number.isInteger(i) || i < 0 || i >= count)) {
    throw new BadInput("Couldn't import: reload the page and try again.");
  }
  return new Set(value);
}
