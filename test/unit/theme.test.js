// Light/dark mode choice (public/js/theme.js). No DOM needed.
import { describe, it, expect } from "vitest";
import { parseChoice, shownTheme, otherTheme, DEFAULT_THEME } from "../../public/js/theme.js";

describe("parseChoice", () => {
  it("accepts only light or dark", () => {
    expect(parseChoice("light")).toBe("light");
    expect(parseChoice("dark")).toBe("dark");
    for (const value of [null, undefined, "", "Dark", "auto"]) expect(parseChoice(value)).toBeNull();
  });
});

describe("shownTheme", () => {
  it("is dark without a choice, whatever the device", () => {
    expect(DEFAULT_THEME).toBe("dark");
    expect(shownTheme(null)).toBe("dark");
  });
  it("uses the choice", () => {
    expect(shownTheme("light")).toBe("light");
    expect(shownTheme("dark")).toBe("dark");
  });
});

describe("otherTheme", () => {
  it("switches between the two", () => {
    expect(otherTheme("light")).toBe("dark");
    expect(otherTheme("dark")).toBe("light");
  });
});
