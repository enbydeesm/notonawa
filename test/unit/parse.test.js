import { describe, it, expect } from "vitest";
import {
  cleanText, toIntOrNull, toNumberOrNull, toFlag, toChoiceOrNull, toUrlOrNull, toDateOrNull,
} from "../../src/parse.js";
import { BadInput } from "../../src/http.js";

describe("cleanText", () => {
  it("trims, and turns empty or missing values into null", () => {
    expect(cleanText("  hi  ")).toBe("hi");
    expect(cleanText("   ")).toBeNull();
    expect(cleanText("")).toBeNull();
    expect(cleanText(undefined)).toBeNull();
    expect(cleanText(null)).toBeNull();
    expect(cleanText(42)).toBe("42");
  });
});

describe("toIntOrNull", () => {
  it("accepts whole numbers in range, as numbers or strings", () => {
    expect(toIntOrNull("3", 1, 5)).toBe(3);
    expect(toIntOrNull(5, 1, 5)).toBe(5);
  });
  it("treats missing as null", () => {
    expect(toIntOrNull("", 1, 5)).toBeNull();
    expect(toIntOrNull(undefined, 1, 5)).toBeNull();
  });
  it("rejects out of range, fractions and text", () => {
    expect(() => toIntOrNull("6", 1, 5)).toThrow(BadInput);
    expect(() => toIntOrNull("2.5", 1, 5)).toThrow("whole number from 1 to 5");
    expect(() => toIntOrNull("abc", 1, 5)).toThrow(BadInput);
  });
});

describe("toNumberOrNull", () => {
  it("accepts decimals in range", () => {
    expect(toNumberOrNull("51.5", -90, 90)).toBe(51.5);
  });
  it("rejects out of range and non-numbers", () => {
    expect(() => toNumberOrNull("200", -90, 90)).toThrow("number from -90 to 90");
    expect(() => toNumberOrNull("Infinity", -90, 90)).toThrow(BadInput);
  });
});

describe("toFlag", () => {
  it("turns checkbox-style values into 0/1", () => {
    for (const yes of [true, 1, "1", "on", "true"]) expect(toFlag(yes)).toBe(1);
    for (const no of [false, 0, "0", "", undefined, null, "yes"]) expect(toFlag(no)).toBe(0);
  });
});

describe("toChoiceOrNull", () => {
  const choices = ["a", "b"];
  it("accepts listed choices and treats empty as null", () => {
    expect(toChoiceOrNull("a", choices)).toBe("a");
    expect(toChoiceOrNull("", choices)).toBeNull();
  });
  it("rejects anything else, listing the options", () => {
    expect(() => toChoiceOrNull("c", choices)).toThrow("Expected one of: a, b.");
  });
});

describe("toUrlOrNull", () => {
  it("accepts http and https links", () => {
    expect(toUrlOrNull("https://maps.app.goo.gl/abc")).toBe("https://maps.app.goo.gl/abc");
    expect(toUrlOrNull("http://example.com")).toBe("http://example.com/");
    expect(toUrlOrNull("")).toBeNull();
  });
  it("rejects links that could run script, and non-links", () => {
    expect(() => toUrlOrNull("javascript:alert(1)")).toThrow(BadInput);
    expect(() => toUrlOrNull("data:text/html,<script>")).toThrow(BadInput);
    expect(() => toUrlOrNull("not a link")).toThrow(BadInput);
  });
});

describe("toDateOrNull", () => {
  it("accepts real YYYY-MM-DD dates", () => {
    expect(toDateOrNull("2026-10-12")).toBe("2026-10-12");
    expect(toDateOrNull(" 2024-02-29 ")).toBe("2024-02-29");
    expect(toDateOrNull("")).toBeNull();
    expect(toDateOrNull(null)).toBeNull();
  });
  it("rejects other formats and dates that don't exist", () => {
    for (const bad of ["2026-02-30", "2025-02-29", "2026-13-01", "12/10/2026", "2026-1-5", "2026-10-12T00:00:00Z"]) {
      expect(() => toDateOrNull(bad)).toThrow(BadInput);
    }
  });
});
