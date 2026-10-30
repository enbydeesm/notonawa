import { describe, it, expect } from "vitest";
import { keepAwake } from "../../public/js/wake-lock.js";

/** A navigator whose wake lock counts what's asked for and let go. */
function fakes({ refuse = false } = {}) {
  const counts = { asked: 0, held: 0 };
  const nav = {
    wakeLock: {
      async request(/** @type {"screen"} */ type) {
        expect(type).toBe("screen");
        counts.asked++;
        if (refuse) throw new Error("NotAllowedError");
        counts.held++;
        return { async release() { counts.held--; } };
      },
    },
  };
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const show = (/** @type {"visible" | "hidden"} */ state) => {
    doc.visibilityState = state;
    // The browser lets the lock go itself when the page is hidden.
    if (state === "hidden") counts.held = 0;
    doc.dispatchEvent(new Event("visibilitychange"));
  };
  return { counts, nav, doc, show };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("keepAwake", () => {
  it("holds the lock until it's let go", async () => {
    const { counts, nav, doc } = fakes();
    const letSleep = keepAwake(nav, doc);
    await settle();
    expect(counts).toEqual({ asked: 1, held: 1 });
    letSleep();
    await settle();
    expect(counts.held).toBe(0);
  });

  it("asks again on coming back into view, and not once let go", async () => {
    const { counts, nav, doc, show } = fakes();
    const letSleep = keepAwake(nav, doc);
    await settle();
    show("hidden");
    show("visible");
    await settle();
    expect(counts).toEqual({ asked: 2, held: 1 });
    letSleep();
    show("hidden");
    show("visible");
    await settle();
    expect(counts.asked).toBe(2);
  });

  it("does nothing where there's no wake lock, or it's refused", async () => {
    const { doc } = fakes();
    expect(() => keepAwake({}, doc)()).not.toThrow();
    const refused = fakes({ refuse: true });
    const letSleep = keepAwake(refused.nav, refused.doc);
    await settle();
    expect(refused.counts).toEqual({ asked: 1, held: 0 });
    letSleep();
  });
});
