// Converting a format 1 journal to format 2: what the records will be. Pure.
//
// The input is the journal as format 1's store exports it, opened on the
// device (store/v1/data.js's exportJournal: notes and captions in plain
// text), and the saved presets' ids (the export lists presets without
// them). Every item becomes one record, its links folded in as ids; a
// tie's, plan's or workshop's photos, videos, drawings and poses become one
// ordered list of visuals, as format 1 shows them (visual-order.js).
//
// Every id is worked out, not random (records/ids.js, in the crypto
// Worker): from its format 1 table and old id, so a conversion that's run
// again writes the same records and skips the ones already there. Tags,
// which format 1's export lists by name, go by their name ignoring
// capitals; profile notes, which have no ids in it, by their person and
// place. "Me" and the settings record take their fixed ids.
//
// Photos' and videos' entries are planned without their keys: each file
// is sealed under a new key when it's converted, and the key goes into its
// entry then (withFileKeys).

import { compact } from "../records/parse.js";
import { readAliases } from "../aliases.js";
import { tagKey } from "../tags.js";
import { mergeVisuals } from "../visual-order.js";
import { recordProblems } from "../records/schema.js";

/**
 * @typedef {{ table: string, oldId: string }} IdRequest
 * @typedef {{ kind: import("../crypto/records.js").RecordKind, id: string, body: Record<string, any> }} PlannedRecord
 * @typedef {{ mediaId: string, fileId: string, kind: "photo" | "video", mime: string, recordId: string }} PlannedFile
 * @typedef {{ records: PlannedRecord[], files: PlannedFile[], unconverted: number }} Plan
 * @typedef {{ converted: Map<string, string>, self: string, settings: string }} Ids
 *   converted: by `${table}|${oldId}` (idKey)
 */

/**
 * @param {string} table
 * @param {string} oldId
 */
export const idKey = (table, oldId) => `${table}|${oldId}`;

/** @param {any[] | undefined} list */
const each = (list) => (Array.isArray(list) ? list : []);

/**
 * Every id the plan needs worked out, once each.
 * @param {any} doc the opened export
 * @param {string[]} presetIds the saved presets' ids, in the export's order
 * @returns {IdRequest[]}
 */
export function idRequests(doc, presetIds) {
  /** @type {Map<string, IdRequest>} */
  const wanted = new Map();
  /** @param {string} table @param {unknown} oldId */
  const want = (table, oldId) => {
    if (oldId === null || oldId === undefined) return;
    wanted.set(idKey(table, String(oldId)), { table, oldId: String(oldId) });
  };
  for (const p of each(doc.people)) {
    want("people", p.id);
    each(p.profile_notes).forEach((_, i) => want("profile_notes", `${p.id}|${i}`));
  }
  for (const l of each(doc.locations)) want("locations", l.id);
  for (const name of each(doc.tags)) want("tags", tagKey(name));
  for (const item of [...each(doc.plans), ...each(doc.ties), ...each(doc.workshops)]) {
    for (const name of each(item.tags)) want("tags", tagKey(name));
    for (const m of each(item.photos)) want("media", m.id);
    for (const d of each(item.drawings)) want("drawings", d.id);
    for (const q of each(item.poses)) want("poses", q.id);
  }
  for (const p of each(doc.plans)) want("plans", p.id);
  for (const t of each(doc.ties)) want("ties", t.id);
  for (const w of each(doc.workshops)) want("workshops", w.id);
  for (const id of presetIds) want("pose_presets", id);
  return [...wanted.values()];
}

/**
 * What a converted journal holds.
 * @param {any} doc the opened export (store/v1/data.js's exportJournal)
 * @param {string[]} presetIds the saved presets' ids, in the export's order
 * @param {Ids} ids
 * @param {string} now
 * @returns {Plan}
 */
