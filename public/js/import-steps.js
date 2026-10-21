// The steps of an import, worked out on the page. Pure (no DOM or fetch), so
// it's easy to test.
//
// An import is sent in parts so no one request does too much work (the
// Worker gets 10 ms of CPU per request on the Free plan):
//   1. the people, locations, plans and tags, which the server matches to
//      mine by name or adds, answering with each one's id in my journal;
//   2. the ties, in batches of TIE_BATCH, with the file's ids swapped for
//      those. Each batch saves all or nothing, and ties that are already in
//      the journal are skipped, so running a failed import again finishes it;
//   3. the workshops, the same way.

export const EXPORT_FORMAT = "notonawa-export";
export const EXPORT_VERSION = 1;
export const TIE_BATCH = 200;

/**
 * @typedef {{ people: any[], locations: any[], plans: any[], tags: string[], ties: any[], workshops: any[] }} ImportDoc
 * @typedef {{ file_id: string, name: string, id: string | null, matched: boolean }} ItemResult
 * @typedef {{ people: ItemResult[], locations: ItemResult[], plans: ItemResult[], new_tags: string[] }} ItemsResponse
 */

/**
 * Checks an export file read as JSON, and returns the parts to import.
 * @param {unknown} data
 * @returns {ImportDoc}
 */
export function readExport(data) {
  const doc = /** @type {Record<string, any>} */ (data && typeof data === "object" ? data : {});
  if (doc.format !== EXPORT_FORMAT) throw new Error("This isn't a NotoNawa export.");
  if (doc.version !== EXPORT_VERSION) {
    throw new Error(doc.version > EXPORT_VERSION
      ? "This export is from a newer version of NotoNawa. Reload the page and try again."
      : "This export's version isn't supported.");
  }
  /** @param {unknown} v */
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    people: list(doc.people), locations: list(doc.locations), plans: list(doc.plans),
    tags: list(doc.tags), ties: list(doc.ties), workshops: list(doc.workshops),
  };
}

/**
 * The role names an export was made with (account.settings), or null if it
 * has none (older exports, CSVs).
 * @param {unknown} data the export, read as JSON
 * @returns {{ top_label: string | null, bottom_label: string | null } | null}
 */
export function exportRoleNames(data) {
  const settings = /** @type {Record<string, any>} */ (data)?.account?.settings;
  if (!settings || typeof settings !== "object") return null;
  /** @param {unknown} v */
  const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const names = { top_label: text(settings.top_label), bottom_label: text(settings.bottom_label) };
  return names.top_label || names.bottom_label ? names : null;
}

/**
 * The first request's body.
 * @param {ImportDoc} doc
 * @param {boolean} preview
 */
export function itemsBody(doc, preview) {
  return { preview, people: doc.people, locations: doc.locations, plans: doc.plans, tags: doc.tags };
}

/**
 * Swaps the file's ids on each tie for my journal's (from the items
 * response). A link to something that isn't in the file is an error, named
 * by the tie, rather than a link that's quietly dropped.
 * @param {any[]} ties
 * @param {ItemsResponse} items
 * @returns {any[]}
 */
export function remapTies(ties, items) {
  const people = idMap(items.people);
  const locations = idMap(items.locations);
  const plans = idMap(items.plans);
  return ties.map((tie, i) => {
    const name = tie?.title ? `Tie ${i + 1} ("${tie.title}")` : `Tie ${i + 1}`;
    /**
     * @param {Map<string, string>} map
     * @param {unknown} id
     * @param {string} what
     */
    const swap = (map, id, what) => {
      if (id === null || id === undefined || id === "") return null;
      const mine = map.get(String(id));
      if (!mine) throw new Error(`${name} links to ${what} that isn't in the file.`);
      return mine;
    };
    return {
      ...tie,
      location_id: swap(locations, tie?.location_id, "a location"),
      participants: (Array.isArray(tie?.participants) ? tie.participants : [])
        .map((/** @type {any} */ p) => ({ ...p, person_id: swap(people, p?.person_id, "a person") })),
      plans: (Array.isArray(tie?.plans) ? tie.plans : [])
        .map((/** @type {any} */ p) => ({ ...p, plan_id: swap(plans, p?.plan_id, "a plan") })),
    };
  });
}

/**
 * Swaps the file's ids on each workshop for my journal's, as remapTies does.
 * @param {any[]} workshops
 * @param {ItemsResponse} items
 * @returns {any[]}
 */
export function remapWorkshops(workshops, items) {
  const people = idMap(items.people);
  const locations = idMap(items.locations);
  return workshops.map((workshop, i) => {
    const name = workshop?.title ? `Workshop ${i + 1} ("${workshop.title}")` : `Workshop ${i + 1}`;
    /** @param {Map<string, string>} map @param {unknown} id @param {string} what */
    const swap = (map, id, what) => {
      if (id === null || id === undefined || id === "") return null;
      const mine = map.get(String(id));
      if (!mine) throw new Error(`${name} links to ${what} that isn't in the file.`);
      return mine;
    };
    /** @param {unknown} list */
    const swapPeople = (list) => (Array.isArray(list) ? list : [])
      .map((/** @type {any} */ p) => ({ ...p, person_id: swap(people, p?.person_id, "a person") }));
    return {
      ...workshop,
      location_id: swap(locations, workshop?.location_id, "a location"),
      educators: swapPeople(workshop?.educators),
      participants: swapPeople(workshop?.participants),
    };
  });
}

/**
 * For a preview, before anything exists: every link is checked against the
 * file the same way, using placeholder ids.
 * @param {ImportDoc} doc
 */
export function checkLinks(doc) {
  /** @param {any[]} list @param {string} [label] */
  const fake = (list, label = "name") => list.map((x) => ({ file_id: String(x?.id), name: x?.[label], id: "x", matched: false }));
  const items = { people: fake(doc.people), locations: fake(doc.locations), plans: fake(doc.plans, "title"), new_tags: [] };
  remapTies(doc.ties, items);
  remapWorkshops(doc.workshops, items);
}

/**
 * @template T
 * @param {T[]} list
 * @param {number} [size]
 * @returns {T[][]}
 */
export function batches(list, size = TIE_BATCH) {
  const result = [];
  for (let i = 0; i < list.length; i += size) result.push(list.slice(i, i + size));
  return result;
}

/**
 * What the preview found, in words, e.g. "2 new: Alex, Sam" and "1 already
 * in your journal: Studio".
 * @param {ItemResult[]} results
 */
export function describeItems(results) {
  const added = results.filter((r) => !r.matched).map((r) => r.name);
  const matched = results.filter((r) => r.matched).map((r) => r.name);
  return {
    added: added.length ? `${added.length} new: ${added.join(", ")}` : null,
    matched: matched.length ? `${matched.length} already in your journal: ${matched.join(", ")}` : null,
  };
}

/** @param {any[]} list */
function idMap(list) {
  return new Map(list.map((r) => [String(r.file_id), /** @type {string} */ (r.id)]));
}
