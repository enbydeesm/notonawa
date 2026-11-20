// The hips turning Forward first (figure-rig.js, hip-order.js): older poses'
// and presets' hips turned to match, the leg where it was; Out moving the
// knee sideways when sitting; and everyday seated poses within the limits.
import { describe, it, expect } from "vitest";
import { Object3D, Vector3 } from "../../public/js/vendor/three.js";
import { newerHip, withNewerHips, FORWARD_FIRST } from "../../public/js/hip-order.js";
import { newPose, readPose, FORMAT_VERSION } from "../../public/js/pose-format.js";
import { JOINTS, jointNamed } from "../../public/js/figure-rig.js";
import { canReach } from "../../public/js/joint-limits.js";
import { makeSkeleton, posed } from "../../public/js/pose-skeleton.js";

/** A hip's turn, from its sliders, turned in a given order (figure-rig.js's axes and signs). */
function hipTurn(/** @type {number[]} */ [forward, out, twist], /** @type {1 | -1} */ s, /** @type {"ZXY" | "XZY"} */ order) {
  const o = new Object3D();
  o.rotation.set(-forward * Math.PI / 180, s * twist * Math.PI / 180, s * out * Math.PI / 180, order);
  const { x, y, z, w } = o.quaternion;
  return { x, y, z, w };
}

/** How far apart two turns are, degrees. @param {{ x: number, y: number, z: number, w: number }} a @param {typeof a} b */
const turnsApart = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w))) * 180 / Math.PI;
/** @param {Vector3} v */
const unit = (v) => v.multiplyScalar(1 / v.length());

/** Where a leg's thigh and shin point, posed. @param {Record<string, number[]>} joints @param {"L" | "R"} S */
function legOf(joints, S = "L") {
  const skeleton = makeSkeleton();
  posed(skeleton, { ...newPose(), joints: { ...newPose().joints, ...joints } });
  const at = (/** @type {string} */ b) => /** @type {Object3D} */ (skeleton.all.get(b)).localToWorld(new Vector3());
  return {
    knee: at(`lowerleg01.${S}`), ankle: at(`foot.${S}`),
    thigh: unit(at(`lowerleg01.${S}`).sub(at(`upperleg01.${S}`))), shin: unit(at(`foot.${S}`).sub(at(`lowerleg01.${S}`))),
  };
}

const degreesApart = (/** @type {Vector3} */ a, /** @type {Vector3} */ b) => Math.acos(Math.max(-1, Math.min(1, a.dot(b) / (a.length() * b.length())))) * 180 / Math.PI;

describe("older hips", () => {
  it("turn into the angles that put the leg where it was, either side", () => {
    let worst = 0;
    for (let f = -35; f <= 150; f += 15) {
      for (let o = -35; o <= 100; o += 15) {
        for (let t = -50; t <= 50; t += 25) {
          for (const [side, s] of /** @type {const} */ ([["l", 1], ["r", -1]])) {
            const now = newerHip([f, o, t], side);
            worst = Math.max(worst, turnsApart(hipTurn([f, o, t], s, "ZXY"), hipTurn(now, s, "XZY")));
          }
        }
      }
    }
    // Only rounding to whole degrees.
    expect(worst).toBeLessThan(1.5);
    expect(newerHip([90, 0, 0], "l")).toEqual([90, 0, 0]);
    expect(newerHip([0, 40, 0], "r")).toEqual([0, 40, 0]);
    // Format 1's "knees together" sitting: Out at its limit, twisted in to bring the feet back.
    expect(newerHip([79, -35, -33], "l")).toEqual([81, -6, 2]);
  });

  it("are turned in format 1 poses and presets (without v) only", () => {
    const older = { v: 1, joints: { l_hip: [116, 25, 45], r_hip: [0, 0, 0], l_knee: [145, 25] }, lift: 50 };
    const now = withNewerHips(older);
    expect(now).toEqual({ v: FORWARD_FIRST, joints: { l_hip: [114, -11, 22], r_hip: [0, 0, 0], l_knee: [145, 25] }, lift: 50 });
    expect(older.joints.l_hip).toEqual([116, 25, 45]);
    const preset = { joints: { l_hip: [79, -35, -33] }, body: [0, 0, 0], lift: 99 };
    expect(withNewerHips(preset).joints.l_hip).toEqual([81, -6, 2]);
    const newer = { v: 2, joints: { l_hip: [79, -35, -33] } };
    expect(withNewerHips(newer)).toBe(newer);
  });

  it("open in the poser turned, the leg where it was", () => {
    expect(FORMAT_VERSION).toBe(FORWARD_FIRST);
    const read = readPose({ ...newPose(), v: 1, joints: { ...newPose().joints, l_hip: [116, 25, 45], r_hip: [79, -35, -33] } });
    expect(read.v).toBe(2);
    expect(read.joints.l_hip).toEqual([114, -11, 22]);
    expect(read.joints.r_hip).toEqual([81, -6, 2]);
    const kept = readPose({ ...newPose(), joints: { ...newPose().joints, l_hip: [90, -10, 0] } });
    expect(kept.joints.l_hip).toEqual([90, -10, 0]);
  });
});

