// An item's visuals in format 2: a tie's, plan's or workshop's record lists
// them, in order, as { kind: "file" | "drawing" | "pose", id }; a file's
// entry holds its key, its kind (photo or video), its type and caption,
// while a drawing or pose is a record of its own (its lines or numbers and
// caption). Adding, captioning, removing and ordering them, and the rows
// format 1's media, drawings and poses routes gave. Pure.

import { BadEdit } from "./parse.js";

/** @typedef {import("./edits.js").Entry} Entry */
/** @typedef {import("./edits.js").Write} Write */
/** @typedef {{ tie_id: string } | { plan_id: string } | { workshop_id: string }} Item */
/** @typedef {{ kind: "file" | "drawing" | "pose", id: string, [field: string]: any }} Visual */

export const MAX_CAPTION = 1000;

/**
 * Which record an item is: { tie_id } and so on.
 * @param {Item} item
 * @returns {{ kind: "tie" | "plan" | "workshop", id: string }}
 */
export function itemRef(item) {
  if ("tie_id" in item) return { kind: "tie", id: item.tie_id };
  if ("plan_id" in item) return { kind: "plan", id: item.plan_id };
  if ("workshop_id" in item) return { kind: "workshop", id: item.workshop_id };
  throw new BadEdit("Say which tie, plan or workshop.");
}

/** @param {Record<string, any> | null | undefined} body @returns {Visual[]} */
export const visualsOf = (body) => (Array.isArray(body?.visuals) ? body.visuals : []);

/**
 * A caption as saved: trimmed, empty as none, at most MAX_CAPTION.
 * @param {unknown} value
 * @returns {string | null}
 */
export function captionOf(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (text.length > MAX_CAPTION) throw new BadEdit(`Keep the caption to ${MAX_CAPTION} characters.`);
  return text === "" ? null : text;
}

/**
 * The item with its visuals changed.
 * @param {Entry} item
 * @param {Visual[]} visuals
 * @param {string} now
 * @returns {Write}
 */
export function withVisuals(item, visuals, now) {
  const body = /** @type {Record<string, any>} */ (item.body);
  const { visuals: _old, cover, ...rest } = body;
  /** @type {Record<string, any>} */
  const next = { ...rest, ...(visuals.length ? { visuals } : {}), updated_at: now };
  // A cover that's gone stops being one.
  if (cover && visuals.some((v) => v.id === cover)) next.cover = cover;
  return { kind: /** @type {any} */ (item.kind), id: item.id, from: body, body: next };
}

/**
 * The item with one more visual, last.
 * @param {Entry} item
 * @param {Visual} visual
 * @param {string} now
 */
export function visualAdded(item, visual, now) {
  return withVisuals(item, [...visualsOf(item.body), visual], now);
}

/**
 * The item without one of its visuals.
 * @param {Entry} item
 * @param {string} id
 * @param {string} now
 */
export function visualRemoved(item, id, now) {
  return withVisuals(item, visualsOf(item.body).filter((v) => v.id !== id), now);
}

/**
 * The item with a file's caption changed (null clears it).
 * @param {Entry} item
 * @param {string} fileId
 * @param {string | null} caption
 * @param {string} now
 */
export function fileCaptioned(item, fileId, caption, now) {
  return withVisuals(item, visualsOf(item.body).map((v) => {
    if (v.id !== fileId) return v;
    const { caption: _old, ...rest } = v;
    return caption === null ? rest : { ...rest, caption };
  }), now);
}

/** Format 1's order kinds: a photo or video is "media". */
const ORDER_KIND = /** @type {const} */ ({ file: "media", drawing: "drawing", pose: "pose" });

/**
 * The item's visuals in a new order: every one listed, once, or it's refused.
 * @param {Entry} item
 * @param {{ kind: "media" | "drawing" | "pose", id: string }[]} order
 * @param {string} now
 */
export function visualsOrdered(item, order, now) {
  const visuals = visualsOf(item.body);
  const byKey = new Map(visuals.map((v) => [`${ORDER_KIND[v.kind]}|${v.id}`, v]));
  const keys = order.map((o) => `${o.kind}|${o.id}`);
  if (new Set(keys).size !== keys.length || keys.length !== visuals.length || keys.some((k) => !byKey.has(k))) {
    throw new BadEdit("The visuals changed meanwhile. Close it and open it again.");
  }
  return withVisuals(item, keys.map((k) => /** @type {Visual} */ (byKey.get(k))), now);
}

/**
 * An item's photos and videos, as format 1's GET /api/media gave them:
 * position is the place among all its visuals.
 * @param {Entry} item
 * @returns {{ id: string, kind: "photo" | "video", mime: string, caption: string | null, position: number, created_at: string,
 *   unreadable?: string[] }[]}
 */
export function mediaRows(item) {
  return visualsOf(item.body).flatMap((v, position) => (v.kind !== "file" ? [] : [{
    id: v.id, kind: /** @type {"photo" | "video"} */ (v.file_kind), mime: v.mime ?? (v.file_kind === "video" ? "video/mp4" : "image/jpeg"),
    caption: v.caption ?? null, position, created_at: v.created_at ?? "",
  }]));
}

/**
 * An item's drawings or poses, as format 1's GET /api/drawings|poses gave
 * them. One whose record isn't here (not synced yet) is left out.
 * @param {Entry} item
 * @param {"drawing" | "pose"} kind
 * @param {(id: string) => Entry | null} recordOf
 * @returns {{ id: string, data: any, caption: string | null, position: number, created_at: string, unreadable?: string[] }[]}
 */
export function drawnRows(item, kind, recordOf) {
  return visualsOf(item.body).flatMap((v, position) => {
    if (v.kind !== kind) return [];
    const drawn = recordOf(v.id);
    if (!drawn?.body || drawn.kind !== kind) return [];
    return [{ id: v.id, data: drawn.body.data, caption: drawn.body.caption ?? null, position, created_at: drawn.body.created_at ?? "" }];
  });
}

/**
 * The item a visual is on, and its entry.
 * @param {Entry[]} items every tie, plan and workshop
 * @param {string} id the visual's
 * @returns {{ item: Entry, visual: Visual } | null}
 */
export function findVisual(items, id) {
  for (const item of items) {
    const visual = visualsOf(item.body).find((v) => v.id === id);
    if (visual) return { item, visual };
  }
  return null;
}
