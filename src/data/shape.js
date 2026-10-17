// The export file: everything in an account, shaped as one JSON document.
// Pure, so it's easy to test.
//
// Items keep their ids so links between them (a tie's people, location and
// plans) can be followed in the file and rebuilt by import. Deleted links stay
// as they are in the app: a participant or plan link with a null id, and
// location_deleted on a tie. Tags are listed by name, as the app sends them.
// Each tie and plan lists its photos, with `file`: where the page puts the
// photo in the .zip it saves (the server can't decrypt photos, so the page
// fetches and decrypts each one; captions are still sealed here).

export const EXPORT_FORMAT = "notonawa-export";
export const EXPORT_VERSION = 1;

/**
 * @typedef {Record<string, any>} Row
 * @typedef {{
 *   user: Row,
 *   passkeys: Row[],
 *   people: Row[],
 *   profileNotes: Row[],
 *   locations: Row[],
 *   plans: Row[],
 *   planTags: Row[],
 *   tags: Row[],
 *   ties: Row[],
 *   participants: Row[],
 *   tiePlans: Row[],
 *   tieTags: Row[],
 *   media: Row[],
 * }} AccountRows
 */

/**
 * @param {AccountRows} rows every row in the account, as read by db.js
 * @param {string} exportedAt ISO timestamp
 */
export function exportDocument(rows, exportedAt) {
  const notesByPerson = groupBy(rows.profileNotes, "person_id");
  const tagsByPlan = groupBy(rows.planTags, "plan_id");
  const participantsByTie = groupBy(rows.participants, "tie_id");
  const plansByTie = groupBy(rows.tiePlans, "tie_id");
  const tagsByTie = groupBy(rows.tieTags, "tie_id");
  const photosByTie = groupBy(rows.media.filter((m) => m.tie_id), "tie_id");
  const photosByPlan = groupBy(rows.media.filter((m) => m.plan_id), "plan_id");

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: exportedAt,
    account: {
      created_at: rows.user.created_at,
      accepted_at: rows.user.accepted_at,
      terms_version: rows.user.terms_version,
      // Only whether one is set: we never have the address, and the hash
      // is of no use to the user.
      recovery_email_set: !!rows.user.recovery_email_set,
      passkeys: rows.passkeys.map((p) => ({ name: p.name, created_at: p.created_at, last_used_at: p.last_used_at })),
    },
    people: rows.people.map((p) => ({
      id: p.id, name: p.name, pronouns: p.pronouns, notes: p.notes, is_self: !!p.is_self, default_role: p.default_role,
      archived_at: p.archived_at, created_at: p.created_at, updated_at: p.updated_at,
      profile_notes: (notesByPerson.get(p.id) ?? []).map((n) => ({
        type: n.type, description: n.description, noted_on: n.noted_on, is_current: !!n.is_current,
        created_at: n.created_at, updated_at: n.updated_at,
      })),
    })),
    locations: rows.locations.map((l) => ({
      id: l.id, name: l.name, notes: l.notes, maps_url: l.maps_url,
      latitude: l.latitude, longitude: l.longitude, is_default: !!l.is_default,
      archived_at: l.archived_at, created_at: l.created_at, updated_at: l.updated_at,
    })),
    plans: rows.plans.map((p) => ({
      id: p.id, title: p.title, stage: p.stage, plan_type: p.plan_type, description: p.description, notes: p.notes,
      est_difficulty: p.est_difficulty, variation_of: p.variation_of, version: p.version,
      archived_at: p.archived_at, created_at: p.created_at, updated_at: p.updated_at,
      tags: (tagsByPlan.get(p.id) ?? []).map((t) => t.name),
      photos: (photosByPlan.get(p.id) ?? []).map(photoEntry),
    })),
    tags: rows.tags.map((t) => t.name),
    ties: rows.ties.map((t) => ({
      id: t.id, title: t.title, tie_date: t.tie_date, tie_type: t.tie_type, duration_minutes: t.duration_minutes,
      success_rating: t.success_rating, notes: t.notes,
      location_id: t.location_id, location_deleted: !!t.location_deleted,
      created_at: t.created_at, updated_at: t.updated_at,
      participants: (participantsByTie.get(t.id) ?? []).map((p) => ({
        person_id: p.person_id, role: p.role, difficulty_rating: p.difficulty_rating,
        experience_rating: p.experience_rating, notes: p.notes,
      })),
      plans: (plansByTie.get(t.id) ?? []).map((p) => ({ plan_id: p.plan_id, plan_version: p.plan_version })),
      tags: (tagsByTie.get(t.id) ?? []).map((x) => x.name),
      photos: (photosByTie.get(t.id) ?? []).map(photoEntry),
    })),
  };
}

/**
 * A photo as the export lists it.
 * @param {Row} m
 */
function photoEntry(m) {
  return {
    id: m.id, kind: m.kind, mime: m.mime, file: photoFile(m.id, m.mime),
    caption: m.caption, position: m.position, created_at: m.created_at,
  };
}

/**
 * Where a photo goes inside the export's zip, e.g. photos/<id>.webp.
 * @param {string} id
 * @param {string} mime
 */
export function photoFile(id, mime) {
  return `photos/${id}.${mime === "image/webp" ? "webp" : "jpg"}`;
}

/**
 * The export's file name, e.g. notonawa-2026-10-13.json.
 * @param {string} exportedAt ISO timestamp
 */
export function exportFileName(exportedAt) {
  return `notonawa-${exportedAt.slice(0, 10)}.json`;
}

/**
 * @param {Row[]} rows
 * @param {string} key
 * @returns {Map<string, Row[]>}
 */
function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row[key]);
    if (list) list.push(row);
    else map.set(row[key], [row]);
  }
  return map;
}
