// A user with something in every table, and counting one user's rows in
// each: for deleting an account (account-delete.test.js) and finishing a
// conversion (convert.test.js).
import { env } from "cloudflare:test";
import { call, createOtherUser, sessionCookieFor, sql, sealed } from "./helpers.js";

// Every table, and how to count one user's rows in it (child rows through
// their parent).
export const OWNED_ROWS = {
  users: "SELECT count(*) AS n FROM users WHERE id = ?",
  passkeys: "SELECT count(*) AS n FROM passkeys WHERE user_id = ?",
  sessions: "SELECT count(*) AS n FROM sessions WHERE user_id = ?",
  auth_challenges: "SELECT count(*) AS n FROM auth_challenges WHERE user_id = ?",
  people: "SELECT count(*) AS n FROM people WHERE owner_id = ?",
  profile_notes: "SELECT count(*) AS n FROM profile_notes n JOIN people p ON p.id = n.person_id WHERE p.owner_id = ?",
  locations: "SELECT count(*) AS n FROM locations WHERE owner_id = ?",
  tags: "SELECT count(*) AS n FROM tags WHERE owner_id = ?",
  plans: "SELECT count(*) AS n FROM plans WHERE owner_id = ?",
  plan_tags: "SELECT count(*) AS n FROM plan_tags pt JOIN plans p ON p.id = pt.plan_id WHERE p.owner_id = ?",
  ties: "SELECT count(*) AS n FROM ties WHERE owner_id = ?",
  tie_participants: "SELECT count(*) AS n FROM tie_participants tp JOIN ties t ON t.id = tp.tie_id WHERE t.owner_id = ?",
  tie_plans: "SELECT count(*) AS n FROM tie_plans tp JOIN ties t ON t.id = tp.tie_id WHERE t.owner_id = ?",
  tie_tags: "SELECT count(*) AS n FROM tie_tags tt JOIN ties t ON t.id = tt.tie_id WHERE t.owner_id = ?",
  workshops: "SELECT count(*) AS n FROM workshops WHERE owner_id = ?",
  workshop_people: "SELECT count(*) AS n FROM workshop_people wp JOIN workshops w ON w.id = wp.workshop_id WHERE w.owner_id = ?",
  workshop_tags: "SELECT count(*) AS n FROM workshop_tags wt JOIN workshops w ON w.id = wt.workshop_id WHERE w.owner_id = ?",
  invites: "SELECT count(*) AS n FROM invites WHERE used_by = ?",
  key_wraps: "SELECT count(*) AS n FROM key_wraps WHERE user_id = ?",
  media: "SELECT count(*) AS n FROM media WHERE owner_id = ?",
  drawings: "SELECT count(*) AS n FROM drawings WHERE owner_id = ?",
  poses: "SELECT count(*) AS n FROM poses WHERE owner_id = ?",
  pose_presets: "SELECT count(*) AS n FROM pose_presets WHERE owner_id = ?",
  notices: "SELECT count(*) AS n FROM notices WHERE user_id = ?",
  notice_dismissals: "SELECT count(*) AS n FROM notice_dismissals WHERE user_id = ?",
  feedback: "SELECT count(*) AS n FROM feedback WHERE user_id = ?",
  shares: "SELECT count(*) AS n FROM shares WHERE owner_id = ?",
  connections: "SELECT count(*) AS n FROM connections WHERE owner_id = ?1 OR peer_id = ?1",
  connection_offers: "SELECT count(*) AS n FROM connection_offers WHERE owner_id = ?",
  records: "SELECT count(*) AS n FROM records WHERE owner_id = ?",
  record_deletions: "SELECT count(*) AS n FROM record_deletions WHERE owner_id = ?",
  files: "SELECT count(*) AS n FROM files WHERE owner_id = ?",
  identity_keys: "SELECT count(*) AS n FROM identity_keys WHERE user_id = ?",
  mailboxes: "SELECT count(*) AS n FROM mailboxes WHERE owner_id = ?",
  mailbox_messages: "SELECT count(*) AS n FROM mailbox_messages m JOIN mailboxes b ON b.id = m.mailbox_id WHERE b.owner_id = ?",
};

