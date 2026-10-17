import { describe, it, expect } from "vitest";
import { RESOURCES, parseFields, checkEdit, parseArchivedFilter } from "../../src/resources/config.js";

describe("parseFields", () => {
  it("parses every field, in order, with defaults", () => {
    expect(parseFields(RESOURCES.plans, { title: "Hip harness", est_difficulty: "3" })).toEqual({
      columns: ["title", "stage", "description", "notes", "est_difficulty", "variation_of", "plan_type"],
      values: ["Hip harness", "idea", null, null, 3, null, "idea"],
    });
  });

  it("requires the name or title, with a friendly message", () => {
    expect(() => parseFields(RESOURCES.plans, {})).toThrow("Give the plan a title.");
    expect(() => parseFields(RESOURCES.people, { name: "  " })).toThrow("Give the person a name.");
    expect(() => parseFields(RESOURCES.locations, {})).toThrow("Give the location a name.");
  });

  it("validates each field", () => {
    expect(() => parseFields(RESOURCES.plans, { title: "x", stage: "bogus" })).toThrow("Expected one of");
    expect(() => parseFields(RESOURCES.locations, { name: "x", maps_url: "javascript:alert(1)" })).toThrow("https://");
    expect(() => parseFields(RESOURCES.locations, { name: "x", longitude: 181 })).toThrow("-180 to 180");
  });

  it("reads a plan's type, idea by default, and a location's default flag", () => {
    expect(parseFields(RESOURCES.plans, { title: "x", plan_type: "sequence" }).values.at(-1)).toBe("sequence");
    expect(() => parseFields(RESOURCES.plans, { title: "x", plan_type: "stage" })).toThrow("Expected one of");
    expect(parseFields(RESOURCES.locations, { name: "x", is_default: true }).values.at(-1)).toBe(1);
    // A plan's stage is no longer on the form, so edits leave it alone.
    expect(parseFields(RESOURCES.plans, { title: "x" }, { editing: true }).columns).not.toContain("stage");
  });

  it("leaves out create-only fields when editing: an edit can't change who is me", () => {
    expect(parseFields(RESOURCES.people, { name: "Sam", is_self: true }).columns).toContain("is_self");
    const edit = parseFields(RESOURCES.people, { name: "Sam", is_self: true }, { editing: true });
    expect(edit.columns).toEqual(["name", "pronouns", "notes", "default_role"]);
    expect(edit.values).toEqual(["Sam", null, null, null]);
  });

  it("ignores fields that aren't part of the resource", () => {
    const { columns } = parseFields(RESOURCES.people, { name: "Sam", owner_id: "someone-else", archived_at: "x" });
    expect(columns).toEqual(["name", "pronouns", "notes", "is_self", "default_role"]);
  });
});

describe("checkEdit", () => {
  it("stops a plan being a variation of itself", () => {
    const fields = parseFields(RESOURCES.plans, { title: "x", variation_of: "plan1" });
    expect(() => checkEdit("plans", "plan1", fields)).toThrow("variation of itself");
    expect(() => checkEdit("plans", "plan2", fields)).not.toThrow();
  });
});

describe("parseArchivedFilter", () => {
  it("accepts true, false and all", () => {
    expect(parseArchivedFilter("true")).toBe("true");
    expect(parseArchivedFilter("false")).toBe("false");
    expect(parseArchivedFilter("all")).toBe("all");
  });
  it("is required: anything else is an error", () => {
    for (const bad of [null, "", "1", "0", "null", "TRUE", "yes"]) {
      expect(() => parseArchivedFilter(bad)).toThrow("archived=false");
    }
  });
});
