import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { call, sql } from "../helpers.js";
import { findOrCreateUser } from "../../src/auth/user.js";

describe("signing in", () => {
  it("signs in as DEV_USER_EMAIL on localhost", async () => {
    const res = await call("/api/tags");
    expect(res.status).toBe(200);
    const user = await sql("SELECT email FROM users WHERE email = ?", "me@example.com").first();
    expect(user).not.toBeNull();
  });

  it("rejects requests to the real site without an Access token", async () => {
    const res = await call("/api/tags", { host: "https://rope.example.com" });
    expect(res).toEqual({ status: 401, body: { error: "Not signed in" } });
  });

  it("ignores the old email header, so it can't be forged", async () => {
    const { SELF } = await import("cloudflare:test");
    const res = await SELF.fetch("https://rope.example.com/api/tags", {
      headers: { "cf-access-authenticated-user-email": "me@example.com" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid Access token", async () => {
    const { SELF } = await import("cloudflare:test");
    const res = await SELF.fetch("https://rope.example.com/api/tags", {
      headers: { "cf-access-jwt-assertion": "a.b.c" },
    });
    expect(res.status).toBe(401);
  });
});

describe("findOrCreateUser", () => {
  it("creates a user once, then returns the same one", async () => {
    const first = await findOrCreateUser(env.DB, "new@example.com");
    const second = await findOrCreateUser(env.DB, "new@example.com");
    expect(first?.id).toBeTruthy();
    expect(second).toEqual(first);
    const { n } = /** @type {{ n: number }} */ (await sql("SELECT count(*) AS n FROM users WHERE email = ?", "new@example.com").first());
    expect(n).toBe(1);
  });
});
