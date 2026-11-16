// One journal with something of every kind (deleted links, a variation,
// a workshop with linked ties and plans, a photo, a drawing and a pose, a
// preset, role names and a default body), as format 1's rows
// (src/data/db.js reads), for tests that export it or convert it.

export const T1 = "2026-01-01T00:00:00Z";
export const T2 = "2026-02-01T00:00:00Z";
export const aliases = JSON.stringify([{ platform: "fetlife", alias: "sam" }]);
export const shape = { v: 1, strokes: [{ c: "red", w: 2, p: [1, 1] }] };
export const pose = { v: 1, joints: {} };

export const rows = {
  user: { created_at: T1, accepted_at: T1, terms_version: "1", recovery_email_set: 0, top_label: "Rigger", bottom_label: null,
    theme: "dark", seen_release: null, hide_welcome: 0, default_shape: "[50,50,50,170]" },
  passkeys: [],
  people: [
    { id: "me", name: "Me", pronouns: null, notes: null, is_self: 1, default_role: "top", is_educator: 0, based_in: null, aliases: null,
      about: "Hi", about_shared_on: null, connection_id: null, archived_at: null, created_at: T1, updated_at: T1 },
    { id: "sam", name: "Sam", pronouns: "they", notes: "Notes", is_self: 0, default_role: null, is_educator: 1, based_in: "Leeds",
      aliases, about: null, about_shared_on: "2026-01-02", connection_id: null, archived_at: T2, created_at: T2, updated_at: T2 },
  ],
  profileNotes: [{ person_id: "sam", type: "limit", description: "No neck", noted_on: "2026-01-03", is_current: 1, created_at: T2, updated_at: T2 }],
  locations: [{ id: "studio", name: "Studio", notes: null, maps_url: "https://maps.google.com/?q=1,2", city: "Leeds", state_province: null,
    country: "UK", latitude: 1, longitude: 2, is_default: 1, archived_at: null, created_at: T1, updated_at: T1 }],
  plans: [{ id: "tk", title: "TK", stage: "idea", plan_type: "harness", tie_type: null, description: "D", notes: null, album_url: null,
    est_difficulty: 3, variation_of: null, version: 1, archived_at: null, created_at: T1, updated_at: T1, workshop_id: "w1" }],
  planTags: [{ plan_id: "tk", name: "box" }],
  tags: [{ name: "Ankle" }, { name: "box" }],
  ties: [{ id: "t1", title: "Session", tie_date: "2026-01-05", tie_type: "floor", duration_minutes: 60, success_rating: 4, notes: "N",
    album_url: null, location_id: "studio", location_deleted: 0, created_at: T1, updated_at: T1, workshop_id: "w1" }],
  participants: [
    { tie_id: "t1", person_id: "sam", role: "bottom", difficulty_rating: 3, experience_rating: null, notes: null },
    { tie_id: "t1", person_id: null, role: "spotter", difficulty_rating: null, experience_rating: null, notes: null },
  ],
  tiePlans: [{ tie_id: "t1", plan_id: "tk", plan_version: 1 }],
  tieTags: [{ tie_id: "t1", name: "Ankle" }, { tie_id: "t1", name: "box" }],
  workshops: [{ id: "w1", title: "Intro", start_date: "2026-01-04", end_date: null, location_id: null, location_deleted: 1, attendee_count: 8,
    rating: 5, difficulty: null, rating_content: null, rating_teaching: null, rating_value: null, cost: "USD 10.00", event_url: null,
    description: null, notes: null, album_url: null, created_at: T1, updated_at: T1 }],
  workshopPeople: [{ workshop_id: "w1", person_id: "sam", kind: "educator", role: "top" }],
  workshopTags: [],
  media: [{ id: "f1", tie_id: "t1", kind: "photo", mime: "image/webp", caption: "Front", position: 0, created_at: T1 }],
  drawings: [{ id: "d1", tie_id: "t1", data: JSON.stringify(shape), caption: null, position: 1, created_at: T1, updated_at: T1 }],
  poses: [{ id: "q1", plan_id: "tk", data: JSON.stringify(pose), caption: "Kneel", position: 0, created_at: T1, updated_at: T1 }],
  notices: [], feedback: [], shares: [], connections: [],
  posePresets: [{ kind: "arms", name: "Box", data: JSON.stringify({ joints: {} }), created_at: T1, updated_at: T1 }],
};
