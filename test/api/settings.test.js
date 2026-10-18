import { describe, it, expect } from "vitest";
import { call, createOtherUser, sessionCookieFor, signedInUser } from "../helpers.js";

describe("account settings", () => {
  it("starts on the defaults, and saves only what's sent", async () => {
    await signedInUser();
    expect((await call("/api/account/settings")).body).toEqual({ top_label: null, bottom_label: null, theme: null });

    const saved = await call("/api/account/settings", { method: "PUT", body: { top_label: " rigger ", theme: "light" } });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ top_label: "rigger", bottom_label: null, theme: "light" });

    await call("/api/account/settings", { method: "PUT", body: { bottom_label: "bunny" } });
    expect((await call("/api/account/settings")).body).toEqual({ top_label: "rigger", bottom_label: "bunny", theme: "light" });

    // Empty goes back to the default.
    await call("/api/account/settings", { method: "PUT", body: { top_label: "", bottom_label: "Bottom" } });
    expect((await call("/api/account/settings")).body).toEqual({ top_label: null, bottom_label: null, theme: "light" });
  });

  it("refuses names that clash, with what's already saved too", async () => {
    await signedInUser();
    await call("/api/account/settings", { method: "PUT", body: { top_label: "rigger" } });
    const clash = await call("/api/account/settings", { method: "PUT", body: { bottom_label: "Rigger" } });
    expect(clash.status).toBe(400);
    expect(clash.body.error).toMatch("different names");
    expect((await call("/api/account/settings", { method: "PUT", body: { theme: "sepia" } })).status).toBe(400);
  });

  it("is each account's own", async () => {
    await signedInUser();
    await call("/api/account/settings", { method: "PUT", body: { top_label: "rigger" } });
    const other = await createOtherUser();
    const theirs = await call("/api/account/settings", { cookie: await sessionCookieFor(other) });
    expect(theirs.body.top_label).toBeNull();
  });

  it("can be read in a recovery session, but not changed", async () => {
    const me = await signedInUser();
    const cookie = await sessionCookieFor(me.id, { kind: "recovery" });
    expect((await call("/api/account/settings", { cookie })).status).toBe(200);
    expect((await call("/api/account/settings", { method: "PUT", body: { theme: "dark" }, cookie })).status).toBe(403);
  });
});
