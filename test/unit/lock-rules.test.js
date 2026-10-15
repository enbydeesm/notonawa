import { describe, it, expect } from "vitest";
import { lockReason, IDLE_LIMIT_MS, HIDDEN_LIMIT_MS } from "../../public/js/lock-rules.js";

const MIN = 60 * 1000;
const NOW = 1_000_000_000;

describe("lockReason", () => {
  it("locks after 15 minutes without use", () => {
    expect(IDLE_LIMIT_MS).toBe(15 * MIN);
    expect(lockReason({ now: NOW, lastActivity: NOW - 14 * MIN, hiddenSince: null })).toBeNull();
    expect(lockReason({ now: NOW, lastActivity: NOW - 15 * MIN, hiddenSince: null })).toBe("idle");
  });

  it("locks after 5 minutes hidden, even if used just before", () => {
    expect(HIDDEN_LIMIT_MS).toBe(5 * MIN);
    expect(lockReason({ now: NOW, lastActivity: NOW - 4 * MIN, hiddenSince: NOW - 4 * MIN })).toBeNull();
    expect(lockReason({ now: NOW, lastActivity: NOW - 5 * MIN, hiddenSince: NOW - 5 * MIN })).toBe("hidden");
  });

  it("counts a long time hidden as found on return (timers slowed in the background)", () => {
    expect(lockReason({ now: NOW, lastActivity: NOW - 60 * MIN, hiddenSince: NOW - 60 * MIN })).toBe("hidden");
  });
});
