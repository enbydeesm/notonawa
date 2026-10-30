import { describe, it, expect } from "vitest";
import { presetsToAdd } from "../../public/js/import-presets.js";

const arms = { joints: { l_elbow: [90, 0] } };
const body = { joints: {}, body: [0, 0, 0], lift: 99 };

describe("presetsToAdd", () => {
  it("adds the file's presets that aren't there by kind and name, once each", () => {
    const file = [
      { kind: "arms", name: " Boxtie ", data: arms, created_at: "x" },
      { kind: "body", name: "Boxtie", data: body },
      { kind: "arms", name: "Seiza", data: arms },
      { kind: "arms", name: "Boxtie", data: arms },
    ];
    expect(presetsToAdd(file, [{ kind: "arms", name: "Seiza" }, { kind: "arms", name: null }], 50)).toEqual({
      add: [{ kind: "arms", name: "Boxtie", data: arms }, { kind: "body", name: "Boxtie", data: body }], skipped: 2, full: 0,
    });
  });

  it("adds only as many as there's room for, and ignores what isn't a preset", () => {
    const file = [
      { kind: "arms", name: "A", data: arms }, { kind: "arms", name: "B", data: arms },
      { kind: "legs", name: "C", data: arms }, { kind: "arms", name: "", data: arms }, { kind: "arms", name: "D" }, null,
    ];
    expect(presetsToAdd(file, [], 1)).toEqual({ add: [{ kind: "arms", name: "A", data: arms }], skipped: 0, full: 1 });
    expect(presetsToAdd(undefined, [], 5)).toEqual({ add: [], skipped: 0, full: 0 });
  });
});
