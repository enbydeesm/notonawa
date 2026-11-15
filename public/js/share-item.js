// A shared tie, plan or workshop: what's taken from mine to share, and
// reading one someone else shared. Pure, so it's easy to test. See
// considerations.md, "Sharing between accounts": "What can be shared".
//
// Every field but the ones an item can't do without is the sender's
// choice. People go as names and roles only, never their cards or account
// ids; the sender's own name is the one they type, and marked `sender`, so
// the recipient's page can suggest the card linked to them. Drawings and
// poses go as their lines and numbers, captions included; photos and
// videos as a random file id each (the file itself is sealed and uploaded
// beside the snapshot), their type and caption. All in the order they
// have among the item's visuals, whichever of the two groups is ticked.
//
// A shared item comes from another account, so it's read strictly, like a
// shared profile (profile-share.js): only these fields, each the right type
// and no longer than it could be here. Drawings' and poses' own numbers
// are checked by the server when they're saved, as an import's are.

import { ROLES, WORKSHOP_ROLES, TIE_TYPES } from "./ties-view.js";
import { PLAN_TYPE_NAMES } from "./plans-view.js";
import { MAX_TAGS, MAX_TAG_LENGTH, tagKey } from "./tags.js";
import { isWebLink } from "./links.js";
import { readCost } from "./currency.js";
import { MAX_DRAWINGS } from "./drawing-format.js";
import { MAX_POSES } from "./pose-format.js";
import { MAX_CAPTION } from "./crypto/media.js";

export const ITEM_VERSION = 1;

/** The kinds of item that can be shared this way (a profile is profile-share.js). */
export const ITEM_KINDS = /** @type {const} */ (["tie", "plan", "workshop"]);

/** The longest each shared field can be, in characters, and the longest lists. */
export const LIMITS = /** @type {const} */ ({
  title: 200, name: 200, place: 200, notes: 20_000, album_url: 2000, caption: 2000, people: 40, plans: 20,
});

const MAX_ATTENDEES = 100_000; // as in the workshop form
const MAX_MINUTES = 1440;
// Photos and videos an item can have, of them videos (src/media/parse.js),
// and the types each is stored as.
const MAX_MEDIA = 30;
const MAX_VIDEOS = 5;
const MEDIA_MIMES = { photo: ["image/jpeg", "image/webp"], video: ["video/mp4"] };
// A file's id: made with crypto.randomUUID(), as the server checks.
const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** @typedef {typeof ITEM_KINDS[number]} ItemKind */

/**
 * A field the sender can tick, as the Share dialog lists it.
 * @typedef {{ key: string, label: string }} ShareField
 */

/** What each kind's Share dialog offers to tick, in the form's order. */
export const FIELDS = /** @type {Record<ItemKind, ShareField[]>} */ ({
  tie: [
    { key: "title", label: "Title" },
    { key: "duration_minutes", label: "Mins" },
    { key: "location", label: "Location" },
    { key: "plans", label: "Plans" },
    { key: "people", label: "People and their roles" },
    { key: "success_rating", label: "How did it go?" },
    { key: "notes", label: "Notes" },
    { key: "album_url", label: "Album link" },
    { key: "visuals", label: "Drawings and poses" },
    { key: "media", label: "Photos and videos" },
    { key: "tags", label: "Tags" },
  ],
  plan: [
    { key: "plan_type", label: "Plan type" },
    { key: "tie_type", label: "Tie type" },
    { key: "est_difficulty", label: "Difficulty" },
    { key: "description", label: "Description" },
    { key: "notes", label: "Notes" },
    { key: "album_url", label: "Album link" },
    { key: "visuals", label: "Drawings and poses" },
    { key: "media", label: "Photos and videos" },
    { key: "tags", label: "Tags" },
  ],
  workshop: [
    { key: "location", label: "Location" },
    { key: "attendee_count", label: "Size (how many attended)" },
    { key: "rating", label: "Rating" },
    { key: "people", label: "Educators and people, with their roles" },
    { key: "event_url", label: "Event link" },
    // Paid or earned: it reads as the other person's own once added (Paid,
    // unless they're one of its educators).
    { key: "cost", label: "Cost" },
    { key: "description", label: "Description" },
    { key: "notes", label: "Notes" },
    { key: "album_url", label: "Album link" },
    { key: "visuals", label: "Drawings and poses" },
    { key: "media", label: "Photos and videos" },
    { key: "tags", label: "Tags" },
  ],
});

