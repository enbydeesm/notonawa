// The words shown for roles (public/js/roles.js). No DOM needed.
import { describe, it, expect, afterEach } from "vitest";
import {
  namesFrom, setRoleNames, roleNames, roleName, roleOptions, roleFromName, namesToAdopt, DEFAULT_NAMES,
} from "../../public/js/roles.js";

const RIGGER = namesFrom({ top_label: "rigger", bottom_label: "rope bunny" });

describe("role names", () => {
  afterEach(() => setRoleNames(null));

  it("default to top and bottom, and use the account's when set", () => {
    expect(namesFrom(null)).toEqual(DEFAULT_NAMES);
    expect(namesFrom({ top_label: null, bottom_label: "" })).toEqual({ top: "top", bottom: "bottom" });
    expect(RIGGER).toEqual({ top: "rigger", bottom: "rope bunny" });
  });

  it("show top and bottom by the account's names, other roles as they are", () => {
    expect(roleName("top", RIGGER)).toBe("rigger");
    expect(roleName("bottom", RIGGER)).toBe("rope bunny");
    expect(roleName("self tie", RIGGER)).toBe("self tie");
    expect(roleName("top")).toBe("top");
    setRoleNames({ top_label: "rigger", bottom_label: null });
    expect(roleNames()).toEqual({ top: "rigger", bottom: "bottom" });
    expect(roleName("top")).toBe("rigger");
  });

  it("list the roles in order for drop-downs", () => {
    expect(roleOptions(RIGGER)).toEqual([
      { value: "top", label: "Rigger" }, { value: "bottom", label: "Rope bunny" },
      { value: "self tie", label: "Self tie" }, { value: "spotter", label: "Spotter" },
      { value: "photographer", label: "Photographer" },
    ]);
  });

  it("read typed names: mine first, then the roles' own, then rigger and model", () => {
    expect(roleFromName(" Rope  Bunny ", RIGGER)).toBe("bottom");
    expect(roleFromName("RIGGER", RIGGER)).toBe("top");
    expect(roleFromName("top", RIGGER)).toBe("top");
    expect(roleFromName("model")).toBe("bottom");
    expect(roleFromName("Self tie")).toBe("self tie");
    expect(roleFromName("chef")).toBeNull();
    // Swapped names: mine win over the roles' own.
    expect(roleFromName("top", namesFrom({ top_label: "bottom", bottom_label: "top" }))).toBe("bottom");
  });

  it("take an import's names only while still on the defaults", () => {
    const file = { top_label: "rigger", bottom_label: null };
    expect(namesToAdopt({ top_label: null, bottom_label: null }, file)).toEqual({ top: "rigger", bottom: "" });
    expect(namesToAdopt({ top_label: "dom", bottom_label: null }, file)).toBeNull();
    expect(namesToAdopt({ top_label: null, bottom_label: null }, null)).toBeNull();
  });
});
