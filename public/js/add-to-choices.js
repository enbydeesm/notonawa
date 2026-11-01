// What the poser's "Add pose to…" sheet lists (add-to-picker.js): ties,
// plans and workshops in one list, searched together by title. The one
// chosen last comes first, then the rest most recently changed first; with
// a search, only the ones whose titles have every word typed. And whether
// to offer making a new one called what was typed (when nothing has
// exactly that title). Pure: no DOM, no requests.

/** @typedef {"tie" | "plan" | "workshop"} TargetKind */
/** @typedef {{ tie_id: string } | { plan_id: string } | { workshop_id: string }} Item */
/**
 * A tie, plan or workshop to add to. recent: when it last changed (ISO
 * text; "" if not known), for the order.
 * @typedef {{ kind: TargetKind, id: string, title: string, meta: string, recent: string }} Target
 */
/** @typedef {TargetKind | "all"} Filter */

/** The kinds in the order they're shown, with their words. */
export const TARGET_KINDS = /** @type {const} */ ([
  ["tie", "Tie", "Ties"],
  ["plan", "Plan", "Plans"],
  ["workshop", "Workshop", "Workshops"],
]);

/** How many are listed at most. */
export const SHOWN = 20;

/**
 * The item a target is, as the API names it.
 * @param {{ kind: TargetKind, id: string }} target
 * @returns {Item}
 */
export function itemOf({ kind, id }) {
  if (kind === "tie") return { tie_id: id };
  if (kind === "plan") return { plan_id: id };
  return { workshop_id: id };
}

/** @param {string} kind @returns {string} "Tie", "Plan" or "Workshop" */
export function kindName(kind) {
  return TARGET_KINDS.find(([k]) => k === kind)?.[1] ?? kind;
}

/** @param {string} text */
const words = (text) => text.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Whether a title has every word of the search in it (anywhere, any case).
 * @param {string} title
 * @param {string} query
 */
export function titleMatches(title, query) {
  const have = title.toLowerCase();
  return words(query).every((w) => have.includes(w));
}

/**
 * The list to show.
 * @param {{
 *   targets: Target[], query: string, filter: Filter,
 *   last: { kind: TargetKind, id: string } | null, max?: number,
 * }} options
 *   targets: what's loaded (ties may already be only the ones the search
 *   found, so a tie's title isn't checked again if matched says so);
 *   last: the one chosen last time, shown first when it's in the list
 * @param {Set<string>} [matchedTies] ids of ties the device's search found
 *   for the query (their titles may not have the words: notes are searched too)
 * @returns {Target[]}
 */
export function listChoices({ targets, query, filter, last, max = SHOWN }, matchedTies) {
  const q = query.trim();
  const kept = targets.filter((t) => (filter === "all" || t.kind === filter)
    && (!q || titleMatches(t.title, q) || (t.kind === "tie" && !!matchedTies?.has(t.id))));
  const isLast = (/** @type {Target} */ t) => !!last && t.kind === last.kind && t.id === last.id;
  return kept
    .map((t, i) => ({ t, i }))
    .sort((a, b) => Number(isLast(b.t)) - Number(isLast(a.t))
      || (b.t.recent > a.t.recent ? 1 : b.t.recent < a.t.recent ? -1 : 0)
      || a.i - b.i)
    .slice(0, max)
    .map(({ t }) => t);
}

/**
 * Whether to offer making a new one called what was typed: something's
 * typed, and nothing loaded already has that title (any case, spaces
 * trimmed), of the kinds shown.
 * @param {Target[]} targets
 * @param {string} query
 * @param {Filter} filter
 */
export function offerNew(targets, query, filter) {
  const name = query.trim().toLowerCase();
  if (!name) return false;
  return !targets.some((t) => (filter === "all" || t.kind === filter) && t.title.trim().toLowerCase() === name);
}

/**
 * The kinds to offer making a new one of: all three, or the one filtered to.
 * @param {Filter} filter
 * @returns {TargetKind[]}
 */
export function newKinds(filter) {
  return filter === "all" ? TARGET_KINDS.map(([k]) => k) : [filter];
}

/**
 * What a new tie, plan or workshop made from the poser says while it isn't
 * saved: the bar at the top of its form, and the question before closing it.
 * @param {TargetKind} kind
 * @param {"pose" | "picture"} what
 * @returns {{ bar: string, discard: { title: string, message: string, label: string } }}
 */
export function newEntryText(kind, what) {
  const noun = kindName(kind).toLowerCase();
  const thing = what === "pose" ? "pose" : "picture of the pose";
  return {
    bar: `Not saved yet. Save this ${noun} to keep the ${thing}.`,
    discard: {
      title: `Discard this new ${noun}?`,
      message: `The ${thing} is only on this form until you save it.`,
      label: `Discard ${noun}`,
    },
  };
}
