import { describe, it, expect } from "vitest";
import { parseFeedback, MAX_FEEDBACK_LENGTH } from "../../src/feedback/parse.js";

const GOOD = { kind: "bug", message: "  The + button does nothing  ", app_version: "2026.10.20.001" };

describe("parseFeedback", () => {
  it("takes a bug or an idea, its message trimmed, and the app's version", () => {
    expect(parseFeedback(GOOD)).toEqual({ kind: "bug", message: "The + button does nothing", app_version: "2026.10.20.001" });
    expect(parseFeedback({ ...GOOD, kind: "idea" }).kind).toBe("idea");
  });

  it("needs a kind: there's no default", () => {
    for (const kind of [undefined, "", "complaint", 1]) {
      expect(() => parseFeedback({ ...GOOD, kind })).toThrow("bug or an idea");
    }
  });

  it("needs a message, up to the limit", () => {
    for (const message of [undefined, "", "   ", 5]) expect(() => parseFeedback({ ...GOOD, message })).toThrow("Write a message");
    expect(parseFeedback({ ...GOOD, message: "x".repeat(MAX_FEEDBACK_LENGTH) }).message).toHaveLength(MAX_FEEDBACK_LENGTH);
    expect(() => parseFeedback({ ...GOOD, message: "x".repeat(MAX_FEEDBACK_LENGTH + 1) })).toThrow(`${MAX_FEEDBACK_LENGTH} characters`);
  });

  it("needs a version of the app", () => {
    for (const app_version of [undefined, "latest", "2026.10.20.1"]) {
      expect(() => parseFeedback({ ...GOOD, app_version })).toThrow("isn't a version");
    }
  });
});
