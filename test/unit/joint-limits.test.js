// The shoulders' and hips' limits that depend on several movements
// (joint-limits.js): the poser always keeps to them, whether or not it
// allows collisions (the server checks only each movement's own range).
import { describe, it, expect } from "vitest";
import { raised, canReach, withinReach } from "../../public/js/joint-limits.js";
import { BODY_PRESETS, ARMS_PRESETS, START_JOINTS, clampJoint, jointsInRange } from "../../public/js/figure-rig.js";
import { newPose, setJoint, forSaving } from "../../public/js/pose-format.js";
import { dragTo } from "../../public/js/pose-ik.js";
import { Vector3 } from "../../public/js/vendor/three.js";
import { parsePose } from "../../src/poses/parse.js";
import { parsePresetData } from "../../src/pose-presets/parse.js";

describe("limits that depend on several movements", () => {
  it("measures how far a limb is raised, whichever way", () => {
    expect(raised(0, 0)).toBeCloseTo(0);
    expect(raised(90, 0)).toBeCloseTo(90);
    expect(raised(0, 90)).toBeCloseTo(90);
    expect(raised(180, 0)).toBeCloseTo(180);
  });

  it("lets every built-in preset and a new pose through", () => {
    for (const preset of [...BODY_PRESETS, ...ARMS_PRESETS]) {
      for (const [name, angles] of Object.entries(preset.joints)) expect(canReach(name, angles), `${preset.name} ${name}`).toBe(true);
    }
    for (const [name, angles] of Object.entries(START_JOINTS)) expect(canReach(name, angles)).toBe(true);
    expect(() => parsePose(forSaving(newPose()))).not.toThrow();
  });

  it("twists a shoulder less once the arm is raised past shoulder height", () => {
    expect(canReach("l_shoulder", [0, 0, 90])).toBe(true);
    expect(canReach("l_shoulder", [0, 90, 90])).toBe(true);
    expect(canReach("l_shoulder", [0, 90, 95])).toBe(true);
    expect(canReach("l_shoulder", [0, 90, 110])).toBe(false);
    expect(canReach("l_shoulder", [180, 0, 90])).toBe(false);
    expect(canReach("r_shoulder", [180, 0, -57])).toBe(true);
  });

  it("swings an arm back less once it's raised out to the side, and a leg out less behind the body", () => {
    expect(canReach("l_shoulder", [-70, 0, 0])).toBe(true);
    expect(canReach("l_shoulder", [-70, 90, 0])).toBe(false);
    expect(canReach("l_shoulder", [-60, 90, 0])).toBe(true);
    expect(canReach("l_hip", [60, 100, 0])).toBe(true);
    expect(canReach("l_hip", [60, 110, 0])).toBe(false);
    expect(canReach("l_hip", [-20, 60, 0])).toBe(false);
    // Crossing the other leg far only once it's forward.
    expect(canReach("r_hip", [0, -25, 0])).toBe(false);
    expect(canReach("r_hip", [60, -35, 0])).toBe(true);
  });

  it("twists a lower leg only once the knee bends, and with the hip no more than 70° all told", () => {
    expect(canReach("l_knee", [0, 20])).toBe(false);
    expect(canReach("l_knee", [90, 40])).toBe(true);
    expect(canReach("l_knee", [45, 30])).toBe(false);
    expect(canReach("l_knee", [90, 40], { l_hip: [0, 0, 40] })).toBe(false);
    expect(canReach("l_knee", [90, 30], { l_hip: [0, 0, 40] })).toBe(true);
    expect(canReach("l_hip", [0, 0, 40], { l_knee: [90, 40] })).toBe(false);
    // A knee straightened loses its twist; a hip twisted with it is kept to the rest.
    const pose = setJoint(setJoint(newPose(), "l_knee", 0, 90), "l_knee", 1, 30);
    expect(setJoint(pose, "l_knee", 0, 0).joints.l_knee).toEqual([0, 0]);
    expect(setJoint(pose, "l_hip", 2, 60).joints.l_hip[2]).toBe(40);
    // Each side looks at its own hip.
    expect(canReach("r_knee", [90, 40], { l_hip: [0, 0, 50] })).toBe(true);
  });

  it("twists a forearm from palm back to palm forward", () => {
    expect(setJoint(newPose(), "l_elbow", 1, 120).joints.l_elbow).toEqual([0, 95]);
    expect(setJoint(newPose(), "r_elbow", 1, -120).joints.r_elbow).toEqual([0, -85]);
  });

  it("stops a joint where it last could, on the way from where it was", () => {
    const stopped = withinReach("l_shoulder", [-80, 90, 0], [0, 90, 0]);
    expect(canReach("l_shoulder", stopped)).toBe(true);
    expect(stopped[1]).toBe(90);
    expect(stopped[0]).toBeLessThan(-40);
    // The twist alone is just kept within its range.
    expect(withinReach("l_shoulder", [180, 0, 90])).toEqual([180, 0, 57]);
    // A slider does the same.
    const pose = setJoint(setJoint(newPose(), "l_shoulder", 1, 90), "l_shoulder", 0, -80);
    expect(canReach("l_shoulder", pose.joints.l_shoulder)).toBe(true);
    expect(pose.joints.l_shoulder[1]).toBe(90);
  });

  it("keeps dragging within reach", () => {
    const start = setJoint(newPose(), "l_shoulder", 1, 90);
    // Far behind the figure, out at shoulder height.
    const moved = dragTo(start, "l_elbow", [0, 0, 0], new Vector3(40, 140, -80));
    expect(canReach("l_shoulder", moved.joints.l_shoulder)).toBe(true);
  });

  it("isn't checked by the server, which keeps each movement to its own range", () => {
    const pose = forSaving(newPose());
    expect(() => parsePose({ ...pose, joints: { ...pose.joints, l_shoulder: [180, 0, 90] } })).not.toThrow();
    expect(() => parsePresetData("arms", { joints: { l_shoulder: [-80, 90, 0] } })).not.toThrow();
    expect(() => parsePose({ ...pose, joints: { ...pose.joints, l_knee: [90, 40], l_hip: [0, 0, 50] } })).not.toThrow();
    expect(() => parsePose({ ...pose, joints: { ...pose.joints, l_shoulder: [190, 0, 0] } })).toThrow();
    expect(() => parsePresetData("arms", { joints: { l_shoulder: [0, 0, 120] } })).toThrow();
  });

  it("are always kept to by the poser's moves and drags; only an older pose's joints are brought within ranges alone", () => {
    // Straight up, twisted as far as it will go: about 57° with the arm raised (out 4°), not the twist's own 95°.
    const twisted = setJoint(setJoint(newPose(), "l_shoulder", 0, 180), "l_shoulder", 2, 200);
    expect(twisted.joints.l_shoulder).toEqual([180, 4, 58]);
    expect(clampJoint("l_shoulder", [180, 0, 90])).toEqual([180, 0, 57]);
    expect(clampJoint("l_shoulder", [180, 0, 90], undefined, {}, false)).toEqual([180, 0, 90]);
  });

  it("brings an older pose's or preset's joints within each movement's range, leaving the rest as they were", () => {
    const older = { joints: { l_shoulder: [180, 0, 90], l_hip: [0, 0, 70], l_knee: [30] }, lift: 99 };
    const fixed = jointsInRange(older);
    // An older knee (one number, from before it twisted) gets its twist, at
    // rest; a twist past what a body can reach with the arm up is kept.
    expect(fixed.joints).toEqual({ l_shoulder: [180, 0, 90], l_hip: [0, 0, 50], l_knee: [30, 0] });
    expect(fixed.lift).toBe(99);
    const fine = { joints: { l_knee: [30, 0] } };
    expect(jointsInRange(fine).joints).toEqual(fine.joints);
    expect(clampJoint("l_hip", [0, 0, 70])).toEqual([0, 0, 50]);
  });
});
