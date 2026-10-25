import { describe, it, expect } from "vitest";
import { aboutField } from "../../public/js/person-about.js";

describe("aboutField", () => {
  it("is About me on my own profile, editable, even while empty", () => {
    expect(aboutField({ is_self: 1, about: null })).toEqual(expect.objectContaining({ label: "About me", readOnly: false }));
    expect(aboutField({ is_self: true, about: "Rigger" })?.readOnly).toBe(false);
  });

  it("shows what someone else shared, read-only, and when", () => {
    expect(aboutField({ is_self: 0, about: "Rigger", about_shared_on: "2026-10-24" }, "en-US"))
      .toEqual({ label: "About them", hint: "Shared by them on Oct 24, 2026", readOnly: true });
    // From before the date was kept (or an import of one).
    expect(aboutField({ is_self: 0, about: "Rigger", about_shared_on: null })?.hint).toBe("Shared by them.");
  });

  it("is hidden on someone else's card with nothing shared, and when adding a person", () => {
    expect(aboutField({ is_self: 0, about: null })).toBeNull();
    expect(aboutField({ is_self: 0, about: "" })).toBeNull();
    expect(aboutField(null)).toBeNull();
  });
});
