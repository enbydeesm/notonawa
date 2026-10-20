import { describe, it, expect } from "vitest";
import { call, createOtherUser, sessionCookieFor, signedInUser, sql } from "../helpers.js";
import { FEEDBACK_PER_DAY } from "../../src/feedback/parse.js";

const BODY = { kind: "bug", message: "The sort button is backwards", app_version: "2026.10.20.001" };

describe("POST /api/feedback", () => {
  it("saves a report with my id, its version and when it was sent", async () => {
    const me = await signedInUser();
    expect(await call("/api/feedback", { method: "POST", body: BODY })).toEqual({ status: 201, body: {} });
    const row = await sql("SELECT user_id, kind, message, app_version, created_at FROM feedback").first();
    expect(row).toEqual({ ...BODY, user_id: me.id, created_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/) });
  });

  it("refuses one without a kind or a message", async () => {
    expect((await call("/api/feedback", { method: "POST", body: { ...BODY, kind: "" } })).status).toBe(400);
    expect((await call("/api/feedback", { method: "POST", body: { ...BODY, message: " " } })).status).toBe(400);
  });

  it(`takes up to ${FEEDBACK_PER_DAY} a day from each account`, async () => {
    const cookie = await sessionCookieFor(await createOtherUser());
    for (let i = 0; i < FEEDBACK_PER_DAY; i++) {
      expect((await call("/api/feedback", { method: "POST", body: BODY, cookie })).status).toBe(201);
    }
    const over = await call("/api/feedback", { method: "POST", body: BODY, cookie });
    expect(over.status).toBe(429);
    expect(over.body.error).toMatch("Email us instead");
    // Someone else's count is their own.
    const other = await sessionCookieFor(await createOtherUser());
    expect((await call("/api/feedback", { method: "POST", body: BODY, cookie: other })).status).toBe(201);
  });

  it("needs to be signed in", async () => {
    expect((await call("/api/feedback", { method: "POST", body: BODY, cookie: null })).status).toBe(401);
  });
});
