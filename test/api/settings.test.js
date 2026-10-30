import { describe, it, expect } from "vitest";
import { call, createOtherUser, sessionCookieFor, signedInUser } from "../helpers.js";

describe("account settings", () => {
  it("starts on the defaults, and saves only what's sent", async () => {
    await signedInUser();
    expect((await call("/api/account/settings")).body).toEqual({ top_label: null, bottom_label: null, theme: null, seen_release: null, hide_welcome: false, default_shape: null });

    const saved = await call("/api/account/settings", { method: "PUT", body: { top_label: " rigger ", theme: "light" } });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ top_label: "rigger", bottom_label: null, theme: "light", seen_release: null, hide_welcome: false, default_shape: null });

    await call("/api/account/settings", { method: "PUT", body: { bottom_label: "bunny" } });
    expect((await call("/api/account/settings")).body).toEqual({ top_label: "rigger", bottom_label: "bunny", theme: "light", seen_release: null, hide_welcome: false, default_shape: null });

    // Empty goes back to the default.
    await call("/api/account/settings", { method: "PUT", body: { top_label: "", bottom_label: "Bottom" } });
    expect((await call("/api/account/settings")).body).toEqual({ top_label: null, bottom_label: null, theme: "light", seen_release: null, hide_welcome: false, default_shape: null });
  });

  it("remembers the last release notes seen, leaving the rest alone", async () => {
    await signedInUser();
    const cookie = await sessionCookieFor(await createOtherUser());
    const saved = await call("/api/account/settings", { method: "PUT", body: { seen_release: "2026.10.19.001" }, cookie });
    expect(saved.body).toEqual({ top_label: null, bottom_label: null, theme: null, seen_release: "2026.10.19.001", hide_welcome: false, default_shape: null });
    expect((await call("/api/account/settings", { cookie })).body.seen_release).toBe("2026.10.19.001");
    expect((await call("/api/account/settings", { method: "PUT", body: { seen_release: "newest" }, cookie })).status).toBe(400);
    // Another account's is its own.
    expect((await call("/api/account/settings")).body.seen_release).toBe(null);
  });

  it("remembers \"Don't show this again\" on the welcome, for every account until it's ticked", async () => {
    await signedInUser();
    expect((await call("/api/account/settings")).body.hide_welcome).toBe(false);
    const saved = await call("/api/account/settings", { method: "PUT", body: { hide_welcome: true } });
    expect(saved.body.hide_welcome).toBe(true);
    expect((await call("/api/account/settings")).body.hide_welcome).toBe(true);
    expect((await call("/api/account/settings", { method: "PUT", body: { hide_welcome: "yes" } })).status).toBe(400);
    const other = await createOtherUser();
    expect((await call("/api/account/settings", { cookie: await sessionCookieFor(other) })).body.hide_welcome).toBe(false);
  });

  it("keeps the poser's default body for the account, and refuses one the sliders don't have", async () => {
    await signedInUser();
    expect((await call("/api/account/settings")).body.default_shape).toBe(null);
    const saved = await call("/api/account/settings", { method: "PUT", body: { default_shape: [20, 70, 60, 165] } });
    expect(saved.body.default_shape).toEqual([20, 70, 60, 165]);
    expect((await call("/api/account/settings")).body.default_shape).toEqual([20, 70, 60, 165]);
    expect((await call("/api/account/settings", { method: "PUT", body: { default_shape: [20, 70, 60, 300] } })).status).toBe(400);
    const other = await createOtherUser();
    expect((await call("/api/account/settings", { cookie: await sessionCookieFor(other) })).body.default_shape).toBe(null);
    await call("/api/account/settings", { method: "PUT", body: { default_shape: null } });
    expect((await call("/api/account/settings")).body.default_shape).toBe(null);
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