// Child rows whose parent is gone: there should never be any.
export const ORPHANS = [
  "SELECT count(*) AS n FROM profile_notes WHERE person_id NOT IN (SELECT id FROM people)",
  "SELECT count(*) AS n FROM plan_tags WHERE plan_id NOT IN (SELECT id FROM plans) OR tag_id NOT IN (SELECT id FROM tags)",
  "SELECT count(*) AS n FROM tie_participants WHERE tie_id NOT IN (SELECT id FROM ties)",
  "SELECT count(*) AS n FROM tie_plans WHERE tie_id NOT IN (SELECT id FROM ties)",
  "SELECT count(*) AS n FROM tie_tags WHERE tie_id NOT IN (SELECT id FROM ties) OR tag_id NOT IN (SELECT id FROM tags)",
  "SELECT count(*) AS n FROM workshop_people WHERE workshop_id NOT IN (SELECT id FROM workshops)",
  "SELECT count(*) AS n FROM workshop_tags WHERE workshop_id NOT IN (SELECT id FROM workshops) OR tag_id NOT IN (SELECT id FROM tags)",
  "SELECT count(*) AS n FROM mailbox_messages WHERE mailbox_id NOT IN (SELECT id FROM mailboxes)",
  "SELECT count(*) AS n FROM media WHERE workshop_id NOT IN (SELECT id FROM workshops)",
  "SELECT count(*) AS n FROM media WHERE tie_id NOT IN (SELECT id FROM ties) OR plan_id NOT IN (SELECT id FROM plans)",
  `SELECT count(*) AS n FROM drawings WHERE tie_id NOT IN (SELECT id FROM ties) OR plan_id NOT IN (SELECT id FROM plans)
      OR workshop_id NOT IN (SELECT id FROM workshops)`,
  `SELECT count(*) AS n FROM poses WHERE tie_id NOT IN (SELECT id FROM ties) OR plan_id NOT IN (SELECT id FROM plans)
      OR workshop_id NOT IN (SELECT id FROM workshops)`,
];

/** @param {string} userId */
export async function countRows(userId) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const [table, query] of Object.entries(OWNED_ROWS)) {
    counts[table] = /** @type {number} */ ((await sql(query, userId).first())?.n);
  }
  return counts;
}

/**
 * A user with something in every table, signed in just now.
 * @returns {Promise<{ id: string, cookie: string }>}
 */
