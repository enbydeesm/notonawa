// The export file's journal (format 2), built from the records in memory in
// the same shape as format 1's (src/data/shape.js), so a file from either
// format imports into either. The account part (passkeys, notices,
// feedback, shares) still comes from the server's export. Pure.

import { nocase } from "./resources.js";
import { visualsOf } from "../../records/visuals.js";

/** @typedef {import("./resources.js").Entry} Entry */

/**
 * Where a photo or video goes inside the export's zip (src/data/shape.js's photoFile).
 * @param {string} id
 * @param {string} mime
 */
export function photoFile(id, mime) {
  return `photos/${id}.${mime === "image/webp" ? "webp" : mime === "video/mp4" ? "mp4" : "jpg"}`;
}

/**
 * @param {Entry[]} list
 * @param {(e: Entry) => string[]} key
 */
function sorted(list, key) {
  return [...list].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  });
}

/**
 * @param {Record<string, Entry[]>} records each kind's readable records
 * @returns {{ settings: Record<string, any>, pose_presets: any[], people: any[], locations: any[], plans: any[], tags: string[],
 *   ties: any[], workshops: any[] }}
 */
export function journalExport(records) {
  const byId = new Map(Object.values(records).flat().map((e) => [e.id, e]));
  /** @param {string | null | undefined} id @param {string} kind */
  const live = (id, kind) => (id && byId.get(id)?.kind === kind ? id : null);
  /** @param {unknown} ids */
  const tagNames = (ids) => (Array.isArray(ids) ? ids : []).flatMap((t) => {
    const tag = byId.get(t);
    return tag?.kind === "tag" ? [/** @type {string} */ (tag.body?.name)] : [];
  }).sort(nocase);
  /** @param {Entry} item */
  const visualsFor = (item) => {
    const visuals = visualsOf(item.body);
    return {
      photos: visuals.flatMap((v, position) => (v.kind !== "file" ? [] : [{
        id: v.id, kind: v.file_kind, mime: v.mime, file: photoFile(v.id, v.mime), caption: v.caption ?? null, position,
        created_at: v.created_at ?? null,
      }])),
      drawings: visuals.flatMap((v, position) => {
        const d = v.kind === "drawing" ? byId.get(v.id) : undefined;
        return d?.kind === "drawing" ? [{ id: d.id, data: d.body?.data, file: `drawings/${d.id}.svg`, caption: d.body?.caption ?? null, position,
          created_at: d.body?.created_at ?? null, updated_at: d.body?.updated_at ?? null }] : [];
      }),
      poses: visuals.flatMap((v, position) => {
        const p = v.kind === "pose" ? byId.get(v.id) : undefined;
        return p?.kind === "pose" ? [{ id: p.id, data: p.body?.data, caption: p.body?.caption ?? null, position,
          created_at: p.body?.created_at ?? null, updated_at: p.body?.updated_at ?? null }] : [];
      }),
    };
  };
  const made = (/** @type {Entry} */ e) => [e.body?.created_at ?? "", e.id];
  const settings = records.settings?.[0]?.body ?? {};
  const ties = records.tie ?? [];
  const plans = records.plan ?? [];

  return {
    settings: { top_label: settings.top_label ?? null, bottom_label: settings.bottom_label ?? null, default_shape: settings.default_shape ?? null },
    pose_presets: sorted(records.pose_preset ?? [], (p) => [p.body?.created_at ?? "", String(p.body?.order ?? 0).padStart(4, "0")]).map((p) => ({
      kind: p.body?.kind, name: p.body?.name ?? null, data: p.body?.data, created_at: p.body?.created_at ?? null, updated_at: p.body?.updated_at ?? null,
    })),
    people: sorted(records.person ?? [], made).map(({ id, body: b = {} }) => ({
      id, name: b?.name, pronouns: b?.pronouns ?? null, notes: b?.notes ?? null, is_self: !!b?.is_self, default_role: b?.default_role ?? null,
      is_educator: !!b?.is_educator, based_in: b?.based_in ?? null,
      // As format 1's export has it: the opened field, JSON text.
      aliases: Array.isArray(b?.aliases) && b.aliases.length ? JSON.stringify(b.aliases) : null,
      about: b?.about ?? null, about_shared_on: b?.about_shared_on ?? null, connection_id: null,
      archived_at: b?.archived_at ?? null, created_at: b?.created_at ?? null, updated_at: b?.updated_at ?? null,
      profile_notes: (Array.isArray(b?.profile_notes) ? b.profile_notes : []).map((/** @type {any} */ n) => ({
        type: n.type, description: n.description, noted_on: n.noted_on ?? null, is_current: !!n.is_current,
        created_at: n.created_at ?? null, updated_at: n.updated_at ?? null,
      })),
    })),
    locations: sorted(records.location ?? [], made).map(({ id, body: b }) => ({
      id, name: b?.name, notes: b?.notes ?? null, maps_url: b?.maps_url ?? null,
      city: b?.city ?? null, state_province: b?.state_province ?? null, country: b?.country ?? null,
      latitude: b?.latitude ?? null, longitude: b?.longitude ?? null, is_default: !!b?.is_default,
      archived_at: b?.archived_at ?? null, created_at: b?.created_at ?? null, updated_at: b?.updated_at ?? null,
    })),
    plans: sorted(plans, made).map((p) => {
      const b = p.body ?? {};
      return {
        id: p.id, title: b.title, stage: b.stage ?? "idea", plan_type: b.plan_type ?? "idea", tie_type: b.tie_type ?? null,
        description: b.description ?? null, notes: b.notes ?? null, album_url: b.album_url ?? null, est_difficulty: b.est_difficulty ?? null,
        variation_of: live(b.variation_of, "plan"), version: b.version ?? 1,
        archived_at: b.archived_at ?? null, created_at: b.created_at ?? null, updated_at: b.updated_at ?? null,
        tags: tagNames(b.tags), ...visualsFor(p),
      };
    }),
    tags: (records.tag ?? []).map((t) => /** @type {string} */ (t.body?.name)).sort(nocase),
    ties: sorted(ties, (t) => [t.body?.tie_date ?? "", ...made(t)]).map((t) => {
      const b = t.body ?? {};
      const location = live(b.location_id, "location");
      return {
        id: t.id, title: b.title ?? null, tie_date: b.tie_date, tie_type: b.tie_type, duration_minutes: b.duration_minutes ?? null,
        success_rating: b.success_rating ?? null, notes: b.notes ?? null, album_url: b.album_url ?? null,
        location_id: location, location_deleted: !!b.location_deleted || (!!b.location_id && !location),
        created_at: b.created_at ?? null, updated_at: b.updated_at ?? null,
        participants: (Array.isArray(b.participants) ? b.participants : []).map((/** @type {any} */ p) => ({
          person_id: live(p.person_id, "person"), role: p.role, difficulty_rating: p.difficulty_rating ?? null,
          experience_rating: p.experience_rating ?? null, notes: p.notes ?? null,
        })),
        plans: (Array.isArray(b.plans) ? b.plans : []).map((/** @type {any} */ p) => ({ plan_id: live(p.plan_id, "plan"), plan_version: p.plan_version ?? 1 })),
        tags: tagNames(b.tags), ...visualsFor(t),
      };
    }),
    workshops: sorted(records.workshop ?? [], (w) => [w.body?.start_date ?? "", ...made(w)]).map((w) => {
      const b = w.body ?? {};
      const location = live(b.location_id, "location");
      const people = Array.isArray(b.people) ? b.people : [];
      const of = (/** @type {string} */ kind) => people.filter((/** @type {any} */ p) => p.kind === kind)
        .map((/** @type {any} */ p) => ({ person_id: live(p.person_id, "person"), role: p.role }));
      return {
        id: w.id, title: b.title, start_date: b.start_date, end_date: b.end_date ?? null,
        location_id: location, location_deleted: !!b.location_deleted || (!!b.location_id && !location),
        attendee_count: b.attendee_count ?? null, rating: b.rating ?? null, difficulty: b.difficulty ?? null,
        rating_content: b.rating_content ?? null, rating_teaching: b.rating_teaching ?? null, rating_value: b.rating_value ?? null,
        cost: b.cost ?? null, event_url: b.event_url ?? null, description: b.description ?? null, notes: b.notes ?? null,
        album_url: b.album_url ?? null, created_at: b.created_at ?? null, updated_at: b.updated_at ?? null,
        educators: of("educator"), participants: of("participant"), tags: tagNames(b.tags),
        ties: sorted(ties.filter((t) => t.body?.workshop_id === w.id), (t) => [t.body?.tie_date ?? "", ...made(t)]).map((t) => t.id),
        plans: sorted(plans.filter((p) => p.body?.workshop_id === w.id), made).map((p) => p.id),
        ...visualsFor(w),
      };
    }),
  };
}