/** What every share of a kind has, as the dialog says it. */
export const ALWAYS_SHARED = /** @type {Record<ItemKind, string>} */ ({
  tie: "Its date and type are always shared.",
  plan: "Its title is always shared.",
  workshop: "Its title and dates are always shared.",
});

// The heading over the tickboxes, saying what's always shared with them.
export const SHARE_LEGEND = /** @type {Record<ItemKind, string>} */ ({
  tie: "Share date and type and…",
  plan: "Share title and…",
  workshop: "Share title and dates and…",
});

// The fields every share of a kind has, ticked or not.
const ALWAYS = /** @type {Record<ItemKind, string[]>} */ ({
  tie: ["tie_date", "tie_type"], plan: ["title"], workshop: ["title", "start_date", "end_date"],
});

/**
 * A person on a shared item: their name, role and (on a workshop) whether
 * they were an educator or a participant. sender: the person who shared it.
 * @typedef {{ name: string, role: string, kind?: "educator" | "participant", sender?: true }} SharedPerson
 */

/**
 * A drawing or pose: its lines or numbers, and caption.
 * @typedef {{ kind: "drawing" | "pose", data: Record<string, unknown>, caption: string | null }} SharedDrawing
 */

/**
 * A photo or video: its file's id in the share, its type and caption. On
 * the sender's side (before sharing) it also has mediaId and bytes, its id
 * and size in my journal, which never go in the snapshot.
 * @typedef {{
 *   kind: "photo" | "video", file: string, mime: string, caption: string | null, mediaId?: string, bytes?: number,
 * }} SharedMedia
 */

/** @typedef {SharedDrawing | SharedMedia} SharedVisual */

/**
 * Whether a visual is a photo or video.
 * @param {SharedVisual} visual
 * @returns {visual is SharedMedia}
 */
export const isMedia = (visual) => visual.kind === "photo" || visual.kind === "video";

/**
 * @typedef {{ name: string, city: string | null, state_province: string | null, country: string | null }} SharedPlace
 */

/**
 * A shared item, read (or about to be shared): every field there, the rest
 * null or empty. Which fields a kind has is in FIELDS and ALWAYS.
 * @typedef {{
 *   title: string | null, tie_date: string | null, tie_type: string | null, duration_minutes: number | null,
 *   success_rating: number | null, plan_type: string | null, est_difficulty: number | null,
 *   start_date: string | null, end_date: string | null, attendee_count: number | null, rating: number | null,
 *   location: SharedPlace | null, plans: string[], people: SharedPerson[], tags: string[],
 *   description: string | null, notes: string | null, album_url: string | null, visuals: SharedVisual[],
 *   event_url: string | null, cost: string | null,
 * }} SharedItem
 */

/** @returns {SharedItem} */
function emptyItem() {
  return {
    title: null, tie_date: null, tie_type: null, duration_minutes: null, success_rating: null, plan_type: null,
    est_difficulty: null, start_date: null, end_date: null, attendee_count: null, rating: null, location: null,
    plans: [], people: [], tags: [], description: null, notes: null, album_url: null, visuals: [],
    event_url: null, cost: null,
  };
}

