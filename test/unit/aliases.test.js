import { describe, it, expect } from "vitest";
import { PLATFORMS, tidyAliases, readAliases, aliasesText, sceneFirst, akaText, personMatch } from "../../public/js/aliases.js";

/** @typedef {import("../../public/js/aliases.js").Alias} Alias */

/** @type {Alias[]} */
const kitty = [
  { platform: "fetlife", alias: "rawkitty" },
  { platform: "scene", alias: "therawkitty" },
  { platform: "instagram", alias: "@rawk" },
];

describe("aliases", () => {
  it("offers the platforms in the form's order", () => {
    expect(PLATFORMS.map((p) => p.label)).toEqual(["Scene name", "FetLife", "Instagram", "X/Twitter", "Bluesky", "Other"]);
  });

  it("tidies a list: trims names, drops empty ones and anything that isn't one, reads an unknown platform as other", () => {
    expect(tidyAliases([
      { platform: "scene", alias: "  the  kitty " }, { platform: "x", alias: "  " }, null, "kitty",
      { platform: "myspace", alias: "k" }, { platform: "bluesky" },
    ])).toEqual([{ platform: "scene", alias: "the kitty" }, { platform: "other", alias: "k" }]);
    expect(tidyAliases("not a list")).toEqual([]);
  });

  it("saves JSON text, or null for none, and reads it back; damaged text reads as none", () => {
    const text = aliasesText(kitty);
    expect(readAliases(text)).toEqual(kitty);
    expect(aliasesText([{ platform: "scene", alias: " " }])).toBeNull();
    expect(readAliases(null)).toEqual([]);
    expect(readAliases("{oops")).toEqual([]);
    expect(readAliases('{"platform":"scene"}')).toEqual([]);
  });

  it("puts scene names first, the rest as entered", () => {
    expect(sceneFirst(kitty).map((a) => a.alias)).toEqual(["therawkitty", "rawkitty", "@rawk"]);
  });

  it("writes the aka line, scene names first, others with their platform", () => {
    expect(akaText(kitty)).toBe("aka therawkitty · fetlife: rawkitty · instagram: @rawk");
    /** @type {Alias[]} */
    const others = [{ platform: "other", alias: "Kit" }, { platform: "x", alias: "@k" }];
    expect(akaText(others)).toBe("aka Kit · x: @k");
    expect(akaText([])).toBeNull();
  });

  describe("personMatch", () => {
    it("a name match with no aliases: just the name", () => {
      expect(personMatch("J", [], "j")).toEqual({ matches: true, label: "J" });
      expect(personMatch("J", [{ platform: "fetlife", alias: "zed" }], "j")).toEqual({ matches: true, label: "J" });
    });

    it("a name match with a scene name: the name and the (first) scene name", () => {
      /** @type {Alias[]} */
      const two = [...kitty, { platform: "scene", alias: "kit" }];
      expect(personMatch("Jude", two, "JU")).toEqual({ matches: true, label: "Jude (therawkitty)" });
      expect(personMatch("Jude", two, "")).toEqual({ matches: true, label: "Jude (therawkitty)" });
    });

    it("an alias match, ignoring capitals: the name and that alias, even if the name matches too", () => {
      expect(personMatch("J", kitty, "@RA")).toEqual({ matches: true, label: "J (@rawk)" });
      expect(personMatch("Rawley", kitty, "raw")).toEqual({ matches: true, label: "Rawley (therawkitty)" });
      expect(personMatch("Jude", kitty, " rawk ")).toEqual({ matches: true, label: "Jude (therawkitty)" });
      expect(personMatch("Jude", kitty, "kitty")).toEqual({ matches: true, label: "Jude (therawkitty)" });
    });

    it("no match", () => {
      expect(personMatch("Jude", kitty, "zz").matches).toBe(false);
    });
  });
});