export function planConversion(doc, presetIds, ids, now) {
  const selfOld = each(doc.people).find((p) => p.is_self)?.id;
  /** @param {string} table @param {unknown} oldId */
  const idOf = (table, oldId) => {
    if (oldId === null || oldId === undefined) return null;
    if (table === "people" && oldId === selfOld) return ids.self;
    const id = ids.converted.get(idKey(table, String(oldId)));
    if (!id) throw new Error(`No id worked out for ${table} ${oldId}.`);
    return id;
  };
  // A link to something the file doesn't have (it went before the export)
  // is a deleted link, as format 1 shows it.
  const known = new Set([
    ...each(doc.people).map((p) => `people|${p.id}`), ...each(doc.locations).map((l) => `locations|${l.id}`),
    ...each(doc.plans).map((p) => `plans|${p.id}`), ...each(doc.ties).map((t) => `ties|${t.id}`),
  ]);
  /** @param {string} table @param {unknown} oldId */
  const linkTo = (table, oldId) => (oldId !== null && oldId !== undefined && known.has(`${table}|${oldId}`) ? idOf(table, oldId) : null);
  /** @param {unknown} names */
  const tagIds = (names) => {
    const list = [...new Set(each(/** @type {any} */ (names)).map((n) => idOf("tags", tagKey(n))))];
    return list.length ? list : null;
  };
  const stamps = (/** @type {any} */ x) => ({ created_at: x.created_at ?? now, updated_at: x.updated_at ?? x.created_at ?? now });

  /** @type {PlannedRecord[]} */
  const records = [];
  /** @type {PlannedFile[]} */
  const files = [];
  /** @param {any} item @param {string} recordId the item's new id */
  const visualsOf = (item, recordId) => {
    const merged = mergeVisuals({ media: each(item.photos), drawing: each(item.drawings), pose: each(item.poses) });
    const list = merged.map(({ kind, item: v }) => {
      if (kind === "media") {
        const fileId = /** @type {string} */ (idOf("media", v.id));
        files.push({ mediaId: v.id, fileId, kind: v.kind === "video" ? "video" : "photo", mime: v.mime, recordId });
        return compact({ kind: "file", id: fileId, file_kind: v.kind === "video" ? "video" : "photo", mime: v.mime,
          caption: v.caption ?? null, created_at: v.created_at ?? null });
      }
      const table = kind === "drawing" ? "drawings" : "poses";
      const id = /** @type {string} */ (idOf(table, v.id));
      records.push({ kind, id, body: compact({ data: v.data, caption: v.caption ?? null, ...stamps(v) }) });
      return { kind, id };
    });
    return list.length ? list : null;
  };

  // Which workshop each tie and plan is on (the export lists them on it).
  /** @type {Map<string, string>} */
  const workshopOf = new Map();
  for (const w of each(doc.workshops)) {
    for (const id of each(w.ties)) workshopOf.set(`ties|${id}`, /** @type {string} */ (idOf("workshops", w.id)));
    for (const id of each(w.plans)) workshopOf.set(`plans|${id}`, /** @type {string} */ (idOf("workshops", w.id)));
  }

  const settings = doc.account?.settings ?? {};
  records.push({ kind: "settings", id: ids.settings, body: compact({
    top_label: settings.top_label ?? null, bottom_label: settings.bottom_label ?? null, default_shape: settings.default_shape ?? null,
    created_at: now, updated_at: now,
  }) });

  const presets = each(doc.account?.pose_presets);
  presets.forEach((p, i) => {
    if (!presetIds[i]) return;
    // Saved at the same time as the ones before it: its place among them.
    const order = presets.slice(0, i).filter((q) => q.created_at === p.created_at).length;
    records.push({ kind: "pose_preset", id: /** @type {string} */ (idOf("pose_presets", presetIds[i])), body: compact({
      kind: p.kind, name: p.name ?? null, data: p.data, ...(order ? { order } : {}), ...stamps(p),
    }) });
  });

  /** @type {Set<string>} */
  const tagsMade = new Set();
  for (const name of [...each(doc.tags), ...[...each(doc.plans), ...each(doc.ties), ...each(doc.workshops)].flatMap((x) => each(x.tags))]) {
    const id = /** @type {string} */ (idOf("tags", tagKey(name)));
    if (tagsMade.has(id)) continue;
    tagsMade.add(id);
    records.push({ kind: "tag", id, body: { name, created_at: now, updated_at: now } });
  }

  for (const p of each(doc.people)) {
    records.push({ kind: "person", id: /** @type {string} */ (idOf("people", p.id)), body: compact({
      name: p.name, pronouns: p.pronouns ?? null, notes: p.notes ?? null, is_self: p.is_self ? true : null,
      default_role: p.default_role ?? null, is_educator: !!p.is_educator, based_in: p.based_in ?? null,
      aliases: (() => { const a = readAliases(p.aliases ?? null); return a.length ? a : null; })(),
      about: p.about ?? null, about_shared_on: p.about_shared_on ?? null, archived_at: p.archived_at ?? null,
      profile_notes: (() => {
        const notes = each(p.profile_notes).map((n, i) => compact({
          id: idOf("profile_notes", `${p.id}|${i}`), type: n.type, description: n.description, noted_on: n.noted_on ?? null,
          is_current: n.is_current !== false, created_at: n.created_at ?? null, updated_at: n.updated_at ?? null,
        }));
        return notes.length ? notes : null;
      })(),
      ...stamps(p),
    }) });
  }

  for (const l of each(doc.locations)) {
    records.push({ kind: "location", id: /** @type {string} */ (idOf("locations", l.id)), body: compact({
      name: l.name, notes: l.notes ?? null, maps_url: l.maps_url ?? null, city: l.city ?? null, state_province: l.state_province ?? null,
      country: l.country ?? null, latitude: l.latitude ?? null, longitude: l.longitude ?? null, is_default: !!l.is_default,
      archived_at: l.archived_at ?? null, ...stamps(l),
    }) });
  }

  for (const p of each(doc.plans)) {
    const id = /** @type {string} */ (idOf("plans", p.id));
    records.push({ kind: "plan", id, body: compact({
      title: p.title, stage: p.stage ?? "idea", plan_type: p.plan_type ?? "idea", tie_type: p.tie_type ?? null,
      description: p.description ?? null, notes: p.notes ?? null, album_url: p.album_url ?? null, est_difficulty: p.est_difficulty ?? null,
      variation_of: linkTo("plans", p.variation_of), version: p.version ?? 1, workshop_id: workshopOf.get(`plans|${p.id}`) ?? null,
      archived_at: p.archived_at ?? null, tags: tagIds(p.tags), visuals: visualsOf(p, id), ...stamps(p),
    }) });
  }

  for (const t of each(doc.ties)) {
    const id = /** @type {string} */ (idOf("ties", t.id));
    const location = linkTo("locations", t.location_id);
    const participants = each(t.participants).map((x) => compact({
      person_id: linkTo("people", x.person_id), role: x.role, difficulty_rating: x.difficulty_rating ?? null,
      experience_rating: x.experience_rating ?? null, notes: x.notes ?? null,
    }));
    const plans = each(t.plans).map((x) => ({ plan_id: linkTo("plans", x.plan_id), plan_version: x.plan_version ?? 1 }));
    records.push({ kind: "tie", id, body: compact({
      title: t.title ?? null, tie_date: t.tie_date, tie_type: t.tie_type, duration_minutes: t.duration_minutes ?? null,
      success_rating: t.success_rating ?? null, notes: t.notes ?? null, album_url: t.album_url ?? null,
      location_id: location, location_deleted: !location && (t.location_deleted || !!t.location_id) ? true : null,
      workshop_id: workshopOf.get(`ties|${t.id}`) ?? null,
      participants: participants.length ? participants : null, plans: plans.length ? plans : null,
      tags: tagIds(t.tags), visuals: visualsOf(t, id), ...stamps(t),
    }) });
  }

  for (const w of each(doc.workshops)) {
    const id = /** @type {string} */ (idOf("workshops", w.id));
    const location = linkTo("locations", w.location_id);
    const people = [
      ...each(w.educators).map((x) => ({ person_id: linkTo("people", x.person_id), kind: "educator", role: x.role })),
      ...each(w.participants).map((x) => ({ person_id: linkTo("people", x.person_id), kind: "participant", role: x.role })),
    ];
    records.push({ kind: "workshop", id, body: compact({
      title: w.title, start_date: w.start_date, end_date: w.end_date ?? null, location_id: location,
      location_deleted: !location && (w.location_deleted || !!w.location_id) ? true : null,
      attendee_count: w.attendee_count ?? null, rating: w.rating ?? null, difficulty: w.difficulty ?? null,
      rating_content: w.rating_content ?? null, rating_teaching: w.rating_teaching ?? null, rating_value: w.rating_value ?? null,
      cost: w.cost ?? null, event_url: w.event_url ?? null, description: w.description ?? null, notes: w.notes ?? null,
      album_url: w.album_url ?? null, people: people.length ? people : null, tags: tagIds(w.tags), visuals: visualsOf(w, id), ...stamps(w),
    }) });
  }

  let unconverted = 0;
  for (const record of records) {
    if (keepWithinRules(record)) unconverted++;
  }
  return { records, files, unconverted };
}

