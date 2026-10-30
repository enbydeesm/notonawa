// Dual-quaternion skinning (pose-skinning.js): a vertex follows one bone
// exactly, and a blend between two turns keeps its distance from the joint
// (rounding a bend, where a linear blend pulls it in).
import { describe, it, expect } from "vitest";
import { Object3D, Vector3 } from "../../public/js/vendor/three.js";
import { toDualQuat, blendDualQuats, dqTransform, withDualQuatSkinning } from "../../public/js/pose-skinning.js";

/** A rigid matrix: turned about x, y, z (degrees, XYZ), then moved. */
function rigid(/** @type {number[]} */ [ax, ay, az], /** @type {number[]} */ [tx, ty, tz]) {
  const o = new Object3D();
  o.rotation.set(ax * Math.PI / 180, ay * Math.PI / 180, az * Math.PI / 180, "XYZ");
  o.position.set(tx, ty, tz);
  o.updateMatrixWorld(true);
  return o.matrixWorld;
}

/** @param {import("../../public/js/vendor/three.js").Matrix4} m @param {[number, number, number]} p */
const byMatrix = (m, p) => new Vector3(...p).applyMatrix4(m);

describe("dual-quaternion skinning", () => {
  it("moves a vertex on one bone exactly as the bone's matrix does, whatever the turn", () => {
    for (const [turn, move] of [[[0, 0, 0], [1, 2, 3]], [[30, -60, 100], [-5, 0, 7]], [[179, 10, -170], [0, 4, 0]], [[90, 90, 0], [2, 2, 2]]]) {
      const m = rigid(turn, move);
      const p = /** @type {[number, number, number]} */ ([3, -1, 2]);
      const [x, y, z] = dqTransform(blendDualQuats([toDualQuat(m.elements)], [1]), p);
      const want = byMatrix(m, p);
      expect(x).toBeCloseTo(want.x, 6);
      expect(y).toBeCloseTo(want.y, 6);
      expect(z).toBeCloseTo(want.z, 6);
    }
  });

  it("keeps a point's distance from the joint halfway through a bend, where a linear blend pulls it in", () => {
    const straight = rigid([0, 0, 0], [0, 0, 0]);
    const bent = rigid([0, 0, 120], [0, 0, 0]);
    const p = /** @type {[number, number, number]} */ ([10, 0, 0]);
    const [x, y, z] = dqTransform(blendDualQuats([toDualQuat(straight.elements), toDualQuat(bent.elements)], [0.5, 0.5]), p);
    expect(Math.hypot(x, y, z)).toBeCloseTo(10, 6);
    const linear = byMatrix(straight, p).multiplyScalar(0.5).add(byMatrix(bent, p).multiplyScalar(0.5));
    expect(linear.length()).toBeLessThan(5.1);
  });

  it("takes q and -q as the same turn", () => {
    const m = rigid([20, 0, 0], [1, 0, 0]);
    const dq = toDualQuat(m.elements);
    const flipped = { r: /** @type {[number, number, number, number]} */ (dq.r.map((n) => -n)), d: /** @type {[number, number, number, number]} */ (dq.d.map((n) => -n)) };
    const [x, y, z] = dqTransform(blendDualQuats([dq, flipped], [0.5, 0.5]), [0, 1, 0]);
    const want = byMatrix(m, [0, 1, 0]);
    expect([x, y, z].map((n) => Math.round(n * 1e6) / 1e6)).toEqual([want.x, want.y, want.z].map((n) => Math.round(n * 1e6) / 1e6));
  });

  it("goes into three.js's vertex shader, or says it can't", () => {
    const shader = "#include <skinning_pars_vertex>\nvoid main() {\n#include <skinnormal_vertex>\n#include <skinning_vertex>\n}";
    const out = withDualQuatSkinning(shader);
    expect(out).toContain("dqTurnOf");
    expect(out).not.toContain("#include <skinning_vertex>");
    expect(() => withDualQuatSkinning("void main() {}")).toThrow();
  });
});
