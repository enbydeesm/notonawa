// Rules the database enforces on format 2's tables (migration 0032),
// whatever code is writing to them.
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
 * @param {string} id
 * @param {string} owner
 * @param {number} [version]
 */
const insert = (id, owner, version = 1) =>
  sql("INSERT INTO records (id, owner_id, kind, version, seq, key, body, bytes) VALUES (?, ?, 'tie', ?, ?, 'k', 'b', 2)",
    id, owner, version, Math.floor(Math.random() * 1e9)).run();

describe("records", () => {
  it("start at version 1, and rise by one", async () => {
    const id = newId();
    await expect(insert(id, me, 2)).rejects.toThrow(/stale/);
    await insert(id, me);
    await expect(sql("UPDATE records SET version = 3 WHERE id = ?", id).run()).rejects.toThrow(/stale/);
    await sql("UPDATE records SET version = 2 WHERE id = ?", id).run();
    await expect(sql("UPDATE records SET version = 2 WHERE id = ?", id).run()).rejects.toThrow(/stale/);
  });

  it("keep their owner and kind", async () => {
    const id = newId();
    await insert(id, me);
    await expect(sql("UPDATE records SET owner_id = ?, version = 2 WHERE id = ?", them, id).run()).rejects.toThrow(/ownership mismatch/);
    await expect(sql("UPDATE records SET kind = 'plan', version = 2 WHERE id = ?", id).run()).rejects.toThrow(/stale/);
    await expect(sql("UPDATE records SET kind = 'ties' WHERE id = ?", id).run()).rejects.toThrow();
  });

  it("can't come back once deleted, and a deletion can't be marked while the record lives", async () => {
    const id = newId();
    await insert(id, me);
    await expect(sql("INSERT INTO record_deletions (id, owner_id, kind, seq) VALUES (?, ?, 'tie', 99)", id, me).run()).rejects.toThrow(/stale/);
    await sql("DELETE FROM records WHERE id = ?", id).run();
    await sql("INSERT INTO record_deletions (id, owner_id, kind, seq) VALUES (?, ?, 'tie', 99)", id, me).run();
    await expect(insert(id, me)).rejects.toThrow(/stale/);
  });

  it("have one sequence number each in an account", async () => {
    await sql("INSERT INTO records (id, owner_id, kind, version, seq, key, body, bytes) VALUES (?, ?, 'tie', 1, 7, 'k', 'b', 2)", newId(), me).run();
    await expect(sql("INSERT INTO records (id, owner_id, kind, version, seq, key, body, bytes) VALUES (?, ?, 'tie', 1, 7, 'k', 'b', 2)", newId(), me).run())
      .rejects.toThrow(/UNIQUE/);
    await sql("INSERT INTO records (id, owner_id, kind, version, seq, key, body, bytes) VALUES (?, ?, 'tie', 1, 7, 'k', 'b', 2)", newId(), them).run();
  });
});

describe("the checks' tables", () => {
  it("refuse anything put in them, which is how a batch is refused", async () => {
    await expect(sql("INSERT INTO version_checks (ok) SELECT NULL").run()).rejects.toThrow(/NOT NULL constraint failed: version_checks\.ok/);
    await expect(sql("INSERT INTO quota_checks (ok) SELECT NULL").run()).rejects.toThrow(/NOT NULL constraint failed: quota_checks\.ok/);
  });
});

describe("mailboxes", () => {
  it("expire only if they're an invite's intro", async () => {
    await expect(sql("INSERT INTO mailboxes (id, owner_id, token_hash, kind) VALUES (?, ?, 'h', 'intro')", newId(), me).run()).rejects.toThrow(/CHECK/);
    await expect(sql("INSERT INTO mailboxes (id, owner_id, token_hash, kind, expires_at) VALUES (?, ?, 'h', 'contact', '2999-01-01T00:00:00Z')", newId(), me).run())
      .rejects.toThrow(/CHECK/);
  });

  it("hold one unread profile message at a time", async () => {
    const box = newId();
    await sql("INSERT INTO mailboxes (id, owner_id, token_hash, kind) VALUES (?, ?, 'h', 'contact')", box, me).run();
    const add = () => sql("INSERT INTO mailbox_messages (id, mailbox_id, slot, body, bytes, expires_at) VALUES (?, ?, 'profile', 'm', 1, '2999-01-01T00:00:00Z')",
      newId(), box).run();
    await add();
    await expect(add()).rejects.toThrow(/UNIQUE/);
  });
});
