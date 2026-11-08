// Rules the database enforces on its own (triggers, CHECKs, unique indexes),
// whatever code is writing to it.
import { describe, it, expect, beforeEach } from "vitest";
import { sql, createOtherUser } from "../helpers.js";

/** @type {string} */ let me;
/** @type {string} */ let them;

beforeEach(async () => {
  me = await createOtherUser();
  them = await createOtherUser();
});

/** @param {string} prefix */
const newId = (prefix) => `${prefix}-${crypto.randomUUID()}`;

describe("ownership triggers", () => {
  it("stop linking a tie to another user's location", async () => {
    const loc = newId("loc");
    await sql("INSERT INTO locations (id, owner_id, name) VALUES (?, ?, 'Theirs')", loc, them).run();
    await expect(
      sql("INSERT INTO ties (id, owner_id, title, tie_date, tie_type, location_id) VALUES (?, ?, 'x', '2026-01-01', 'floor', ?)", newId("tie"), me, loc).run()
    ).rejects.toThrow("ownership mismatch: location");
  });

  it("stop adding another user's person to a tie", async () => {
    const tie = newId("tie");
    const person = newId("person");
    await sql("INSERT INTO ties (id, owner_id, title, tie_date, tie_type) VALUES (?, ?, 'x', '2026-01-01', 'floor')", tie, me).run();
    await sql("INSERT INTO people (id, owner_id, name) VALUES (?, ?, 'Theirs')", person, them).run();
    await expect(
      sql("INSERT INTO tie_participants (id, tie_id, person_id, role) VALUES (?, ?, ?, 'bottom')", newId("tp"), tie, person).run()
    ).rejects.toThrow("ownership mismatch: participant");
  });

  it("stop tagging a plan with another user's tag", async () => {
    const plan = newId("plan");
    const tag = newId("tag");
    await sql("INSERT INTO plans (id, owner_id, title) VALUES (?, ?, 'x')", plan, me).run();
    await sql("INSERT INTO tags (id, owner_id, name) VALUES (?, ?, 'theirs')", tag, them).run();
    await expect(sql("INSERT INTO plan_tags (plan_id, tag_id) VALUES (?, ?)", plan, tag).run())
      .rejects.toThrow("ownership mismatch: plan tag");
  });

  it("stop owner_id changing", async () => {
    const person = newId("person");
    await sql("INSERT INTO people (id, owner_id, name) VALUES (?, ?, 'Mine')", person, me).run();
    await expect(sql("UPDATE people SET owner_id = ? WHERE id = ?", them, person).run())
      .rejects.toThrow("owner_id cannot change");
  });
});