describe("hips turning Forward first", () => {
  it("move the knee sideways with Out when sitting, the foot going with it", () => {
    const sitting = { l_hip: [90, 0, 0], l_knee: [90, 0] };
    const together = { l_hip: [90, -12, 0], l_knee: [90, 0] };
    const a = legOf(sitting), b = legOf(together);
    const moved = a.knee.x - b.knee.x;
    expect(moved).toBeGreaterThan(8);
    // The shin still hangs straight down: the ankle moves with the knee.
    expect(Math.abs((a.ankle.x - b.ankle.x) - moved)).toBeLessThan(2);
    expect(Math.abs(b.shin.x)).toBeLessThan(0.15);
  });

  // Everyday poses: slider values within every limit that point the thigh
  // and shin as a body would (directions from the pelvis, figure's left x,
  // up y, forward z; the left leg, and the right mirrored).
  const POSES = [
    ["chair, knees and feet together", [86, -12, 2], [82, 13], [-0.12, 0, 1], [-0.02, -1, 0]],
    ["floor, knees up and together", [114, -14, 28], [143, 31], [-0.14, 0.45, 0.88], [-0.03, -0.8, -0.6]],
    ["deep squat", [99, 13, -8], [130, -4], [0.3, 0.25, 0.92], [0.1, -0.79, -0.6]],
    ["cross-legged", [77, 41, 87], [131, 2], [0.7, -0.2, 0.68], [-0.99, -0.11, -0.1]],
    ["butterfly", [70, 50, 87], [137, -18], [0.8, -0.25, 0.55], [-0.98, -0.18, -0.04]],
    ["seated straddle", [87, 41, 3], [-5, 0], [0.7, 0, 0.71], [0.7, 0, 0.71]],
    ["knee over knee", [95, -17, 10], [73, 20], [-0.2, 0.15, 0.97], [-0.15, -0.95, 0.25]],
    ["figure-four", [102, 33, 90], [108, 20], [0.6, 0.1, 0.8], [-0.98, 0.1, 0.15]],
    ["tree pose", [30, 54, 66], [85, 15], [0.85, -0.45, 0.25], [-0.5, -0.85, -0.1]],
    ["pigeon, front leg", [86, 11, 90], [81, 14], [0.25, -0.1, 0.96], [-0.95, -0.1, 0.25]],
  ];
  for (const [name, hip, knee, thigh, shin] of POSES) {
    it(`reach ${name}`, () => {
      for (const [side, S, m] of /** @type {const} */ ([["l", "L", 1], ["r", "R", -1]])) {
        const joints = { [`${side}_hip`]: /** @type {number[]} */ (hip), [`${side}_knee`]: /** @type {number[]} */ (knee) };
        for (const [joint, angles] of Object.entries(joints)) {
          jointNamed(joint)?.moves.forEach((mv, i) => {
            expect(angles[i]).toBeGreaterThanOrEqual(mv.min);
            expect(angles[i]).toBeLessThanOrEqual(mv.max);
          });
          expect(canReach(joint, angles, joints), `${name}: ${joint}`).toBe(true);
        }
        const leg = legOf(joints, S);
        const [tx, ty, tz] = /** @type {number[]} */ (thigh), [sx, sy, sz] = /** @type {number[]} */ (shin);
        expect(degreesApart(leg.thigh, new Vector3(m * tx, ty, tz)), `${name} thigh`).toBeLessThan(12);
        expect(degreesApart(leg.shin, new Vector3(m * sx, sy, sz)), `${name} shin`).toBeLessThan(12);
      }
    });
  }

  it("keep the poser's own joint list as it was", () => {
    expect(JOINTS.find((j) => j.name === "l_hip")?.order).toBe("XZY");
    expect(JOINTS.find((j) => j.name === "l_shoulder")?.order).toBe("ZXY");
  });
});
