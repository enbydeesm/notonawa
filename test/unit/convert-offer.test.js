// When a format 1 account converts (public/js/convert/offer.js), and what
// the conversion's progress says.
import { describe, it, expect } from "vitest";
import { conversionWanted, progressText } from "../../public/js/convert/offer.js";

describe("conversionWanted", () => {
  it("is where the server says, or once a conversion has started, and never for format 2", () => {
    expect(conversionWanted({ format: 1, converting: false, convert: true })).toBe(true);
    expect(conversionWanted({ format: 1, converting: false, convert: false })).toBe(false);
    // Started (here, or on another device) before the switch went off: it carries on.
    expect(conversionWanted({ format: 1, converting: true, convert: false })).toBe(true);
    expect(conversionWanted({ format: 2, converting: false, convert: true })).toBe(false);
    expect(conversionWanted(null)).toBe(false);
  });
});

describe("progressText", () => {
  it("says where it's got to", () => {
    expect(progressText({ stage: "photos", done: 12, total: 32 })).toBe("Photos and videos: 12 of 32");
    expect(progressText({ stage: "entries", done: 40, total: 61 })).toBe("Entries: 40 of 61");
    expect(progressText({ stage: "reading", done: 0, total: 1 })).toBe("Reading your journal…");
  });
});
