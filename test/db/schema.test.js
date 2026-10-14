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
      sql("INSERT INTO ties (id, owner_id, title, tie_date, location_id) VALUES (?, ?, 'x', '2026-01-01', ?)", newId("tie"), me, loc).run()
    ).rejects.toThrow("ownership mismatch: location");
  });

  it("stop adding another user's person to a tie", async () => {
    const tie = newId("tie");
    const person = newId("person");
    await sql("INSERT INTO ties (id, owner_id, title, tie_date) VALUES (?, ?, 'x', '2026-01-01')", tie, me).run();
    await sql("INSERT INTO people (id, owner_id, name) VALUES (?, ?, 'Theirs')", person, them).run();
    await expect(
      sql("INSERT INTO tie_participants (id, tie_id, person_id, role) VALUES (?, ?, ?, 'model')", newId("tp"), tie, person).run()
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

  it("only allow a known default role, or none", async () => {
    await sql("INSERT INTO people (id, owner_id, name, default_role) VALUES (?, ?, 'Sam', 'model')", newId("p"), me).run();
    await expect(sql("INSERT INTO people (id, owner_id, name, default_role) VALUES (?, ?, 'Kit', 'chef')", newId("p"), me).run())
      .rejects.toThrow("CHECK constraint failed");
  });

  it("only allow a known tie type, or none", async () => {
    await sql("INSERT INTO ties (id, owner_id, title, tie_date, tie_type) VALUES (?, ?, 'x', '2026-01-01', 'partial suspension')", newId("tie"), me).run();
    await sql("INSERT INTO ties (id, owner_id, title, tie_date) VALUES (?, ?, 'x', '2026-01-01')", newId("tie"), me).run();
    await expect(sql("INSERT INTO ties (id, owner_id, title, tie_date, tie_type) VALUES (?, ?, 'x', '2026-01-01', 'Floor')", newId("tie"), me).run())
      .rejects.toThrow("CHECK constraint failed");
  });

  it("require every tie to have a date", async () => {
    const tie = newId("tie");
    await expect(sql("INSERT INTO ties (id, owner_id, title) VALUES (?, ?, 'x')", newId("tie"), me).run())
      .rejects.toThrow("NOT NULL constraint failed: ties.tie_date");
    await sql("INSERT INTO ties (id, owner_id, tie_date) VALUES (?, ?, '2026-01-01')", tie, me).run();
    await expect(sql("UPDATE ties SET tie_date = NULL WHERE id = ?", tie).run())
      .rejects.toThrow("NOT NULL constraint failed: ties.tie_date");
  });

  it("make setting a tie's location clear the deleted-location flag", async () => {
    const loc = newId("loc");
    const tie = newId("tie");
    await sql("INSERT INTO locations (id, owner_id, name) VALUES (?, ?, 'Studio')", loc, me).run();
    await sql("INSERT INTO ties (id, owner_id, title, tie_date, location_deleted) VALUES (?, ?, 'x', '2026-01-01', 1)", tie, me).run();
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
