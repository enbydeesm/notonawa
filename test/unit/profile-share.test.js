import { describe, it, expect } from "vitest";
import { buildProfile, readProfile, suggestedName, LIMITS } from "../../public/js/profile-share.js";

const ME = { name: "Me", pronouns: "they/them", default_role: "top", based_in: "Seattle, WA", is_educator: 1, about: "Rigger, mostly floor", notes: "private!" };
/** @type {import("../../public/js/aliases.js").Alias[]} */
const MY_ALIASES = [{ platform: "scene", alias: "knotjude" }, { platform: "instagram", alias: "@jude" }];
const ALL = { name: "Jude", pronouns: true, default_role: true, aliases: [0, 1], based_in: true, is_educator: true, about: true };

describe("buildProfile", () => {
  it("shares the name typed in and what was ticked, never the private notes", () => {
    const profile = buildProfile(ME, MY_ALIASES, ALL);
    expect(profile).toEqual({
      v: 1, name: "Jude", pronouns: "they/them", default_role: "top", aliases: MY_ALIASES, based_in: "Seattle, WA",
      is_educator: true, about: "Rigger, mostly floor",
    });
    expect(JSON.stringify(profile)).not.toContain("private");
  });

  it("leaves out what wasn't ticked, and empty fields", () => {
    expect(buildProfile(ME, MY_ALIASES, { ...ALL, pronouns: false, default_role: false, aliases: [1], about: false, is_educator: false }))
      .toEqual({ v: 1, name: "Jude", aliases: [MY_ALIASES[1]], based_in: "Seattle, WA" });
    expect(buildProfile({ ...ME, pronouns: " ", default_role: null, is_educator: 0 }, [], ALL)).toEqual({
      v: 1, name: "Jude", based_in: "Seattle, WA", about: "Rigger, mostly floor",
    });
  });

  it("needs a name", () => {
    expect(() => buildProfile(ME, [], { ...ALL, name: "  " })).toThrow("name to share");
  });
});

describe("readProfile", () => {
  it("reads what buildProfile makes", () => {
    const profile = buildProfile(ME, MY_ALIASES, ALL);
    expect(readProfile(JSON.parse(JSON.stringify(profile)))).toEqual(profile);
  });

  it("isn't fooled by what another account could send", () => {
    for (const bad of [null, "Jude", [], { v: 2, name: "Jude" }, { v: 1 }, { v: 1, name: "" }, { v: 1, name: 5 },
      { v: 1, name: "x".repeat(LIMITS.name + 1) }]) {
      expect(readProfile(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(readProfile({
      v: 1, name: " Jude ", pronouns: 7, default_role: "boss", based_in: "x".repeat(LIMITS.based_in + 1), is_educator: "yes", about: { html: "<b>" },
      notes: "not wanted", is_self: true, aliases: [{ platform: "scene", alias: "ok" }, { platform: "evil", alias: "other" }, "junk",
        { platform: "scene", alias: "x".repeat(LIMITS.alias + 1) }],
    })).toEqual({ v: 1, name: "Jude", aliases: [{ platform: "scene", alias: "ok" }, { platform: "other", alias: "other" }] });
  });

  it("takes at most 30 social and scene names", () => {
    const aliases = Array.from({ length: 40 }, (_, i) => ({ platform: "scene", alias: `n${i}` }));
    expect(readProfile({ v: 1, name: "Jude", aliases })?.aliases).toHaveLength(LIMITS.aliases);
  });
});

describe("suggestedName", () => {
  it("suggests my profile's name, unless it's still Me", () => {
    expect(suggestedName("Jude")).toBe("Jude");
    expect(suggestedName(" me ")).toBe("");
    expect(suggestedName("Me")).toBe("");
    expect(suggestedName("Meg")).toBe("Meg");
  });
});
