import { describe, it, expect } from "vitest";
import { fieldChoices, newAliases, mergedPerson, newPerson } from "../../public/js/contact-merge.js";

/** @type {import("../../public/js/contact-merge.js").Person} */
const MINE = {
  name: "Jude B", pronouns: "she/her", notes: "Met at Shibari Fest", default_role: "top", is_educator: 0,
  based_in: null, aliases: JSON.stringify([{ platform: "scene", alias: "knotjude" }]), about: "Old about",
};
/** @type {import("../../public/js/profile-share.js").SharedProfile} */
const THEIRS = {
  v: 1, name: "Jude", pronouns: "they/them", default_role: "bottom", based_in: "Seattle, WA", is_educator: true,
  about: "Rigger, mostly floor",
  aliases: [{ platform: "scene", alias: "KnotJude" }, { platform: "instagram", alias: "@jude" }],
};

describe("fieldChoices", () => {
  it("asks only where theirs differs, keeping my name for them and taking the rest of theirs", () => {
    expect(fieldChoices(MINE, THEIRS, (role) => role.toUpperCase())).toEqual([
      { field: "name", label: "Name", mine: "Jude B", theirs: "Jude", choice: "mine" },
      { field: "pronouns", label: "Pronouns", mine: "she/her", theirs: "they/them", choice: "theirs" },
      { field: "default_role", label: "Usual role", mine: "TOP", theirs: "BOTTOM", choice: "mine" },
      { field: "based_in", label: "Based in", mine: "", theirs: "Seattle, WA", choice: "theirs" },
      { field: "is_educator", label: "Educator", mine: "No", theirs: "Yes", choice: "theirs" },
    ]);
  });

  it("takes their usual role when I haven't set one for them", () => {
    expect(fieldChoices({ ...MINE, default_role: null }, THEIRS).find((c) => c.field === "default_role"))
      .toMatchObject({ mine: "", theirs: "bottom", choice: "theirs" });
  });

  it("doesn't ask about what they didn't share, or what's the same", () => {
    expect(fieldChoices({ ...MINE, name: "Jude", is_educator: 1 }, { v: 1, name: "Jude" })).toEqual([]);
  });
});

describe("newAliases", () => {
  it("is theirs that I don't have, ignoring capitals", () => {
    expect(newAliases(MINE, THEIRS)).toEqual([{ platform: "instagram", alias: "@jude" }]);
  });
});

describe("mergedPerson", () => {
  it("takes what was chosen, adds their new names, replaces About, and never touches my notes", () => {
    const choices = fieldChoices(MINE, THEIRS);
    expect(mergedPerson(MINE, THEIRS, choices, "add", "2026-10-24")).toEqual({
      name: "Jude B", pronouns: "they/them", notes: "Met at Shibari Fest", default_role: "top", is_educator: true,
      based_in: "Seattle, WA",
      aliases: JSON.stringify([{ platform: "scene", alias: "knotjude" }, { platform: "instagram", alias: "@jude" }]),
      about: "Rigger, mostly floor", about_shared_on: "2026-10-24",
    });
  });

  it("keeps mine where I chose to, and can replace or keep the names", () => {
    const keepAll = fieldChoices(MINE, THEIRS).map((c) => ({ ...c, choice: /** @type {const} */ ("mine") }));
    const kept = mergedPerson(MINE, THEIRS, keepAll, "keep", "2026-10-24");
    expect(kept).toMatchObject({ name: "Jude B", pronouns: "she/her", default_role: "top", is_educator: false, based_in: null, aliases: MINE.aliases });
    const role = fieldChoices(MINE, THEIRS).map((c) => ({ ...c, choice: /** @type {"mine" | "theirs"} */ (c.field === "default_role" ? "theirs" : "mine") }));
    expect(mergedPerson(MINE, THEIRS, role, "keep", "2026-10-24").default_role).toBe("bottom");
    expect(mergedPerson(MINE, THEIRS, keepAll, "replace", "2026-10-24").aliases).toBe(JSON.stringify(THEIRS.aliases));
  });

  it("keeps the card's About, and when it was shared, when they didn't share one this time", () => {
    const earlier = { ...MINE, about_shared_on: "2026-09-01" };
    expect(mergedPerson(earlier, { v: 1, name: "Jude" }, [], "keep", "2026-10-24"))
      .toMatchObject({ about: "Old about", about_shared_on: "2026-09-01" });
    expect(mergedPerson(MINE, { v: 1, name: "Jude" }, [], "keep", "2026-10-24")).toMatchObject({ about: "Old about", about_shared_on: null });
  });
});

describe("newPerson", () => {
  it("is their profile as a card, with their usual role and no notes", () => {
    expect(newPerson(THEIRS, "2026-10-24")).toEqual({
      name: "Jude", pronouns: "they/them", notes: null, default_role: "bottom", is_educator: true, based_in: "Seattle, WA",
      aliases: JSON.stringify(THEIRS.aliases), about: "Rigger, mostly floor", about_shared_on: "2026-10-24",
    });
    expect(newPerson({ v: 1, name: "Sam" }, "2026-10-24")).toEqual({
      name: "Sam", pronouns: null, notes: null, default_role: null, is_educator: false, based_in: null, aliases: null, about: null,
      about_shared_on: null,
    });
  });
});
