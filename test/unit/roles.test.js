// The words shown for roles (public/js/roles.js). No DOM needed.
import { describe, it, expect, afterEach } from "vitest";
import {
  namesFrom, setRoleNames, roleNames, roleName, roleOptions, roleFromName, namesToAdopt, DEFAULT_NAMES,
  workshopRoleOptions, roleAfterPick,
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

describe("workshop roles", () => {
  it("are the tie roles and Audit, which ties don't offer", () => {
    expect(workshopRoleOptions(RIGGER).map((r) => r.label)).toEqual(["Rigger", "Rope bunny", "Self tie", "Spotter", "Photographer", "Audit"]);
    expect(roleOptions(RIGGER).map((r) => r.value)).not.toContain("audit");
  });
});

describe("a role once a person's picked", () => {
  it("is their usual role if they have one, or else the one already chosen", () => {
    expect(roleAfterPick("", "bottom")).toBe("bottom");
    expect(roleAfterPick("top", "bottom")).toBe("bottom");
    expect(roleAfterPick("top", undefined)).toBe("top");
    expect(roleAfterPick("audit", undefined)).toBe("audit");
    expect(roleAfterPick("", undefined)).toBe("");
    // A usual role the row doesn't offer leaves the chosen one.
    expect(roleAfterPick("spotter", "audit", ["top", "spotter"])).toBe("spotter");
  });
});
