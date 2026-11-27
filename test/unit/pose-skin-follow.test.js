// Rope on the body follows the skin (pose-skin-bind.js through
// pose-skeleton.js's ropePoint and toBone): measured against the real
// mesh, skinned as the 3D view skins it, with the waist, chest and hips
// bent and the elbow and knee too.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Matrix4, Vector3 } from "../../public/js/vendor/three.js";
import { BONES, BODY_FILE, readBody, bodyPositions } from "../../public/js/figure-body.js";
import { toDualQuat, blendDualQuats, dqTransform } from "../../public/js/pose-skinning.js";
import { bindInverses } from "../../public/js/pose-skin-bind.js";
import { makeSkeleton, posed, ropePoint, toBone, useSkin, vertexParts, onBone } from "../../public/js/pose-skeleton.js";
import { ropeRuns } from "../../public/js/pose-cinch.js";
import { newPose, bonePoint, withLayer } from "../../public/js/pose-format.js";

/** @typedef {import("../../public/js/pose-format.js").Pose} Pose */
/** @typedef {import("../../public/js/figure-body.js").Body} Body */

// The real body file, read from disk (the unit tests' types are the Worker's, without Node's: hence the name in a variable).
const fsModule = "node:fs";
const { readFileSync } = /** @type {{ readFileSync: (path: string) => Uint8Array }} */ (await import(fsModule));
const file = readFileSync(`public${BODY_FILE}`);
/** @type {Body} */
const body = readBody(/** @type {ArrayBuffer} */ (file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)));
const parts = vertexParts(body);

beforeAll(() => useSkin(body));
afterAll(() => useSkin(null));

/**
 * Every vertex where the 3D view draws it, for a skeleton posed.
 * @param {ReturnType<typeof makeSkeleton>} skeleton
 */
function skinned(skeleton) {
  const bind = bodyPositions(body, skeleton.shape);
  const inverses = bindInverses(skeleton.shape);
  const motions = BONES.map((name, i) => toDualQuat(new Matrix4()
    .multiplyMatrices(/** @type {any} */ (skeleton.all.get(name)).matrixWorld, inverses[i]).elements));
  const out = new Float32Array(bind.length);
  for (let v = 0; v < body.vertices; v++) {
    const ms = [], ws = [];
    for (let k = 0; k < 4; k++) {
      const w = body.weights[v * 4 + k] / 255;
      if (w) { ms.push(motions[body.joints[v * 4 + k]]); ws.push(w); }
    }
    const [x, y, z] = dqTransform(blendDualQuats(ms, ws), [bind[v * 3], bind[v * 3 + 1], bind[v * 3 + 2]]);
    out.set([x, y, z], v * 3);
  }
  return out;
}

const at = (/** @type {Float32Array} */ p, /** @type {number} */ v) => new Vector3(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);

/**
 * Skin vertices of a part all round it, a ring at one height of the
 * straight body: the rope points a wrap there would have.
 * @param {Float32Array} straight @param {string[]} names the parts @param {number} height cm
 * @returns {number[]}
 */
function ring(straight, names, height) {
  const ids = names.map((n) => parts.names.indexOf(n));
  /** One vertex per 30° round the part's middle, the nearest that height. @type {Map<number, [number, number]>} */
  const best = new Map();
  let cx = 0, cz = 0, n = 0;
  for (let v = 0; v < body.vertices; v++) {
    if (!ids.includes(parts.of[v]) || Math.abs(straight[v * 3 + 1] - height) > 1.5) continue;
    cx += straight[v * 3]; cz += straight[v * 3 + 2]; n++;
  }
  [cx, cz] = [cx / n, cz / n];
  for (let v = 0; v < body.vertices; v++) {
    const off = Math.abs(straight[v * 3 + 1] - height);
    if (!ids.includes(parts.of[v]) || off > 1.5) continue;
    const sector = Math.round(Math.atan2(straight[v * 3 + 2] - cz, straight[v * 3] - cx) / (Math.PI / 6));
    const kept = best.get(sector);
    if (!kept || off < kept[1]) best.set(sector, [v, off]);
  }
  return [...best.values()].map(([v]) => v);
}

