import { describe, it, expect } from "vitest";
import { parseSettings, MAX_ROLE_NAME } from "../../src/account/settings.js";

const DEFAULTS = { top_label: null, bottom_label: null, theme: null, seen_release: null, hide_welcome: false };

describe("parseSettings", () => {
  it("changes only what's sent", () => {
    expect(parseSettings({ theme: "light" }, DEFAULTS)).toEqual({ theme: "light" });
    expect(parseSettings({ top_label: "rigger" }, DEFAULTS)).toEqual({ top_label: "rigger" });
    expect(parseSettings({ top_label: "  rope   top ", bottom_label: "bunny" }, DEFAULTS))
      .toEqual({ top_label: "rope top", bottom_label: "bunny" });
  });

  it("stores the default as null: empty, or the role's own name in any case", () => {
    expect(parseSettings({ top_label: "", bottom_label: null }, DEFAULTS)).toEqual({ top_label: null, bottom_label: null });
    expect(parseSettings({ top_label: "Top", bottom_label: " BOTTOM " }, DEFAULTS)).toEqual({ top_label: null, bottom_label: null });
  });

  it("refuses two roles with the same name, counting what's already saved", () => {
    expect(() => parseSettings({ top_label: "rope", bottom_label: "Rope" }, DEFAULTS)).toThrow("different names");
    expect(() => parseSettings({ top_label: "bottom" }, DEFAULTS)).toThrow("different names");
    expect(() => parseSettings({ bottom_label: "rigger" }, { ...DEFAULTS, top_label: "rigger" })).toThrow("different names");
    // Swapping both at once is fine.
    expect(parseSettings({ top_label: "bottom", bottom_label: "top" }, DEFAULTS)).toEqual({ top_label: "bottom", bottom_label: "top" });
  });

  it("refuses the other roles' names, long names, non-text and unknown themes", () => {
    expect(() => parseSettings({ top_label: "Self tie" }, DEFAULTS)).toThrow("already a role");
    expect(() => parseSettings({ bottom_label: "spotter" }, DEFAULTS)).toThrow("already a role");
    expect(() => parseSettings({ top_label: "x".repeat(MAX_ROLE_NAME + 1) }, DEFAULTS)).toThrow(`${MAX_ROLE_NAME} characters`);
    expect(parseSettings({ top_label: "x".repeat(MAX_ROLE_NAME) }, DEFAULTS)).toEqual({ top_label: "x".repeat(MAX_ROLE_NAME) });
    expect(() => parseSettings({ top_label: 5 }, DEFAULTS)).toThrow("should be text");
    expect(() => parseSettings({ theme: "blue" }, DEFAULTS)).toThrow("light or dark");
    expect(() => parseSettings({}, DEFAULTS)).toThrow("Nothing to change");
  });

  it("takes the last release seen, only as a version", () => {
    expect(parseSettings({ seen_release: "2026.10.19.001" }, DEFAULTS)).toEqual({ seen_release: "2026.10.19.001" });
    for (const bad of ["2026.10.19.01", "2026-10-19.001", "latest", 2026, null]) {
      expect(() => parseSettings({ seen_release: bad }, DEFAULTS)).toThrow("isn't a version");
    }
  });

  it("takes whether to hide the welcome, only as true or false", () => {
    expect(parseSettings({ hide_welcome: true }, DEFAULTS)).toEqual({ hide_welcome: true });
    expect(parseSettings({ hide_welcome: false }, DEFAULTS)).toEqual({ hide_welcome: false });
    for (const bad of [1, "true", null]) {
      expect(() => parseSettings({ hide_welcome: bad }, DEFAULTS)).toThrow("show the welcome");
    }
  });
});
