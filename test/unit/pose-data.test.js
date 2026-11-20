// A pose's data saved in format 2 (public/js/records/pose-data.js), as
// format 1's server saved it (src/poses/parse.js): every joint, a
// movement left out at rest, an older camera as not panned. Found by the
// walkthrough on format 2: a pose saved with only some joints broke the
// poser.
import { describe, it, expect } from "vitest";
import { poseData } from "../../public/js/records/pose-data.js";
import { JOINTS } from "../../public/js/figure-rig.js";
import { JOINTS as SERVER_JOINTS } from "../../src/poses/parse.js";
import { newPose, forSaving } from "../../public/js/pose-format.js";

describe("poseData", () => {
  it("fills in every joint at rest, as the server did", () => {
    const data = poseData({ v: 1, joints: { l_shoulder: [20] }, camera: [0, 8, 380, 110], ropes: [] });
    expect(Object.keys(data.joints)).toEqual(Object.keys(SERVER_JOINTS));
    for (const joint of JOINTS) expect(data.joints[joint.name].length, joint.name).toBe(joint.moves.length);
    expect(data.joints.l_shoulder[0]).toBe(20);
    expect(data.camera).toEqual([0, 8, 380, 110, 0, 0]);
    expect(data.ropes).toEqual([]);
  });

  it("leaves a whole pose from the poser as it is", () => {
    const pose = forSaving(newPose());
    expect(poseData(pose)).toEqual(pose);
  });

  it("refuses what isn't a pose", () => {
    expect(() => poseData({ v: 3, joints: {} })).toThrow(/newer version/);
    expect(poseData({ v: 2, joints: {} }).v).toBe(2);
    expect(() => poseData({ v: 1 })).toThrow(/no joints/);
    expect(() => poseData({ v: 1, joints: { tail: [1] } })).toThrow(/doesn't know/);
    expect(() => poseData({ v: 1, joints: { l_shoulder: [1, 2, 3, 4, 5] } })).toThrow(/right format/);
  });
});
