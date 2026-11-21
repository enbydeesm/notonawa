import { describe, it, expect } from "vitest";
import { presetList } from "../../public/js/preset-list.js";
import { BODY_PRESETS, ARMS_PRESETS, inPreset, withBodyPreset, withArmsPreset, bodyPresetFrom, armsPresetFrom, startJoints } from "../../public/js/figure-rig.js";

/** The built-in body presets the checks use, by name (the list's order is only how the picker shows them). */
const named = (/** @type {string} */ name) => /** @type {import("../../public/js/figure-rig.js").BodyPreset} */ (BODY_PRESETS.find((p) => p.name === name));
const STANDING = named("Standing"), KNEELING = named("Kneeling (seiza)");

const lists = (/** @type {string[]} */ mine) => ({
  builtIn: ["Standing", "Kneeling up", "Face down"], builtInName: (/** @type {string} */ n) => n,
  mine, mineName: (/** @type {string} */ n) => n,
});

describe("presetList", () => {
  it("keeps the built-in ones in their order, and sorts mine alphabetically, ignoring capitals and reading numbers as numbers", () => {
    expect(presetList(lists(["tk", "Box 10", "Box 9", "Ankle"]))).toEqual({
      builtIn: ["Standing", "Kneeling up", "Face down"], mine: ["Ankle", "Box 9", "Box 10", "tk"],
    });
  });

  it("shows only names with what's typed, ignoring capitals and spaces around it", () => {
    expect(presetList(lists(["My kneel", "Boxtie"]), "  KNEEL ")).toEqual({ builtIn: ["Kneeling up"], mine: ["My kneel"] });
    expect(presetList(lists(["Boxtie"]), "nothing")).toEqual({ builtIn: [], mine: [] });
    expect(presetList(lists(["Boxtie"]), "   ").mine).toEqual(["Boxtie"]);
  });

  it("leaves the lists it's given as they were", () => {
    const mine = ["b", "a"];
    presetList(lists(mine));
    expect(mine).toEqual(["b", "a"]);
  });
});

describe("inPreset", () => {
  const standing = { joints: startJoints(), body: /** @type {[number, number, number]} */ ([0, 0, 0]), lift: 99 };

  it("knows a figure is in a built-in preset, its missing joints at rest", () => {
    expect(inPreset("body", standing, STANDING)).toBe(true);
    expect(inPreset("arms", standing, ARMS_PRESETS[0])).toBe(true);
    expect(inPreset("body", standing, KNEELING)).toBe(false);
    expect(inPreset("arms", standing, ARMS_PRESETS[1])).toBe(false);
  });

  it("knows it's in a preset once it's put in it, and not once a joint moves", () => {
    for (const preset of BODY_PRESETS) {
      const posed = withBodyPreset(standing, preset);
      expect(inPreset("body", posed, preset), preset.name).toBe(true);
      // Saved from the figure, it matches too.
      const { name: _n, ...saved } = bodyPresetFrom(posed, "");
      expect(inPreset("body", posed, saved)).toBe(true);
      const moved = { ...posed, joints: { ...posed.joints, head: [posed.joints.head[0] + 5, 0, 0] } };
      expect(inPreset("body", moved, preset)).toBe(false);
    }
    for (const preset of ARMS_PRESETS) {
      const posed = { ...standing, ...withArmsPreset(standing, preset) };
      expect(inPreset("arms", posed, preset), preset.name).toBe(true);
      const { name: _n, ...saved } = armsPresetFrom(posed, "");
      expect(inPreset("arms", posed, saved)).toBe(true);
    }
  });

  it("ignores the other kind's joints, and tiny differences", () => {
    const boxtie = withArmsPreset(standing, ARMS_PRESETS[1]);
    expect(inPreset("body", boxtie, STANDING)).toBe(true);
    const nudged = { ...standing, lift: 99.01 };
    expect(inPreset("body", nudged, STANDING)).toBe(true);
    expect(inPreset("body", { ...standing, lift: 100 }, STANDING)).toBe(false);
  });
});
