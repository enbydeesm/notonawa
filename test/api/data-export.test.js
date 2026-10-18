import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import { call, create, createOtherUser, signedInUser, sql, ORIGIN, sealed } from "../helpers.js";

describe("GET /api/data/export", () => {
  it("exports everything in my account, links and deleted links included", async () => {
    const me = await signedInUser();
    await sql("INSERT INTO passkeys (id, user_id, public_key, name) VALUES ('pk1', ?, 'PUBLIC-KEY', 'Phone')", me.id).run();
    await sql("UPDATE users SET recovery_email_hash = 'EMAIL-HASH', recovery_email_salt = 'EMAIL-SALT', top_label = 'rigger', theme = 'light' WHERE id = ?", me.id).run();
    await sql(`INSERT INTO key_wraps (id, user_id, kind, passkey_id, salt, iv, wrapped, version)
               VALUES ('w1', ?, 'passkey', 'pk1', 'WRAP-SALT', 'WRAP-IV', 'WRAPPED-KEY', 1)`, me.id).run();
    const sam = await create("/api/people", { name: "Sam", pronouns: "they/them", notes: sealed("Likes floor work"), default_role: "bottom" });
    const gone = await create("/api/people", { name: "Gone" });
    await sql(
      "INSERT INTO profile_notes (id, person_id, type, description) VALUES ('n1', ?, 'limit', 'No neck ties')", sam
    ).run();
    const studio = await create("/api/locations", { name: "Studio", latitude: 51.5, longitude: -0.1 });
    const base = await create("/api/plans", { title: "TK" });
    const variation = await create("/api/plans", { title: "TK variation", variation_of: base });
    await call(`/api/plans/${variation}/archive`, { method: "POST" });
    const tie = await create("/api/ties", {
      title: "Floor session", tie_date: "2026-10-12", tie_type: "suspension", notes: sealed("Went well"), location_id: studio,
      participants: [{ person_id: sam, role: "bottom" }, { person_id: gone, role: "spotter" }],
      plan_ids: [base], tags: ["floor"],
    });
    await call(`/api/people/${gone}`, { method: "DELETE" });

    const res = await SELF.fetch(`${ORIGIN}/api/data/export`, { headers: { cookie: me.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="notonawa-\d{4}-\d\d-\d\d\.json"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    const doc = JSON.parse(text);

    expect(doc).toMatchObject({ format: "notonawa-export", version: 1 });
    expect(doc.account.recovery_email_set).toBe(true);
    expect(doc.account.settings).toEqual({ top_label: "rigger", bottom_label: null, theme: "light" });
    expect(doc.account.passkeys).toEqual([{ name: "Phone", created_at: expect.any(String), last_used_at: null }]);
    expect(doc.people).toEqual([expect.objectContaining({
      id: sam, name: "Sam", pronouns: "they/them", notes: sealed("Likes floor work"), is_self: false, default_role: "bottom", archived_at: null,
      profile_notes: [expect.objectContaining({ type: "limit", description: "No neck ties", is_current: true })],
    })]);
    expect(doc.locations).toEqual([expect.objectContaining({ id: studio, name: "Studio", latitude: 51.5, longitude: -0.1, is_default: false })]);
    // Made in the same second, so in either order.
    expect(doc.plans).toHaveLength(2);
    expect(doc.plans).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: base, title: "TK", plan_type: "idea", variation_of: null, archived_at: null }),
      expect.objectContaining({ id: variation, variation_of: base, archived_at: expect.any(String) }),
    ]));
    expect(doc.tags).toEqual(["floor"]);
    expect(doc.ties).toEqual([expect.objectContaining({
      id: tie, title: "Floor session", tie_date: "2026-10-12", tie_type: "suspension", notes: sealed("Went well"), location_id: studio, location_deleted: false,
      participants: [
        expect.objectContaining({ person_id: sam, role: "bottom" }),
        expect.objectContaining({ person_id: null, role: "spotter" }),
      ],
      plans: [{ plan_id: base, plan_version: 1 }],
      tags: ["floor"],
    })]);

    // No secrets: no public keys, hashes or session details.
    expect(text).not.toContain("PUBLIC-KEY");
    expect(text).not.toMatch(/EMAIL-HASH|EMAIL-SALT/);
    expect(text).not.toMatch(/WRAP-SALT|WRAP-IV|WRAPPED-KEY/);
    expect(text).not.toMatch(/"[a-z_]*(hash|token|session|public_key)[a-z_]*":/);
  });

  it("leaves out other users' data", async () => {
    const other = await createOtherUser();
    await sql("INSERT INTO people (id, owner_id, name) VALUES (?, ?, 'Not yours')", crypto.randomUUID(), other).run();
    await sql("INSERT INTO tags (id, owner_id, name) VALUES (?, ?, 'secret-tag')", crypto.randomUUID(), other).run();
    const text = JSON.stringify((await call("/api/data/export")).body);
    expect(text).not.toContain("Not yours");
    expect(text).not.toContain("secret-tag");
  });

  it("needs a signed-in user", async () => {
    expect((await call("/api/data/export", { cookie: null })).status).toBe(401);
  });
});