/**
 * How far rope points made on these vertices (standing straight) end up
 * from the same vertices once posed: following the skin, and turning with
 * their bone alone (as before), the worst of each (cm).
 * @param {(pose: Pose) => Pose} bend @param {string} part the bone the points are kept on
 * @param {string[]} names the parts the ring's vertices are on @param {number} height
 */
function drift(bend, part, names, height) {
  const skeleton = makeSkeleton();
  const straightPose = newPose();
  posed(skeleton, straightPose);
  const straight = skinned(skeleton);
  const vertices = ring(straight, names, height);
  expect(vertices.length).toBeGreaterThan(8);
  const points = vertices.map((v) => bonePoint(part, toBone(skeleton, part, at(straight, v))));
  const bent = bend(straightPose);
  posed(skeleton, bent);
  const real = skinned(skeleton);
  const following = Math.max(...points.map((p, i) => ropePoint(skeleton, p, bent).distanceTo(at(real, vertices[i]))));
  const stiff = Math.max(...points.map((p, i) => /** @type {any} */ (skeleton.bones.get(part))
    .localToWorld(new Vector3(p[1] / 10, p[2] / 10, p[3] / 10)).distanceTo(at(real, vertices[i]))));
  return { following, stiff };
}

/** A pose with these joints set. @param {Record<string, number[]>} joints */
const bending = (joints) => (/** @type {Pose} */ pose) => ({ ...pose, joints: { ...pose.joints, ...joints } });