/**
 * What a tie, plan or workshop of mine has to share, from the item as its
 * form has it (opened), before anything is ticked. People and plans that
 * were deleted are left out. My own profile goes under the name I typed,
 * marked as the sender.
 * @param {ItemKind} kind
 * @param {Record<string, any>} item
 * @param {{
 *   selfId: string | null, myName: string, location: Record<string, any> | null, visuals: SharedVisual[],
 * }} extras my profile's id and the name to share it under, the item's location (with its place) and its visuals
 * @returns {SharedItem}
 */
export function itemSource(kind, item, { selfId, myName, location, visuals }) {
  /**
   * @param {any[] | undefined} list
   * @param {"educator" | "participant"} [personKind]
   * @returns {SharedPerson[]}
   */
  const people = (list, personKind) => (list ?? []).filter((p) => p.person_id).map((p) => {
    const me = selfId !== null && p.person_id === selfId;
    return {
      name: me ? myName.trim() : p.person_name, role: p.role,
      ...(personKind ? { kind: personKind } : {}), ...(me ? { sender: /** @type {const} */ (true) } : {}),
    };
  });
  const source = emptyItem();
  for (const key of /** @type {(keyof SharedItem)[]} */ (Object.keys(source))) {
    if (typeof item[key] === "string" || typeof item[key] === "number") /** @type {any} */ (source)[key] = item[key];
  }
  source.location = location ? {
    name: location.name, city: location.city ?? null, state_province: location.state_province ?? null, country: location.country ?? null,
  } : null;
  source.tags = [...(item.tags ?? [])];
  source.visuals = visuals;
  if (kind === "tie") {
    source.people = people(item.participants);
    source.plans = (item.plans ?? []).filter((/** @type {any} */ p) => p.plan_id).map((/** @type {any} */ p) => p.plan_title);
  } else if (kind === "workshop") {
    source.people = [...people(item.educators, "educator"), ...people(item.participants, "participant")];
  }
  return source;
}

/**
 * Whether a field has anything in it to share.
 * @param {SharedItem} source
 * @param {string} key
 */
export function hasField(source, key) {
  if (key === "visuals") return source.visuals.some((v) => !isMedia(v));
  if (key === "media") return source.visuals.some(isMedia);
  const value = /** @type {Record<string, unknown>} */ (source)[key];
  return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== "";
}

/**
 * The snapshot to share: the fields ticked (and the ones always shared)
 * that have something in them.
 * @param {ItemKind} kind
 * @param {SharedItem} source
 * @param {Iterable<string>} ticked the keys of FIELDS[kind] ticked
 * @returns {Record<string, unknown>}
 */
export function buildItemShare(kind, source, ticked) {
  const offered = new Set(FIELDS[kind].map((f) => f.key));
  const keys = [...ALWAYS[kind], ...[...ticked].filter((k) => offered.has(k))];
  /** @type {Record<string, unknown>} */
  const snapshot = { v: ITEM_VERSION };
  for (const key of keys) {
    if (key !== "visuals" && key !== "media" && hasField(source, key)) snapshot[key] = /** @type {Record<string, unknown>} */ (source)[key];
  }
  // Drawings and poses, photos and videos: each ticked separately, in one order.
  const visuals = source.visuals
    .filter((v) => keys.includes(isMedia(v) ? "media" : "visuals"))
    .map((v) => (isMedia(v) ? { kind: v.kind, file: v.file, mime: v.mime, caption: v.caption } : v));
  if (visuals.length) snapshot.visuals = visuals;
  if (kind === "tie" && !snapshot.tie_date) throw new Error("This tie has no date.");
  if (kind !== "tie" && !snapshot.title) throw new Error("Add a title before sharing it.");
  if (snapshot.people && (/** @type {SharedPerson[]} */ (snapshot.people)).some((p) => p.sender && !p.name)) {
    throw new Error("Type the name to show for you.");
  }
  return snapshot;
}

/**
 * How many of each kind of visual, in words: "2 photos, 1 video".
 * @param {SharedVisual[]} visuals
 * @param {SharedVisual["kind"][]} kinds which to count, in this order
 * @returns {string}
 */
