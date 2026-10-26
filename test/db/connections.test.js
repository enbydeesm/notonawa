// Rules the database enforces on connections between accounts and the
// people they're on (migration 0026), whatever code is writing to it.
import { describe, it, expect, beforeEach } from "vitest";
import { sql, createOtherUser } from "../helpers.js";

/** @type {string} */ let me;
/** @type {string} */ let them;

beforeEach(async () => {
  me = await createOtherUser();
  them = await createOtherUser();
});

const newId = () => crypto.randomUUID();

/**
 * Both sides of a connection between me and them.
 * @returns {Promise<{ mine: string, theirs: string }>}
 */
async function connect() {
  const mine = newId();
  const theirs = newId();
  await sql("INSERT INTO connections (id, owner_id, peer_id, invited) VALUES (?, ?, ?, 0), (?, ?, ?, 1)",
    mine, me, them, theirs, them, me).run();
  return { mine, theirs };
}

/**
 * @param {string} owner
 * @param {string | null} connection
 * @param {number} [isSelf]
 */
async function person(owner, connection, isSelf = 0) {
  const id = newId();
  await sql("INSERT INTO people (id, owner_id, name, is_self, connection_id) VALUES (?, ?, 'Someone', ?, ?)", id, owner, isSelf, connection).run();
  return id;
}

const linkOf = async (/** @type {string} */ id) =>
  /** @type {any} */ (await sql("SELECT connection_id FROM people WHERE id = ?", id).first()).connection_id;

describe("connections", () => {
  it("can't connect an account to itself", async () => {
    await expect(sql("INSERT INTO connections (id, owner_id, peer_id, invited) VALUES (?, ?, ?, 0)", newId(), me, me).run())
      .rejects.toThrow("CHECK constraint failed");
  });

  it("allow one connection between two accounts", async () => {
    await connect();
    await expect(sql("INSERT INTO connections (id, owner_id, peer_id, invited) VALUES (?, ?, ?, 0)", newId(), me, them).run())
      .rejects.toThrow("UNIQUE constraint failed");
  });

  it("never move between accounts", async () => {
    const { mine } = await connect();
    const other = await createOtherUser();
    await expect(sql("UPDATE connections SET peer_id = ? WHERE id = ?", other, mine).run()).rejects.toThrow("ownership mismatch");
    await expect(sql("UPDATE connections SET owner_id = ? WHERE id = ?", other, mine).run()).rejects.toThrow("ownership mismatch");
    await expect(sql("UPDATE connections SET invited = 1 WHERE id = ?", mine).run()).rejects.toThrow("ownership mismatch");
  });

  it("go from both sides when one side is removed, coming off both sides' people", async () => {
    const { mine, theirs } = await connect();
    const myCard = await person(me, mine);
    const theirCard = await person(them, theirs);
    await sql("DELETE FROM connections WHERE id = ?", theirs).run();
    expect(await sql("SELECT count(*) AS n FROM connections WHERE id IN (?, ?)", mine, theirs).first()).toEqual({ n: 0 });
    expect(await linkOf(myCard)).toBeNull();
    expect(await linkOf(theirCard)).toBeNull();
  });

  it("go when either account is deleted, leaving the other's person unlinked", async () => {
    const { mine } = await connect();
    const myCard = await person(me, mine);
    await sql("DELETE FROM users WHERE id = ?", them).run();
    expect(await sql("SELECT count(*) AS n FROM connections WHERE owner_id = ? OR peer_id = ?", me, me).first()).toEqual({ n: 0 });
    expect(await linkOf(myCard)).toBeNull();
  });
});

describe("a person's connection", () => {
  it("must be my own side of a connection", async () => {
    const { theirs } = await connect();
    await expect(person(me, theirs)).rejects.toThrow("ownership mismatch: connection");
    const card = await person(me, null);
    await expect(sql("UPDATE people SET connection_id = ? WHERE id = ?", theirs, card).run()).rejects.toThrow("ownership mismatch: connection");
  });

  it("must be a connection that exists", async () => {
    await expect(person(me, newId())).rejects.toThrow("ownership mismatch: connection");
  });

  it("can't be on my own profile", async () => {
    const { mine } = await connect();
    await expect(person(me, mine, 1)).rejects.toThrow("ownership mismatch: connection");
    const card = await person(me, mine);
    await expect(sql("UPDATE people SET is_self = 1 WHERE id = ?", card).run()).rejects.toThrow("ownership mismatch: connection");
  });

  it("is on one person at most", async () => {
    const { mine } = await connect();
    await person(me, mine);
    await expect(person(me, null).then((id) => sql("UPDATE people SET connection_id = ? WHERE id = ?", mine, id).run()))
      .rejects.toThrow("UNIQUE constraint failed");
  });
});

describe("shares' connect", () => {
  it("is only for profile invites", async () => {
    await expect(sql("INSERT INTO shares (id, owner_id, kind, bytes, connect) VALUES (?, ?, 'tie', 10, 1)", newId(), me).run())
      .rejects.toThrow("CHECK constraint failed");
    await sql("INSERT INTO shares (id, owner_id, kind, bytes, connect) VALUES (?, ?, 'profile', 10, 1)", newId(), me).run();
  });
});
