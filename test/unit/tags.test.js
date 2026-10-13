// The "Edit tags" dialog's list logic (public/js/tags.js).
import { describe, it, expect } from "vitest";
import { filterTags, findTag, deleteTagWarning, SHOWN_TAGS } from "../../public/js/tags.js";

const tag = (/** @type {string} */ name) => ({ id: name, name, tie_count: 0 });

describe("filterTags", () => {
  const many = Array.from({ length: 20 }, (_, i) => tag(`tag${i}`));

  it("shows the first 15 in list order when nothing is typed", () => {
    expect(SHOWN_TAGS).toBe(15);
    expect(filterTags(many, "").map((t) => t.name)).toEqual(many.slice(0, 15).map((t) => t.name));
    expect(filterTags(many, "   ")).toHaveLength(15);
  });

  it("matches anywhere in the name, ignoring capitals, still at most 15", () => {
    const tags = [tag("Hip harness"), tag("Futomomo"), tag("Box tie"), tag("TK")];
    expect(filterTags(tags, " TI ").map((t) => t.name)).toEqual(["Box tie"]);
    expect(filterTags(tags, "h").map((t) => t.name)).toEqual(["Hip harness"]);
    expect(filterTags(many, "tag1")).toHaveLength(11);
    expect(filterTags(many, "tag", 3)).toHaveLength(3);
  });
});

describe("findTag", () => {
  const tags = [tag("floor"), tag("Floor"), tag("Futomomo")];

  it("prefers an exact match, then ignores capitals", () => {
    expect(findTag(tags, "Floor")?.name).toBe("Floor");
    expect(findTag(tags, "FUTOMOMO")?.name).toBe("Futomomo");
    expect(findTag(tags, "Box tie")).toBeUndefined();
  });
});

describe("deleteTagWarning", () => {
  it("says how many ties lose the tag", () => {
    expect(deleteTagWarning(0)).toBeUndefined();
    expect(deleteTagWarning(1)).toBe("Used on 1 tie; it'll be removed from it.");
    expect(deleteTagWarning(3)).toBe("Used on 3 ties; it'll be removed from them.");
  });
});
