// The export file: everything in an account, shaped as one JSON document.
// Pure, so it's easy to test.
//
// Items keep their ids so links between them (a tie's people, location and
// plans) can be followed in the file and rebuilt by import. Deleted links stay
// as they are in the app: a participant or plan link with a null id, and
// location_deleted on a tie. Tags are listed by name, as the app sends them.
// Each tie, plan and workshop lists its photos, with `file`: where the page puts the
// photo in the .zip it saves (the server can't decrypt photos, so the page
// fetches and decrypts each one; captions are still sealed here). Each also
// lists its drawings: their lines as they're stored, with `file`, where the
// page puts a picture of each (an SVG) in the .zip (captions sealed too),
// and its poses: their figure and ropes as they're stored (captions sealed).

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
 *   workshops: Row[],
 *   workshopPeople: Row[],
 *   workshopTags: Row[],
 *   media: Row[],
 *   drawings: Row[],
 *   poses: Row[],
 *   notices: Row[],
 *   feedback: Row[],
 *   shares: Row[],
 *   posePresets: Row[],
 *   connections: Row[],
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
  const peopleByWorkshop = groupBy(rows.workshopPeople, "workshop_id");
  // The ties and plans linked to each workshop (migration 0030), listed on
  // the workshop by id rather than on them, as workshops import last.
  const tiesByWorkshop = groupBy(rows.ties.filter((t) => t.workshop_id), "workshop_id");
  const plansByWorkshop = groupBy(rows.plans.filter((p) => p.workshop_id), "workshop_id");
  const tagsByWorkshop = groupBy(rows.workshopTags, "workshop_id");
  const photosByWorkshop = groupBy(rows.media.filter((m) => m.workshop_id), "workshop_id");
  const drawingsByTie = groupBy(rows.drawings.filter((d) => d.tie_id), "tie_id");
  const drawingsByPlan = groupBy(rows.drawings.filter((d) => d.plan_id), "plan_id");
  const drawingsByWorkshop = groupBy(rows.drawings.filter((d) => d.workshop_id), "workshop_id");
  const posesByTie = groupBy(rows.poses.filter((d) => d.tie_id), "tie_id");
  const posesByPlan = groupBy(rows.poses.filter((d) => d.plan_id), "plan_id");
  const posesByWorkshop = groupBy(rows.poses.filter((d) => d.workshop_id), "workshop_id");

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
      // Role names, light/dark mode, the last release notes seen, whether
      // the welcome is still shown and the poser's default body. An import
      // into a journal still on the default role names takes the file's,
      // and one with no default body the file's (public/js/views/data.js);
      // the rest isn't imported.
      settings: {
        top_label: rows.user.top_label ?? null, bottom_label: rows.user.bottom_label ?? null, theme: rows.user.theme ?? null,
        seen_release: rows.user.seen_release ?? null, hide_welcome: !!rows.user.hide_welcome,
        default_shape: typeof rows.user.default_shape === "string" ? JSON.parse(rows.user.default_shape) : null,
      },
      passkeys: rows.passkeys.map((p) => ({ name: p.name, created_at: p.created_at, last_used_at: p.last_used_at })),
      // Messages from us just for me, and ones for everyone I dismissed
      // (not imported: they're ours, not part of the journal).
      notices: rows.notices.map((n) => ({
        message: n.message, created_at: n.created_at, just_for_me: !!n.just_for_me, dismissed_at: n.dismissed_at,
      })),
      // Bug reports and ideas I sent (not imported either: they were for us).
      feedback: rows.feedback.map((f) => ({
        kind: f.kind, message: f.message, app_version: f.app_version, created_at: f.created_at,
      })),
      // Shares I've made (not imported: a share belongs to its link).
      // Their names are opened on the device, like notes.
      shares: rows.shares.map((s) => ({
        kind: s.kind, label: s.label, expires_at: s.expires_at, max_uses: s.max_uses, use_count: s.use_count,
        files: s.files, created_at: s.created_at,
      })),
      // Body and arms positions saved in the poser, for any pose. Their
      // names are opened on the device, like notes; an import adds the
      // ones not already there by name.
      pose_presets: rows.posePresets.map((p) => ({
        kind: p.kind, name: p.name, data: JSON.parse(p.data), created_at: p.created_at, updated_at: p.updated_at,
      })),
      // My connections to other accounts: my side's id (what people's
      // connection_id holds), never the other account's. Not imported: an
      // import keeps a person's link only to a connection still there.
      // Their names are opened on the device (an invite's name, on the
      // side that invited, sealed as a share's label).
      connections: rows.connections.map((c) => ({
        id: c.id, invited: !!c.invited, label: c.label, answered: !!c.answered, created_at: c.created_at,
      })),
    },
    people: rows.people.map((p) => ({
      id: p.id, name: p.name, pronouns: p.pronouns, notes: p.notes, is_self: !!p.is_self, default_role: p.default_role,
      is_educator: !!p.is_educator, based_in: p.based_in, aliases: p.aliases, about: p.about, about_shared_on: p.about_shared_on,
      connection_id: p.connection_id ?? null, archived_at: p.archived_at, created_at: p.created_at, updated_at: p.updated_at,
      profile_notes: (notesByPerson.get(p.id) ?? []).map((n) => ({
        type: n.type, description: n.description, noted_on: n.noted_on, is_current: !!n.is_current,
        created_at: n.created_at, updated_at: n.updated_at,
      })),
    })),
    locations: rows.locations.map((l) => ({
      id: l.id, name: l.name, notes: l.notes, maps_url: l.maps_url,
      city: l.city, state_province: l.state_province, country: l.country,
      latitude: l.latitude, longitude: l.longitude, is_default: !!l.is_default,
      archived_at: l.archived_at, created_at: l.created_at, updated_at: l.updated_at,
    })),
    plans: rows.plans.map((p) => ({
      id: p.id, title: p.title, stage: p.stage, plan_type: p.plan_type, tie_type: p.tie_type,
      description: p.description, notes: p.notes, album_url: p.album_url, est_difficulty: p.est_difficulty, variation_of: p.variation_of, version: p.version,
      archived_at: p.archived_at, created_at: p.created_at, updated_at: p.updated_at,
      tags: (tagsByPlan.get(p.id) ?? []).map((t) => t.name),
      photos: (photosByPlan.get(p.id) ?? []).map(photoEntry),
      drawings: (drawingsByPlan.get(p.id) ?? []).map(drawingEntry),
      poses: (posesByPlan.get(p.id) ?? []).map(poseEntry),
    })),
    tags: rows.tags.map((t) => t.name),
    ties: rows.ties.map((t) => ({
      id: t.id, title: t.title, tie_date: t.tie_date, tie_type: t.tie_type, duration_minutes: t.duration_minutes,
      success_rating: t.success_rating, notes: t.notes, album_url: t.album_url,
      location_id: t.location_id, location_deleted: !!t.location_deleted,
      created_at: t.created_at, updated_at: t.updated_at,
      participants: (participantsByTie.get(t.id) ?? []).map((p) => ({
        person_id: p.person_id, role: p.role, difficulty_rating: p.difficulty_rating,
        experience_rating: p.experience_rating, notes: p.notes,
      })),
      plans: (plansByTie.get(t.id) ?? []).map((p) => ({ plan_id: p.plan_id, plan_version: p.plan_version })),
      tags: (tagsByTie.get(t.id) ?? []).map((x) => x.name),
      photos: (photosByTie.get(t.id) ?? []).map(photoEntry),
      drawings: (drawingsByTie.get(t.id) ?? []).map(drawingEntry),
      poses: (posesByTie.get(t.id) ?? []).map(poseEntry),
    })),
    // Educators and participants as two lists; a deleted person has a null id.
    workshops: rows.workshops.map((w) => {
      const people = peopleByWorkshop.get(w.id) ?? [];
      const of = (/** @type {string} */ kind) => people.filter((p) => p.kind === kind)
        .map((p) => ({ person_id: p.person_id, role: p.role }));
      return {
        id: w.id, title: w.title, start_date: w.start_date, end_date: w.end_date,
        location_id: w.location_id, location_deleted: !!w.location_deleted,
        attendee_count: w.attendee_count, rating: w.rating, difficulty: w.difficulty,
        rating_content: w.rating_content, rating_teaching: w.rating_teaching, rating_value: w.rating_value,
        cost: w.cost, event_url: w.event_url, description: w.description, notes: w.notes, album_url: w.album_url,
        created_at: w.created_at, updated_at: w.updated_at,
        educators: of("educator"), participants: of("participant"),
        tags: (tagsByWorkshop.get(w.id) ?? []).map((x) => x.name),
        ties: (tiesByWorkshop.get(w.id) ?? []).map((t) => t.id),
        plans: (plansByWorkshop.get(w.id) ?? []).map((p) => p.id),
        photos: (photosByWorkshop.get(w.id) ?? []).map(photoEntry),
        drawings: (drawingsByWorkshop.get(w.id) ?? []).map(drawingEntry),
        poses: (posesByWorkshop.get(w.id) ?? []).map(poseEntry),
      };
    }),
  };
}

