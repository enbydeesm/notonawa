import { describe, it, expect } from "vitest";
import { env, createScheduledController } from "cloudflare:test";
import worker from "../../src/index.js";
import { createOtherUser, sessionCookieFor, sql } from "../helpers.js";
import { isoAt } from "../../src/auth/session.js";

const DAY = 24 * 60 * 60 * 1000;

describe("daily cleanup", () => {
  it("deletes expired and idle sessions and expired challenges, and keeps the rest", async () => {
    const id = await createOtherUser();
    const now = Date.now();
    await sessionCookieFor(id); // active
    await sessionCookieFor(id, { expiresAt: isoAt(now - 1000) }); // expired
    await sessionCookieFor(id, { lastUsedAt: isoAt(now - 8 * DAY) }); // idle over 7 days
    // A recovery session isn't ended by idleness, only by its short expiry.
    await sessionCookieFor(id, { kind: "recovery", lastUsedAt: isoAt(now - 8 * DAY) });
    await sql("INSERT INTO auth_challenges (challenge, purpose, expires_at) VALUES ('old', 'login', ?)", isoAt(now - 1000)).run();
    await sql("INSERT INTO auth_challenges (challenge, purpose, expires_at) VALUES ('new', 'login', ?)", isoAt(now + 60000)).run();

    await worker.scheduled(createScheduledController(), env);

    const sessions = await sql("SELECT kind FROM sessions WHERE user_id = ? ORDER BY kind", id).all();
    expect(sessions.results).toEqual([{ kind: "full" }, { kind: "recovery" }]);
    const challenges = await sql("SELECT challenge FROM auth_challenges").all();
    expect(challenges.results).toEqual([{ challenge: "new" }]);
  });
});
