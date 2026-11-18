// The Worker's main module exports only its handlers: the runtime refuses
// to start with any other export (a constant exported from src/index.js
// once stopped wrangler dev, and would have stopped the deploy).
import { describe, it, expect } from "vitest";

describe("src/index.js", () => {
  it("exports only the default handlers", async () => {
    const main = await import("../../src/index.js");
    expect(Object.keys(main)).toEqual(["default"]);
    expect(Object.keys(main.default).sort()).toEqual(["fetch", "scheduled"]);
  });
});