describe("rope on the body follows the skin", () => {
  const STRAIGHT = makeSkeleton();
  posed(STRAIGHT, newPose());
  const straight = skinned(STRAIGHT);
  // The waist's height on the straight body: halfway up the spine's skin.
  const spineYs = [];
  for (let v = 0; v < body.vertices; v++) if (parts.names[parts.of[v]] === "spine") spineYs.push(straight[v * 3 + 1]);
  const waist = (Math.min(...spineYs) + Math.max(...spineYs)) / 2;

  for (const [what, joints] of /** @type {const} */ ([
    ["the waist bent forward", { spine: [-55, 0, 0] }],
    ["the waist bent back", { spine: [70, 0, 0] }],
    ["the waist leaning", { spine: [0, -40, 0] }],
    ["the chest bent forward and turned", { chest: [-45, -10, -10] }],
  ])) {
    it(`a ring round the waist stays on the skin with ${what}`, () => {
      const { following, stiff } = drift(bending(/** @type {any} */ (joints)), "spine", ["pelvis", "hips", "spine", "chest"], waist);
      expect(following).toBeLessThan(0.3);
      // As before, turning with the spine alone, it's off by far more.
      expect(stiff).toBeGreaterThan(following * 2);
    });
  }

  it("a ring round a bent elbow and a bent knee stays on the skin", () => {
    const elbowY = STRAIGHT.bones.get("l_elbow")?.localToWorld(new Vector3()).y ?? 0;
    const arm = drift(bending({ l_elbow: [100, 0, 0] }), "l_elbow", ["l_shoulder", "l_elbow"], elbowY + 2);
    expect(arm.following).toBeLessThan(0.4);
    const kneeY = STRAIGHT.bones.get("l_knee")?.localToWorld(new Vector3()).y ?? 0;
    const leg = drift(bending({ l_knee: [100, 0, 0] }), "l_knee", ["l_hip", "l_knee"], kneeY + 2);
    expect(leg.following).toBeLessThan(0.4);
  });

  it("a point tapped on the bent body is kept so it's drawn where it was tapped", () => {
    const skeleton = makeSkeleton();
    const pose = bending({ spine: [-55, -20, 15], chest: [-30, 0, 0] })(newPose());
    posed(skeleton, pose);
    const real = skinned(skeleton);
    for (const v of ring(straight, ["spine", "chest", "hips"], waist + 6)) {
      const tapped = at(real, v);
      const point = bonePoint("spine", toBone(skeleton, "spine", tapped));
      // Within the millimetre it's kept to.
      expect(ropePoint(skeleton, point, pose).distanceTo(tapped)).toBeLessThan(0.15);
    }
  });

  it("standing straight, a point is where its bone alone would put it", () => {
    const point = bonePoint("chest", [0, 50, 140]);
    const p = ropePoint(STRAIGHT, point, newPose());
    const stiff = /** @type {any} */ (STRAIGHT.bones.get("chest")).localToWorld(new Vector3(0, 5, 14));
    // Within a tenth of a millimetre (the blend's rounding).
    expect(p.distanceTo(stiff)).toBeLessThan(0.01);
  });

  it("a layer stands out from the skin the way it faces, by half a layer's old distance", async () => {
    const { LAYER_CM } = await import("../../public/js/pose-format.js");
    expect(LAYER_CM).toBe(0.75);
    // On the front of the waist: out is forward.
    const front = bonePoint("spine", toBone(STRAIGHT, "spine", at(straight, ring(straight, ["spine"], waist).reduce((a, b) => (straight[b * 3 + 2] > straight[a * 3 + 2] ? b : a)))));
    const out = ropePoint(STRAIGHT, withLayer(front, 2), newPose()).sub(ropePoint(STRAIGHT, front, newPose()));
    expect(out.length()).toBeCloseTo(2 * LAYER_CM, 3);
    expect(out.z / out.length()).toBeGreaterThan(0.8);
  });

  it("a futomomo's rope crosses straight from the thigh to the calf of a bent leg, not down the leg and round the knee", () => {
    const skeleton = makeSkeleton();
    const start = newPose();
    const pose = { ...start, joints: { ...start.joints, l_knee: [140, 0, 0] } };
    posed(skeleton, pose);
    const real = skinned(skeleton);
    const knee = onBone(skeleton, "l_knee");
    // On the outside of the leg, as a futomomo's turns cross from the thigh to the calf.
    const nearest = (/** @type {string} */ part, /** @type {Vector3} */ to) => {
      const id = parts.names.indexOf(part);
      let best = -1, far = Infinity;
      for (let v = 0; v < body.vertices; v++) {
        if (parts.of[v] === id && at(real, v).distanceTo(to) < far) [best, far] = [v, at(real, v).distanceTo(to)];
      }
      return at(real, best);
    };
    const out = Math.sign(onBone(skeleton, "l_hip").x);
    const thigh = nearest("l_hip", onBone(skeleton, "l_hip", [10 * out, -25, 0]));
    const calf = nearest("l_knee", onBone(skeleton, "l_knee", [10 * out, -15, 0]));
    // Round the front of the thigh first (a rope of two points hangs straight anyway), then across to the calf.
    const front = nearest("l_hip", onBone(skeleton, "l_hip", [0, -25, 10]));
    const points = [front, thigh].map((p) => bonePoint("l_hip", toBone(skeleton, "l_hip", p)));
    points.push(bonePoint("l_knee", toBone(skeleton, "l_knee", calf)));
    const whole = ropeRuns(skeleton, { ...pose, ropes: [{ c: "red", w: 2, p: points }] }, 0).flat();
    // The stretch from the thigh's outside to the calf.
    const from = whole.reduce((k, p, i) => (p.distanceTo(thigh) < whole[k].distanceTo(thigh) ? i : k), 0);
    const run = whole.slice(from);
    const [a, b] = [run[0], run[run.length - 1]];
    const off = (/** @type {Vector3} */ p) => {
      const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
      return p.distanceTo(a.clone().addScaledVector(ab, t));
    };
    // About as long as the gap, every point near the line across it, none by the knee.
    let length = 0;
    for (let i = 1; i < run.length; i++) length += run[i].distanceTo(run[i - 1]);
    expect(length).toBeLessThan(a.distanceTo(b) * 1.5 + 2);
    expect(Math.max(...run.map(off))).toBeLessThan(3);
    expect(Math.min(...run.map((p) => p.distanceTo(knee)))).toBeGreaterThan(5);
  });
});