export async function userWithEverything() {
  const id = await createOtherUser();
  const cookie = await sessionCookieFor(id);
  const post = async (/** @type {string} */ path, /** @type {any} */ body) => (await call(path, { method: "POST", body, cookie })).body.id;

  await sql("INSERT INTO passkeys (id, user_id, public_key, name) VALUES (?, ?, 'pk', 'Phone')", `pk-${id}`, id).run();
  await sql(`INSERT INTO key_wraps (id, user_id, kind, passkey_id, salt, iv, wrapped, version)
             VALUES (?, ?, 'passkey', ?, 's', 'i', 'w', 1)`, crypto.randomUUID(), id, `pk-${id}`).run();
  await sql(`INSERT INTO key_wraps (id, user_id, kind, recovery_secret_hash, salt, iv, wrapped, version)
             VALUES (?, ?, 'recovery', 'h', 's', 'i', 'w', 1)`, crypto.randomUUID(), id).run();
  await sql("INSERT INTO auth_challenges (challenge, purpose, user_id, expires_at) VALUES (?, 'register', ?, '2999-01-01T00:00:00Z')", `c-${id}`, id).run();
  await sql("INSERT INTO invites (code_hash, used_at, used_by) VALUES (?, '2026-01-01T00:00:00Z', ?)", `inv-${id}`, id).run();
  const sam = await post("/api/people", { name: "Sam" });
  await sql("INSERT INTO profile_notes (id, person_id, type, description) VALUES (?, ?, 'like', 'Hip harnesses')", crypto.randomUUID(), sam).run();
  const loc = await post("/api/locations", { name: "Studio" });
  const plan = await post("/api/plans", { title: "TK" });
  await post("/api/plans", { title: "TK 2", variation_of: plan });
  const tag = crypto.randomUUID();
  await sql("INSERT INTO tags (id, owner_id, name) VALUES (?, ?, 'box')", tag, id).run();
  await sql("INSERT INTO plan_tags (plan_id, tag_id) VALUES (?, ?)", plan, tag).run();
  const tie = await post("/api/ties", { tie_type: "floor", tie_date: "2026-01-01",
    title: "Session", location_id: loc, participants: [{ person_id: sam, role: "bottom" }], plan_ids: [plan], tags: ["box", "floor"],
  });
  const workshop = await post("/api/workshops", { title: "Intro", start_date: "2026-02-01", location_id: loc,
    educators: [{ person_id: sam, role: "top" }], tags: ["box"],
  });
  // Photos' rows (their files are tested in media.test.js).
  await sql(`INSERT INTO media (id, owner_id, tie_id, kind, mime, position, thumb_bytes, bytes)
             VALUES (?, ?, ?, 'photo', 'image/jpeg', 0, 1, 2)`, crypto.randomUUID(), id, tie).run();
  await sql(`INSERT INTO media (id, owner_id, workshop_id, kind, mime, position, thumb_bytes, bytes)
             VALUES (?, ?, ?, 'photo', 'image/jpeg', 0, 1, 2)`, crypto.randomUUID(), id, workshop).run();
  await post("/api/drawings", { tie_id: tie, data: { v: 1, strokes: [{ c: "red", w: 1, p: [1, 1] }] } });
  await post("/api/drawings", { plan_id: plan, data: { v: 1, strokes: [{ c: "blue", w: 1, p: [1, 1] }] } });
  await post("/api/drawings", { workshop_id: workshop, data: { v: 1, strokes: [{ c: "green", w: 1, p: [1, 1] }] } });
  const pose = { v: 1, joints: {}, body: [0, 0, 0], lift: 99, camera: [0, 0, 300, 100], ring: null, ropes: [] };
  await post("/api/poses", { tie_id: tie, data: pose });
  await post("/api/poses", { plan_id: plan, data: pose });
  await post("/api/poses", { workshop_id: workshop, data: pose });
  await post("/api/pose-presets", { kind: "arms", name: sealed("Boxtie"), data: { joints: { l_elbow: [90] } } });
  // A notice just for them, dismissed.
  const notice = crypto.randomUUID();
  await sql("INSERT INTO notices (id, user_id, message) VALUES (?, ?, 'Hello')", notice, id).run();
  await sql("INSERT INTO notice_dismissals (notice_id, user_id) VALUES (?, ?)", notice, id).run();
  await post("/api/feedback", { kind: "bug", message: "The + button", app_version: "2026.10.20.001" });
  // A share (its file is tested in shares.test.js).
  await post("/api/shares", { id: `share-${id.slice(0, 16)}`, kind: "tie", label: null, link_key: sealed("key"), expires: "1d", max_uses: 1,
    snapshot: btoa("x".repeat(40)).replace(/=+$/, "") });
  // A connection to another account, on Sam, and an offer to connect.
  const connection = crypto.randomUUID();
  const peer = await createOtherUser();
  await sql("INSERT INTO connections (id, owner_id, peer_id, invited) VALUES (?, ?, ?, 1), (?, ?, ?, 0)",
    connection, id, peer, crypto.randomUUID(), peer, id).run();
  await sql("UPDATE people SET connection_id = ? WHERE id = ?", connection, sam).run();
  await sql("INSERT INTO connection_offers (token_hash, owner_id, expires_at) VALUES (?, ?, '2999-01-01T00:00:00Z')", `offer-${id}`, id).run();
  // Format 2's tables (migration 0032), filled directly: a record and a
  // deleted one, a file, an identity key, and a mailbox with a message.
  const mailbox = `mb-${id}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO records (id, owner_id, kind, version, seq, key, body, bytes) VALUES (?, ?, 'tie', 1, 1, 'k', 'b', 2)")
      .bind(`rec-${id}`, id),
    env.DB.prepare("INSERT INTO record_deletions (id, owner_id, kind, seq) VALUES (?, ?, 'tie', 2)").bind(`gone-${id}`, id),
    env.DB.prepare("INSERT INTO files (id, owner_id, kind, thumb_bytes, bytes) VALUES (?, ?, 'photo', 1, 2)").bind(`file-${id}`, id),
    env.DB.prepare("INSERT INTO identity_keys (user_id, public_key, sealed_seed) VALUES (?, 'pk', 'i1.x.y')").bind(id),
    env.DB.prepare("INSERT INTO mailboxes (id, owner_id, token_hash, kind) VALUES (?, ?, 'h', 'contact')").bind(mailbox, id),
    env.DB.prepare("INSERT INTO mailbox_messages (id, mailbox_id, body, bytes, expires_at) VALUES (?, ?, 'm1.1.a.b', 8, '2999-01-01T00:00:00Z')")
      .bind(`msg-${id}`, mailbox),
  ]);
  return { id, cookie };
}
