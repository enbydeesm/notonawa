// The Ties list's search state. The filters (people, locations, tags, dates),
// the page, the sort and the page size are kept in the page URL so refresh
// and Back keep them. The keyword
// never is: a URL ends up in browser history (and synced to other devices),
// so it's kept in memory only. Pure (no DOM), so it's easy to test.

/**
 * @typedef {{
 *   person_ids: string[],
 *   location_ids: string[],
 *   tag_ids: string[],
 *   tag_match: "any" | "all",
 *   from: string,
 *   to: string,
 *   q: string,
 *   page: number,
 *   page_size: number,
 *   sort: "newest" | "oldest",
 * }} SearchState
 */

/** Ties per page the list offers; the first is the default. Same as the API. */
export const PAGE_SIZES = [20, 50, 100];

/**
 * Reads the filters and page from the URL. Any keyword in it (from an old
 * bookmark) is ignored; see hasKeywordInUrl.
 * @param {string} search a URL's query string, e.g. location.search
 * @returns {SearchState}
 */
export function readSearch(search) {
  const params = new URLSearchParams(search);
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("per_page"));
  return {
    person_ids: params.getAll("person_id").filter(Boolean),
    location_ids: params.getAll("location_id").filter(Boolean),
    tag_ids: params.getAll("tag_id").filter(Boolean),
    tag_match: params.get("tags") === "all" ? "all" : "any",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    q: "",
    page: Number.isInteger(page) && page > 1 ? page : 1,
    page_size: PAGE_SIZES.includes(pageSize) ? pageSize : PAGE_SIZES[0],
    sort: params.get("sort") === "oldest" ? "oldest" : "newest",
  };
}

/**
 * True if the URL has a keyword in it (from before keywords left the URL), so
 * the page can rewrite the address without it.
 * @param {string} search a URL's query string, e.g. location.search
 */
export function hasKeywordInUrl(search) {
  return new URLSearchParams(search).has("q");
}

/**
 * The page URL's query string: everything but the keyword, leaving out
 * anything empty (and page 1). Tags go in as ids: their names are typed by
 * the user, so they stay out of URLs. No leading "?".
 * @param {SearchState} state
 */
export function pageQuery(state) {
  const params = new URLSearchParams();
  for (const id of state.person_ids) params.append("person_id", id);
  for (const id of state.location_ids) params.append("location_id", id);
  for (const id of state.tag_ids) params.append("tag_id", id);
  // "any" is the default, so only "all" goes in the address.
  if (state.tag_match === "all") params.set("tags", "all");
  if (state.from) params.set("from", state.from);
  if (state.to) params.set("to", state.to);
  if (state.page > 1) params.set("page", String(state.page));
  // Defaults (20 a page, newest first) are left out.
  if (state.page_size !== PAGE_SIZES[0]) params.set("per_page", String(state.page_size));
  if (state.sort === "oldest") params.set("sort", "oldest");
  return params.toString();
}

/**
 * The body for POST /api/ties/search. The keyword never goes to the server:
 * it's searched for on the device (the crypto Worker opens the notes), and
 * only the ids of the ties it matched are sent.
 * @param {SearchState} state
 * @param {string[] | null} matchIds the ties the keyword matched; null if
 *   there's no keyword
 */
export function searchBody(state, matchIds) {
  return {
    person_ids: state.person_ids,
    location_ids: state.location_ids,
    tag_ids: state.tag_ids,
    tag_match: state.tag_match,
    from: state.from,
    to: state.to,
    match_ids: matchIds,
    page: state.page,
    page_size: state.page_size,
    sort: state.sort,
  };
}

/**
 * Whether anything narrows the list. The sort and page size don't: they're
 * how the list is shown, so Clear search keeps them.
 * @param {SearchState} state
 */
export function hasFilters(state) {
  return state.person_ids.length > 0 || state.location_ids.length > 0 || state.tag_ids.length > 0 ||
    !!state.from || !!state.to || state.q.trim() !== "";
}

/**
 * Page numbers for the page control: the first and last pages, and the
 * current one with its neighbours. null marks a gap ("…").
 * pageList(7, 20) -> [1, null, 6, 7, 8, null, 20]
 * @param {number} current
 * @param {number} totalPages
 * @returns {(number | null)[]}
 */
export function pageList(current, totalPages) {
  if (totalPages <= 1) return [];
  const shown = new Set([1, totalPages, current - 1, current, current + 1]);
  /** @type {(number | null)[]} */
  const result = [];
  for (let n = 1; n <= totalPages; n++) {
    if (!shown.has(n)) continue;
    const last = result[result.length - 1];
    // A gap of exactly one page shows that page instead of "…".
    if (last != null && n - last === 2) result.push(n - 1);
    else if (last != null && n - last > 2) result.push(null);
    result.push(n);
  }
  return result;
}

/**
 * @template {{ name: string }} T
 * @param {T[]} items
 * @returns {T[]} a sorted copy, A–Z ignoring case and accents
 */
export function sortByName(items) {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/**
 * Whether a name matches the text typed into a filter's search box.
 * @param {string} name
 * @param {string} text
 */
export function nameMatches(name, text) {
  const wanted = text.trim().toLocaleLowerCase();
  return wanted === "" || name.toLocaleLowerCase().includes(wanted);
}
