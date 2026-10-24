// An item's visuals as one list: its photos and videos, drawings and poses,
// in the order they share (src/visuals/), and reading a swipe in their
// viewers. Pure, so it's easy to test.

/** @typedef {"media" | "drawing" | "pose"} VisualKind */
/** The kinds in the order that settles a tie (items from before they shared an order). @type {readonly VisualKind[]} */
export const KIND_ORDER = Object.freeze(["media", "drawing", "pose"]);

/**
 * Merges each kind's list (as the server lists them, with positions) into
 * one, first to last. Positions that tie (each kind used to count from 0)
 * go photos, drawings, then poses, then oldest first.
 * @template {{ position?: number, created_at?: string }} T
 * @param {Record<VisualKind, T[]>} lists
 * @returns {{ kind: VisualKind, item: T }[]}
 */
export function mergeVisuals(lists) {
  const all = KIND_ORDER.flatMap((kind) => lists[kind].map((item, i) => ({ kind, item, i })));
  all.sort((a, b) => (a.item.position ?? 0) - (b.item.position ?? 0)
    || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    || (a.item.created_at ?? "").localeCompare(b.item.created_at ?? "")
    || a.i - b.i);
  return all.map(({ kind, item }) => ({ kind, item }));
}

/**
 * The order to save, for PUT /api/visuals/order.
 * @param {{ kind: VisualKind, id: string }[]} visuals
 */
export const orderBody = (visuals) => visuals.map(({ kind, id }) => ({ kind, id }));

/** How far a finger must move sideways (CSS px) to be a swipe. */
export const SWIPE_DISTANCE = 50;
/** How long a swipe can take (ms): longer is a slow drag, not a swipe. */
export const SWIPE_TIME = 800;

/**
 * Which way a finger's movement goes through the visuals: swiping left
 * shows the next (1), right the one before (-1), anything else neither (0).
 * Mostly sideways, far enough and quick enough.
 * @param {number} dx CSS px, right positive
 * @param {number} dy CSS px, down positive
 * @param {number} ms
 * @returns {-1 | 0 | 1}
 */
export function swipeStep(dx, dy, ms) {
  if (ms > SWIPE_TIME || Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}