describe("constraints", () => {
  it("allow only one self profile per user", async () => {
    await sql("INSERT INTO people (id, owner_id, name, is_self) VALUES (?, ?, 'Me', 1)", newId("p"), me).run();
    await expect(sql("INSERT INTO people (id, owner_id, name, is_self) VALUES (?, ?, 'Me 2', 1)", newId("p"), me).run())
      .rejects.toThrow("UNIQUE constraint failed: people.owner_id");
    // Another user can have their own.
    await sql("INSERT INTO people (id, owner_id, name, is_self) VALUES (?, ?, 'Them', 1)", newId("p"), them).run();
  });

  it("only allow a known default role, or none (rigger and model are gone since 0013)", async () => {
    await sql("INSERT INTO people (id, owner_id, name, default_role) VALUES (?, ?, 'Sam', 'bottom')", newId("p"), me).run();
    await sql("INSERT INTO people (id, owner_id, name, default_role) VALUES (?, ?, 'Solo', 'self tie')", newId("p"), me).run();
    for (const role of ["chef", "rigger", "model"]) {
      await expect(sql("INSERT INTO people (id, owner_id, name, default_role) VALUES (?, ?, 'Kit', ?)", newId("p"), me, role).run())
        .rejects.toThrow("CHECK constraint failed");
    }
  });

  it("only allow the roles top, bottom, self tie, spotter and photographer on a tie", async () => {
    const tie = newId("tie");
    const person = newId("person");
    await sql("INSERT INTO ties (id, owner_id, title, tie_date, tie_type) VALUES (?, ?, 'x', '2026-01-01', 'floor')", tie, me).run();
    await sql("INSERT INTO people (id, owner_id, name) VALUES (?, ?, 'Sam')", person, me).run();
    for (const role of ["top", "bottom", "self tie", "spotter", "photographer"]) {
      await sql("INSERT INTO tie_participants (id, tie_id, person_id, role) VALUES (?, ?, ?, ?)", newId("tp"), tie, person, role).run();
    }
    for (const role of ["rigger", "model", "audit"]) {
      await expect(sql("INSERT INTO tie_participants (id, tie_id, person_id, role) VALUES (?, ?, ?, ?)", newId("tp"), tie, person, role).run())
        .rejects.toThrow("CHECK constraint failed");
    }
  });

  it("keep account settings to known values", async () => {
    await sql("UPDATE users SET top_label = 'rigger', bottom_label = 'bunny', theme = 'light' WHERE id = ?", me).run();
    await expect(sql("UPDATE users SET theme = 'blue' WHERE id = ?", me).run()).rejects.toThrow("CHECK constraint failed");
    await expect(sql("UPDATE users SET top_label = '' WHERE id = ?", me).run()).rejects.toThrow("CHECK constraint failed");
    await expect(sql("UPDATE users SET top_label = ? WHERE id = ?", "x".repeat(25), me).run()).rejects.toThrow("CHECK constraint failed");
  });

  it("only allow a known tie type, and require one (migration 0014)", async () => {
    const tie = newId("tie");
    await sql("INSERT INTO ties (id, owner_id, title, tie_date, tie_type) VALUES (?, ?, 'x', '2026-01-01', 'partial suspension')", tie, me).run();
    await sql("INSERT INTO ties (id, owner_id, title, tie_date, tie_type) VALUES (?, ?, 'x', '2026-01-01', 'hashira')", newId("tie"), me).run();
    await expect(sql("INSERT INTO ties (id, owner_id, title, tie_date, tie_type) VALUES (?, ?, 'x', '2026-01-01', 'Floor')", newId("tie"), me).run())
      .rejects.toThrow("CHECK constraint failed");
    await expect(sql("INSERT INTO ties (id, owner_id, title, tie_date) VALUES (?, ?, 'x', '2026-01-01')", newId("tie"), me).run())
      .rejects.toThrow("tie type required");
    await expect(sql("UPDATE ties SET tie_type = NULL WHERE id = ?", tie).run()).rejects.toThrow("tie type required");
    // Other edits to a tie are untouched by the check.
    await sql("UPDATE ties SET title = 'y' WHERE id = ?", tie).run();
  });

  it("keep a person's educator flag to 0 or 1, starting at 0 (migration 0016)", async () => {
    const person = newId("p");
    await sql("INSERT INTO people (id, owner_id, name) VALUES (?, ?, 'Kit')", person, me).run();
    expect(await sql("SELECT is_educator FROM people WHERE id = ?", person).first()).toEqual({ is_educator: 0 });
    await expect(sql("UPDATE people SET is_educator = 2 WHERE id = ?", person).run()).rejects.toThrow("CHECK constraint failed");
  });

  it("only allow a known tie type on a plan, or none", async () => {
    const plan = newId("plan");
    await sql("INSERT INTO plans (id, owner_id, title) VALUES (?, ?, 'x')", plan, me).run();
    await sql("UPDATE plans SET tie_type = 'floor' WHERE id = ?", plan).run();
    await sql("UPDATE plans SET tie_type = NULL WHERE id = ?", plan).run();
    await expect(sql("UPDATE plans SET tie_type = 'rope' WHERE id = ?", plan).run()).rejects.toThrow("CHECK constraint failed");
  });

  it("require every tie to have a date", async () => {
    const tie = newId("tie");
    await expect(sql("INSERT INTO ties (id, owner_id, title, tie_type) VALUES (?, ?, 'x', 'floor')", newId("tie"), me).run())
      .rejects.toThrow("NOT NULL constraint failed: ties.tie_date");
    await sql("INSERT INTO ties (id, owner_id, tie_date, tie_type) VALUES (?, ?, '2026-01-01', 'floor')", tie, me).run();
    await expect(sql("UPDATE ties SET tie_date = NULL WHERE id = ?", tie).run())
      .rejects.toThrow("NOT NULL constraint failed: ties.tie_date");
  });

  it("make setting a tie's location clear the deleted-location flag", async () => {
    const loc = newId("loc");
    const tie = newId("tie");
    await sql("INSERT INTO locations (id, owner_id, name) VALUES (?, ?, 'Studio')", loc, me).run();
    await sql("INSERT INTO ties (id, owner_id, title, tie_date, tie_type, location_deleted) VALUES (?, ?, 'x', '2026-01-01', 'floor', 1)", tie, me).run();
    await expect(sql("UPDATE ties SET location_id = ? WHERE id = ?", loc, tie).run()).rejects.toThrow("CHECK constraint failed");
    await sql("UPDATE ties SET location_id = ?, location_deleted = 0 WHERE id = ?", loc, tie).run();
  });

  it("write ISO timestamps by default", async () => {
    const person = newId("p");
    await sql("INSERT INTO people (id, owner_id, name) VALUES (?, ?, 'x')", person, me).run();
    const row = await sql("SELECT created_at, updated_at FROM people WHERE id = ?", person).first();
    expect(row?.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(row?.updated_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });
});

describe("workshops (migration 0018)", () => {
  /** @param {string} owner @param {string} [extra] */
  async function workshop(owner, extra = "") {
    const id = newId("w");
    await sql(`INSERT INTO workshops (id, owner_id, title, start_date${extra ? ", " + extra.split("=")[0] : ""})
               VALUES (?, ?, 'Intro', '2026-02-01'${extra ? ", ?" : ""})`, id, owner, ...(extra ? [extra.split("=")[1]] : [])).run();
    return id;
  }

  it("stop links to another user's location, people, tags and photos", async () => {
    const loc = newId("loc"), person = newId("p"), tag = newId("tag");
    await sql("INSERT INTO locations (id, owner_id, name) VALUES (?, ?, 'Theirs')", loc, them).run();
    await sql("INSERT INTO people (id, owner_id, name) VALUES (?, ?, 'Theirs')", person, them).run();
    await sql("INSERT INTO tags (id, owner_id, name) VALUES (?, ?, 'theirs')", tag, them).run();
    await expect(workshop(me, `location_id=${loc}`)).rejects.toThrow("ownership mismatch: location");
    const mine = await workshop(me);
    await expect(sql("UPDATE workshops SET location_id = ? WHERE id = ?", loc, mine).run()).rejects.toThrow("ownership mismatch: location");
    await expect(sql("INSERT INTO workshop_people (id, workshop_id, person_id, kind, role) VALUES (?, ?, ?, 'educator', 'top')", newId("wp"), mine, person).run())
      .rejects.toThrow("ownership mismatch: workshop person");
    await expect(sql("INSERT INTO workshop_tags (workshop_id, tag_id) VALUES (?, ?)", mine, tag).run())
      .rejects.toThrow("ownership mismatch: workshop tag");
    await expect(sql(`INSERT INTO media (id, owner_id, workshop_id, kind, mime, position, thumb_bytes, bytes)
                      VALUES (?, ?, ?, 'photo', 'image/jpeg', 0, 1, 2)`, newId("m"), them, mine).run())
      .rejects.toThrow("ownership mismatch: media workshop");
    await expect(sql("UPDATE workshops SET owner_id = ? WHERE id = ?", them, mine).run()).rejects.toThrow("owner_id cannot change");
  });

  it("need a title and start date, and an end date not before it", async () => {
    await expect(sql("INSERT INTO workshops (id, owner_id, start_date) VALUES (?, ?, '2026-02-01')", newId("w"), me).run())
      .rejects.toThrow("NOT NULL constraint failed: workshops.title");
    await expect(sql("INSERT INTO workshops (id, owner_id, title) VALUES (?, ?, 'x')", newId("w"), me).run())
      .rejects.toThrow("NOT NULL constraint failed: workshops.start_date");
    await expect(workshop(me, "end_date=2026-01-31")).rejects.toThrow("CHECK constraint failed");
    await workshop(me, "end_date=2026-02-03");
    await expect(workshop(me, "rating=6")).rejects.toThrow("CHECK constraint failed");
    await expect(workshop(me, "attendee_count=-1")).rejects.toThrow("CHECK constraint failed");
  });

  it("have each person on a workshop once, as an educator or a participant, in a known role", async () => {
    const w = await workshop(me), person = newId("p");
    await sql("INSERT INTO people (id, owner_id, name) VALUES (?, ?, 'Kit')", person, me).run();
    const add = (/** @type {string} */ kind, /** @type {string} */ role) =>
      sql("INSERT INTO workshop_people (id, workshop_id, person_id, kind, role) VALUES (?, ?, ?, ?, ?)", newId("wp"), w, person, kind, role).run();
    await expect(add("teacher", "top")).rejects.toThrow("CHECK constraint failed");
    await expect(add("educator", "rigger")).rejects.toThrow("CHECK constraint failed");
    await add("educator", "top");
    // Audit is a workshop's role (migration 0029), not a tie's.
    const other = newId("p");
    await sql("INSERT INTO people (id, owner_id, name) VALUES (?, ?, 'Sam')", other, me).run();
    await sql("INSERT INTO workshop_people (id, workshop_id, person_id, kind, role) VALUES (?, ?, ?, 'participant', 'audit')", newId("wp"), w, other).run();
    await expect(add("participant", "bottom")).rejects.toThrow("UNIQUE constraint failed");
  });

  it("mark a deleted location, and keep deleted people as null", async () => {
    const loc = newId("loc"), person = newId("p");
    await sql("INSERT INTO locations (id, owner_id, name) VALUES (?, ?, 'Studio')", loc, me).run();
    await sql("INSERT INTO people (id, owner_id, name) VALUES (?, ?, 'Kit')", person, me).run();
    const w = await workshop(me, `location_id=${loc}`);
    await sql("INSERT INTO workshop_people (id, workshop_id, person_id, kind, role) VALUES (?, ?, ?, 'educator', 'top')", newId("wp"), w, person).run();
    await sql("DELETE FROM locations WHERE id = ?", loc).run();
    await sql("DELETE FROM people WHERE id = ?", person).run();
    expect(await sql("SELECT location_id, location_deleted FROM workshops WHERE id = ?", w).first())
      .toEqual({ location_id: null, location_deleted: 1 });
    expect(await sql("SELECT person_id FROM workshop_people WHERE workshop_id = ?", w).first()).toEqual({ person_id: null });
  });

  it("put each photo on exactly one tie, plan or workshop, for good", async () => {
    const w = await workshop(me), plan = newId("plan");
    await sql("INSERT INTO plans (id, owner_id, title) VALUES (?, ?, 'x')", plan, me).run();
    const photo = (/** @type {string} */ id, /** @type {string | null} */ planId, /** @type {string | null} */ workshopId) =>
      sql(`INSERT INTO media (id, owner_id, plan_id, workshop_id, kind, mime, position, thumb_bytes, bytes)
           VALUES (?, ?, ?, ?, 'photo', 'image/jpeg', 0, 1, 2)`, id, me, planId, workshopId).run();
    await expect(photo(newId("m"), plan, w)).rejects.toThrow("CHECK constraint failed");
    await expect(photo(newId("m"), null, null)).rejects.toThrow("CHECK constraint failed");
    const m = newId("m");
    await photo(m, null, w);
    await expect(sql("UPDATE media SET workshop_id = NULL, plan_id = ? WHERE id = ?", plan, m).run()).rejects.toThrow("media cannot move");
    await sql("DELETE FROM workshops WHERE id = ?", w).run();
    expect(await sql("SELECT id FROM media WHERE id = ?", m).first()).toBeNull();
  });
});

describe("drawings", () => {
  /** @param {string} owner @param {Record<string, string | null>} item */
  const drawing = (owner, item, id = newId("d")) =>
    sql(`INSERT INTO drawings (id, owner_id, tie_id, plan_id, workshop_id, data, position) VALUES (?, ?, ?, ?, ?, '{}', 0)`,
      id, owner, item.tie_id ?? null, item.plan_id ?? null, item.workshop_id ?? null).run();

  it("go only on their owner's ties, plans and workshops", async () => {
    const tie = newId("tie"), plan = newId("plan"), w = newId("w");
    await sql("INSERT INTO ties (id, owner_id, title, tie_date, tie_type) VALUES (?, ?, 'x', '2026-01-01', 'floor')", tie, them).run();
    await sql("INSERT INTO plans (id, owner_id, title) VALUES (?, ?, 'x')", plan, them).run();
    await sql("INSERT INTO workshops (id, owner_id, title, start_date) VALUES (?, ?, 'x', '2026-01-01')", w, them).run();
    await expect(drawing(me, { tie_id: tie })).rejects.toThrow("ownership mismatch: drawing tie");
    await expect(drawing(me, { plan_id: plan })).rejects.toThrow("ownership mismatch: drawing plan");
    await expect(drawing(me, { workshop_id: w })).rejects.toThrow("ownership mismatch: drawing workshop");
  });

  it("are on exactly one item, for good, and go with it", async () => {
    const tie = newId("tie"), plan = newId("plan");
    await sql("INSERT INTO ties (id, owner_id, title, tie_date, tie_type) VALUES (?, ?, 'x', '2026-01-01', 'floor')", tie, me).run();
    await sql("INSERT INTO plans (id, owner_id, title) VALUES (?, ?, 'x')", plan, me).run();
    await expect(drawing(me, { tie_id: tie, plan_id: plan })).rejects.toThrow("CHECK constraint failed");
    await expect(drawing(me, {})).rejects.toThrow("CHECK constraint failed");
    const d = newId("d");
    await drawing(me, { tie_id: tie }, d);
    await expect(sql("UPDATE drawings SET tie_id = NULL, plan_id = ? WHERE id = ?", plan, d).run()).rejects.toThrow("drawing cannot move");
    await expect(sql("UPDATE drawings SET owner_id = ? WHERE id = ?", them, d).run()).rejects.toThrow("drawing cannot move");
    await sql("DELETE FROM ties WHERE id = ?", tie).run();
    expect(await sql("SELECT id FROM drawings WHERE id = ?", d).first()).toBeNull();
  });
});

describe("poses", () => {
  /** @param {string} owner @param {Record<string, string | null>} item */
  const pose = (owner, item, id = newId("po")) =>
    sql(`INSERT INTO poses (id, owner_id, tie_id, plan_id, workshop_id, data, position) VALUES (?, ?, ?, ?, ?, '{}', 0)`,
      id, owner, item.tie_id ?? null, item.plan_id ?? null, item.workshop_id ?? null).run();

  it("go only on their owner's ties, plans and workshops", async () => {
    const tie = newId("tie"), plan = newId("plan"), w = newId("w");
    await sql("INSERT INTO ties (id, owner_id, title, tie_date, tie_type) VALUES (?, ?, 'x', '2026-01-01', 'floor')", tie, them).run();
    await sql("INSERT INTO plans (id, owner_id, title) VALUES (?, ?, 'x')", plan, them).run();
    await sql("INSERT INTO workshops (id, owner_id, title, start_date) VALUES (?, ?, 'x', '2026-01-01')", w, them).run();
    await expect(pose(me, { tie_id: tie })).rejects.toThrow("ownership mismatch: pose tie");
    await expect(pose(me, { plan_id: plan })).rejects.toThrow("ownership mismatch: pose plan");
    await expect(pose(me, { workshop_id: w })).rejects.toThrow("ownership mismatch: pose workshop");
  });

  it("are on exactly one item, for good, and go with it", async () => {
    const tie = newId("tie"), plan = newId("plan");
    await sql("INSERT INTO ties (id, owner_id, title, tie_date, tie_type) VALUES (?, ?, 'x', '2026-01-01', 'floor')", tie, me).run();
    await sql("INSERT INTO plans (id, owner_id, title) VALUES (?, ?, 'x')", plan, me).run();
    await expect(pose(me, { tie_id: tie, plan_id: plan })).rejects.toThrow("CHECK constraint failed");
    await expect(pose(me, {})).rejects.toThrow("CHECK constraint failed");
    const d = newId("po");
    await pose(me, { tie_id: tie }, d);
    await expect(sql("UPDATE poses SET tie_id = NULL, plan_id = ? WHERE id = ?", plan, d).run()).rejects.toThrow("pose cannot move");
    await expect(sql("UPDATE poses SET owner_id = ? WHERE id = ?", them, d).run()).rejects.toThrow("pose cannot move");
    await sql("DELETE FROM ties WHERE id = ?", tie).run();
    expect(await sql("SELECT id FROM poses WHERE id = ?", d).first()).toBeNull();
  });
});

describe("key wraps", () => {
  /** @param {string} userId */
  const addPasskey = async (userId) => {
    const id = newId("pk");
    await sql("INSERT INTO passkeys (id, user_id, public_key, name) VALUES (?, ?, 'pk', 'Phone')", id, userId).run();
    return id;
  };
  /**
   * @param {string} userId
   * @param {{ kind?: string, passkeyId?: string | null, recoveryHash?: string | null }} [w]
   */
  const insertWrap = (userId, { kind = "passkey", passkeyId = null, recoveryHash = null } = {}) =>
    sql(`INSERT INTO key_wraps (id, user_id, kind, passkey_id, recovery_secret_hash, salt, iv, wrapped, version)
         VALUES (?, ?, ?, ?, ?, 's', 'i', 'w', 1)`, newId("wrap"), userId, kind, passkeyId, recoveryHash).run();

  it("can't be for another user's passkey", async () => {
    const theirs = await addPasskey(them);
    await expect(insertWrap(me, { passkeyId: theirs })).rejects.toThrow("ownership mismatch: key wrap");
  });

  it("are one per passkey and one recovery wrap per user", async () => {
    const mine = await addPasskey(me);
    await insertWrap(me, { passkeyId: mine });
    await expect(insertWrap(me, { passkeyId: mine })).rejects.toThrow(/UNIQUE/);
    await insertWrap(me, { kind: "recovery", recoveryHash: "h" });
    await expect(insertWrap(me, { kind: "recovery", recoveryHash: "h2" })).rejects.toThrow(/UNIQUE/);
  });

  it("have a passkey exactly when they're for one, and a code's hash exactly when they're for recovery", async () => {
    const mine = await addPasskey(me);
    await expect(insertWrap(me, { kind: "passkey" })).rejects.toThrow(/CHECK/);
    await expect(insertWrap(me, { kind: "recovery", passkeyId: mine, recoveryHash: "h" })).rejects.toThrow(/CHECK/);
    await expect(insertWrap(me, { kind: "recovery" })).rejects.toThrow(/CHECK/);
    await expect(insertWrap(me, { kind: "passkey", passkeyId: mine, recoveryHash: "h" })).rejects.toThrow(/CHECK/);
  });

  it("are replaced, never changed, and go with their passkey", async () => {
    const mine = await addPasskey(me);
    await insertWrap(me, { passkeyId: mine });
    await expect(sql("UPDATE key_wraps SET wrapped = 'x' WHERE user_id = ?", me).run()).rejects.toThrow("replaced, not changed");
    await sql("DELETE FROM passkeys WHERE id = ?", mine).run();
    expect(await sql("SELECT count(*) AS n FROM key_wraps WHERE user_id = ?", me).first()).toEqual({ n: 0 });
  });
});