/**
 * A photo or video as the export lists it.
 * @param {Row} m
 */
function photoEntry(m) {
  return {
    id: m.id, kind: m.kind, mime: m.mime, file: photoFile(m.id, m.mime),
    caption: m.caption, position: m.position, created_at: m.created_at,
  };
}

/**
 * A drawing as the export lists it: its lines as they're stored.
 * @param {Row} d
 */
function drawingEntry(d) {
  return {
    id: d.id, data: JSON.parse(d.data), file: `drawings/${d.id}.svg`,
    caption: d.caption, position: d.position, created_at: d.created_at, updated_at: d.updated_at,
  };
}

/**
 * A pose as the export lists it: its figure and ropes as they're stored.
 * (No picture of it in the zip: drawing one takes the 3D view, which the
 * export doesn't load. Opening the export in nōtonawa brings them back.)
 * @param {Row} d
 */
function poseEntry(d) {
  return {
    id: d.id, data: JSON.parse(d.data),
    caption: d.caption, position: d.position, created_at: d.created_at, updated_at: d.updated_at,
  };
}

/**
 * Where a photo or video goes inside the export's zip, e.g.
 * photos/<id>.webp or photos/<id>.mp4.
 * @param {string} id
 * @param {string} mime
 */
export function photoFile(id, mime) {
  return `photos/${id}.${mime === "image/webp" ? "webp" : mime === "video/mp4" ? "mp4" : "jpg"}`;
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