/**
 * Keeps a record within its kind's rules (records/schema.js): a field that
 * breaks one (which format 1's server would have refused, so only from
 * long ago or an edited import) is moved, as it is, into the record's
 * `unconverted`, not lost. Visual entries are checked once their keys are
 * in (withFileKeys).
 * @param {PlannedRecord} record
 * @returns {boolean} whether anything was moved
 */
export function keepWithinRules(record) {
  let moved = false;
  for (let round = 0; round < 50; round++) {
    const problems = recordProblems(record.kind, withoutFileChecks(record.body), { id: record.id });
    if (!problems.length) return moved;
    const field = problems[0].split(/[ .[]/)[0];
    if (!(field in record.body) || problems[0].endsWith("is needed")) {
      throw new Error(`Can't convert a ${record.kind}: ${problems[0]}.`);
    }
    const { [field]: value, ...rest } = record.body;
    record.body = { ...rest, unconverted: { ...(record.body.unconverted ?? {}), [field]: value } };
    moved = true;
  }
  throw new Error(`Can't convert a ${record.kind}.`);
}

/**
 * A body with its file entries given a stand-in key, for checking before
 * the real keys are in.
 * @param {Record<string, any>} body
 */
function withoutFileChecks(body) {
  if (!Array.isArray(body.visuals)) return body;
  return { ...body, visuals: body.visuals.map((v) => (v.kind === "file" && !v.key ? { ...v, key: "k".repeat(43) } : v)) };
}

/**
 * The planned records with each file's key (and size, for the Share
 * dialog's estimate) in its entry.
 * @param {PlannedRecord[]} records
 * @param {Map<string, { key: string, bytes?: number }>} keys by file id
 * @returns {PlannedRecord[]}
 */
export function withFileKeys(records, keys) {
  return records.map((r) => {
    if (!Array.isArray(r.body.visuals) || !r.body.visuals.some((v) => v.kind === "file")) return r;
    return { ...r, body: { ...r.body, visuals: r.body.visuals.map((/** @type {any} */ v) => {
      if (v.kind !== "file") return v;
      const file = keys.get(v.id);
      if (!file) throw new Error("A photo or video wasn't converted.");
      return { ...v, key: file.key, ...(typeof file.bytes === "number" ? { bytes: file.bytes } : {}) };
    }) } };
  });
}