export function visualCounts(visuals, kinds) {
  return kinds.map((k) => [visuals.filter((v) => v.kind === k).length, k]).filter(([n]) => n)
    .map(([n, word]) => `${n} ${word}${n === 1 ? "" : "s"}`).join(", ");
}

/**
 * The photos and videos a snapshot has, to seal and upload beside it: each
 * file's id in the share, and which of mine it is.
 * @param {SharedItem} source as given to buildItemShare
 * @param {Record<string, unknown>} snapshot what buildItemShare made
 * @returns {{ file: string, mediaId: string, kind: "photo" | "video" }[]}
 */
export function shareFiles(source, snapshot) {
  const files = new Set(((/** @type {SharedVisual[] | undefined} */ (snapshot.visuals)) ?? []).filter(isMedia).map((v) => v.file));
  return source.visuals.filter(isMedia).filter((v) => files.has(v.file) && v.mediaId)
    .map((v) => ({ file: v.file, mediaId: /** @type {string} */ (v.mediaId), kind: v.kind }));
}

/**
 * @param {unknown} value
 * @param {number} max
 * @returns {string | null} trimmed, or null if it isn't text, is empty or is too long
 */
function text(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @returns {number | null}
 */
function whole(value, min, max) {
  return Number.isInteger(value) && /** @type {number} */ (value) >= min && /** @type {number} */ (value) <= max
    ? /** @type {number} */ (value) : null;
}

/**
 * @param {unknown} value
 * @returns {string | null} a real YYYY-MM-DD date, or null
 */
function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value) ? value : null;
}

/**
 * @param {unknown} value
 * @param {readonly string[]} choices
 * @returns {string | null}
 */
function choice(value, choices) {
  return typeof value === "string" && choices.includes(value) ? value : null;
}

/**
 * Names, each once ignoring capitals, at most max of them.
 * @param {unknown} value
 * @param {number} maxLength
 * @param {number} max
 * @returns {string[]}
 */
function names(value, maxLength, max) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const item of value) {
    const name = text(item, maxLength);
    if (!name || seen.has(tagKey(name))) continue;
    seen.add(tagKey(name));
    out.push(name);
    if (out.length === max) break;
  }
  return out;
}

/**
 * @param {unknown} value
 * @returns {SharedPlace | null}
 */
function readPlace(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const l = /** @type {Record<string, unknown>} */ (value);
  const name = text(l.name, LIMITS.name);
  if (!name) return null;
  return {
    name, city: text(l.city, LIMITS.place), state_province: text(l.state_province, LIMITS.place), country: text(l.country, LIMITS.place),
  };
}

/**
 * @param {unknown} value
 * @param {ItemKind} kind
 * @returns {SharedPerson[]}
 */
function readPeople(value, kind) {
  if (!Array.isArray(value)) return [];
  /** @type {SharedPerson[]} */
  const out = [];
  for (const item of value.slice(0, LIMITS.people)) {
    if (!item || typeof item !== "object") continue;
    const name = text(item.name, LIMITS.name);
    // Audit is a workshop's only.
    const role = choice(item.role, kind === "workshop" ? WORKSHOP_ROLES : ROLES);
    if (!name || !role) continue;
    /** @type {SharedPerson} */
    const person = { name, role };
    if (kind === "workshop") person.kind = item.kind === "educator" ? "educator" : "participant";
    if (item.sender === true) person.sender = true;
    out.push(person);
  }
  return out;
}

/**
 * Drawings and poses with something in them, and photos and videos with a
 * file id and a type they can be stored as, at most as many of each as an
 * item can have.
 * @param {unknown} value
 * @returns {SharedVisual[]}
 */
