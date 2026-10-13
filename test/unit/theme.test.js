// Light/dark mode choice (public/js/theme.js). No DOM needed.
import { describe, it, expect } from "vitest";
import { parseChoice, shownTheme, nextChoice } from "../../public/js/theme.js";

describe("parseChoice", () => {
  it("accepts only light or dark", () => {
    expect(parseChoice("light")).toBe("light");
    expect(parseChoice("dark")).toBe("dark");
    for (const value of [null, undefined, "", "Dark", "auto"]) expect(parseChoice(value)).toBeNull();
  });
});

describe("shownTheme", () => {
  it("follows the device without a choice", () => {
    expect(shownTheme(null, true)).toBe("dark");
    expect(shownTheme(null, false)).toBe("light");
  });
  it("uses the choice over the device", () => {
    expect(shownTheme("light", true)).toBe("light");
    expect(shownTheme("dark", false)).toBe("dark");
  });
});

describe("nextChoice", () => {
  it("picks the other mode when it differs from the device", () => {
    expect(nextChoice("light", false)).toBe("dark");
    expect(nextChoice("dark", true)).toBe("light");
  });
  it("goes back to following the device when the other mode is the device's", () => {
    expect(nextChoice("dark", false)).toBeNull();
    expect(nextChoice("light", true)).toBeNull();
  });
});