function readVisuals(value) {
  if (!Array.isArray(value)) return [];
  const counts = { drawing: 0, pose: 0, media: 0, video: 0 };
  const most = { drawing: MAX_DRAWINGS, pose: MAX_POSES };
  const files = new Set();
  /** @type {SharedVisual[]} */
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    if (item.kind === "photo" || item.kind === "video") {
      const mediaKind = /** @type {"photo" | "video"} */ (item.kind);
      const ok = typeof item.file === "string" && FILE_ID.test(item.file) && !files.has(item.file)
        && MEDIA_MIMES[mediaKind].includes(item.mime) && counts.media < MAX_MEDIA
        && (mediaKind === "photo" || counts.video < MAX_VIDEOS);
      if (!ok) continue;
      files.add(item.file);
      counts.media++;
      if (mediaKind === "video") counts.video++;
      out.push({ kind: mediaKind, file: item.file, mime: item.mime, caption: text(item.caption, MAX_CAPTION) });
      continue;
    }
    const kind = item.kind === "drawing" || item.kind === "pose" ? /** @type {"drawing" | "pose"} */ (item.kind) : null;
    const data = item.data;
    if (!kind || !data || typeof data !== "object" || Array.isArray(data) || counts[kind] >= most[kind]) continue;
    if (kind === "drawing" && !Array.isArray(data.strokes)) continue;
    counts[kind]++;
    out.push({ kind, data, caption: text(item.caption, LIMITS.caption) });
  }
  return out;
}

/**
 * A tie, plan or workshop someone shared, or null if it isn't one (or
 * lacks what the kind can't do without). Unknown fields are dropped, and a
 * field that's the wrong type or too long is left out.
 * @param {ItemKind} kind
 * @param {unknown} data
 * @returns {SharedItem | null}
 */
export function readItemShare(kind, data) {
  if (!ITEM_KINDS.includes(kind) || !data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = /** @type {Record<string, unknown>} */ (data);
  if (d.v !== ITEM_VERSION) return null;
  const item = emptyItem();
  item.title = text(d.title, LIMITS.title);
  item.tags = names(d.tags, MAX_TAG_LENGTH, MAX_TAGS);
  item.description = kind === "tie" ? null : text(d.description, LIMITS.notes);
  item.notes = text(d.notes, LIMITS.notes);
  item.album_url = isWebLink(typeof d.album_url === "string" ? d.album_url.trim() : null) ? /** @type {string} */ (d.album_url).trim() : null;
  item.visuals = readVisuals(d.visuals);
  if (kind === "tie") {
    item.tie_date = date(d.tie_date);
    item.tie_type = choice(d.tie_type, TIE_TYPES);
    if (!item.tie_date || !item.tie_type) return null;
    item.duration_minutes = whole(d.duration_minutes, 0, MAX_MINUTES);
    item.success_rating = whole(d.success_rating, 1, 5);
    item.location = readPlace(d.location);
    item.plans = names(d.plans, LIMITS.title, LIMITS.plans);
    item.people = readPeople(d.people, kind);
  } else if (kind === "plan") {
    if (!item.title) return null;
    item.plan_type = choice(d.plan_type, Object.keys(PLAN_TYPE_NAMES));
    item.tie_type = choice(d.tie_type, TIE_TYPES);
    item.est_difficulty = whole(d.est_difficulty, 1, 5);
  } else {
    item.start_date = date(d.start_date);
    if (!item.title || !item.start_date) return null;
    const end = date(d.end_date);
    item.end_date = end && end > item.start_date ? end : null;
    item.attendee_count = whole(d.attendee_count, 0, MAX_ATTENDEES);
    item.event_url = isWebLink(typeof d.event_url === "string" ? d.event_url.trim() : null) ? /** @type {string} */ (d.event_url).trim() : null;
    // As my own costs are written ("USD 180.00"), read back the same way.
    const cost = readCost(typeof d.cost === "string" ? d.cost : null);
    item.cost = cost ? `${cost.currency} ${cost.amount}` : null;
    item.rating = whole(d.rating, 1, 5);
    item.location = readPlace(d.location);
    item.people = readPeople(d.people, kind);
  }
  return item;
}
