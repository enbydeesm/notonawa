// The poser's body (figure-body.js): its shape from the sliders, its
// joints, its mesh and measurements; and poses keeping a shape, older ones
// moved onto the body (pose-format.js).
import { describe, it, expect } from "vitest";
import {
  BONES, SHAPE_RANGES, DEFAULT_SHAPE, hats, shapeBlend, bodyHeads, standingLift, cleanShape, sameShape,
  readBody, bodyPositions, measurements,
} from "../../public/js/figure-body.js";
import { HEADS, CORNER_STATURE } from "../../public/js/figure-body-data.js";
import { DRIVES, anchorBone, olderJointPlaces } from "../../public/js/figure-rig.js";
import { newPose, readPose, forSaving } from "../../public/js/pose-format.js";
import { makeSkeleton, posed, ropePoint, boneParts, withShape } from "../../public/js/pose-skeleton.js";
import * as server from "../../src/poses/parse.js";

/** @typedef {import("../../public/js/figure-body.js").Shape} Shape */

describe("the body's shape", () => {
  it("shares a value between the anchors either side, and goes on in a line past the last", () => {
    expect(hats(0.25, [0, 0.5, 1])).toEqual([0.5, 0.5, 0]);
    expect(hats(1, [0, 0.5, 1])).toEqual([0, 0, 1]);
    // Past the heaviest: the last two carry on, still summing to 1.
    expect(hats(2, [0, 0.5, 1])).toEqual([0, -2, 3]);
  });

  it("blends the corners with weights summing to 1, adding fat only past Anny's heaviest", () => {
    for (const shape of /** @type {Shape[]} */ ([[0, 0, 0, 150], [100, 100, 50, 200], [37, 81, 90, 171], DEFAULT_SHAPE])) {
      const { corners, fat } = shapeBlend(shape);
      expect(corners.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      expect(fat).toBeCloseTo(Math.max(0, shape[2] / 50 - 1), 9);
    }
  });

  it("is as tall as asked", () => {
    for (const shape of /** @type {Shape[]} */ ([[50, 50, 25, 150], [0, 20, 80, 200], [100, 50, 10, 165]])) {
      const { corners } = shapeBlend(shape);
      expect(corners.reduce((s, a, c) => s + a * CORNER_STATURE[c], 0)).toBeCloseTo(shape[3], 1);
    }
  });

  it("has its joints where the in-between body has them by default, and taller legs when taller", () => {
    const heads = bodyHeads(DEFAULT_SHAPE);
    heads.forEach((h, i) => expect(h).toBeCloseTo(HEADS[i], 0));
    expect(standingLift(DEFAULT_SHAPE)).toBeGreaterThan(95);
    expect(standingLift([50, 50, 25, 200])).toBeGreaterThan(standingLift(DEFAULT_SHAPE) + 5);
    expect(standingLift([50, 50, 25, 150])).toBeLessThan(standingLift(DEFAULT_SHAPE) - 10);
  });

  it("keeps a shape within the sliders, defaulting what's missing", () => {
    expect(cleanShape([-5, 120.4, 33.6, 300])).toEqual([0, 100, 34, 200]);
    expect(cleanShape(null)).toEqual(DEFAULT_SHAPE);
    expect(cleanShape([10])).toEqual([10, ...DEFAULT_SHAPE.slice(1)]);
    expect(sameShape([1, 2, 3, 160], [1, 2, 3, 160])).toBe(true);
    expect(sameShape([1, 2, 3, 160], [1, 2, 4, 160])).toBe(false);
  });

  it("has the same sliders as the server", () => {
    expect(SHAPE_RANGES).toEqual(server.SHAPE_RANGES);
  });
});

describe("the body's mesh", () => {
  /**
   * A mesh file as pack_body.py writes one: a cube 2 cm a side (with one
   * component that makes it taller) and a waist round its middle.
   */
  function cubeFile() {
    const base = new Float32Array([-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1]);
    const basis = new Int16Array(24);
    for (const v of [2, 3, 6, 7]) basis[v * 3 + 1] = 32767;
    const faces = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);
    const sections = /** @type {[string, ArrayBufferView & { length: number }][]} */ ([
      ["base", base], ["basis", basis], ["scales", new Float32Array([1 / 32767])], ["coeff", new Float32Array(36)],
      ["fat", new Int16Array(24)], ["fatScale", new Float32Array([1])], ["faces", faces],
      ["joints", new Uint8Array(32)], ["weights", new Uint8Array(32).fill(255)], ["waist", new Uint16Array([0, 1, 5, 4])],
    ]);
    let offset = 0;
    const list = sections.map(([name, a]) => {
      offset = Math.ceil(offset / 4) * 4;
      const type = { Float32Array: "float32", Int16Array: "int16", Uint16Array: "uint16", Uint8Array: "uint8" }[a.constructor.name];
      const entry = { name, type, offset, length: a.length };
      offset += a.byteLength;
      return entry;
    });
    let header = JSON.stringify({ vertices: 8, faces: 12, components: 1, corners: 36, sections: list });
    header += " ".repeat((4 - (header.length % 4)) % 4);
    const bytes = new Uint8Array(12 + header.length + offset);
    bytes.set(new TextEncoder().encode("NOTOBODY"));
    new DataView(bytes.buffer).setUint32(8, header.length, true);
    bytes.set(new TextEncoder().encode(header), 12);
    sections.forEach(([, a], i) => bytes.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), 12 + header.length + list[i].offset));
    return bytes.buffer;
  }

  it("reads the file and measures the body", () => {
    const body = readBody(cubeFile());
    const p = bodyPositions(body, DEFAULT_SHAPE);
    const m = measurements(body, p);
    expect(m.height).toBeCloseTo(2);
    expect(m.volume).toBeCloseTo(8 / 1000); // litres
    expect(m.waist).toBeCloseTo(8);
    expect(m.mass).toBeCloseTo(0.98 * 8 / 1000);
  });

  it("refuses a file that isn't one", () => {
    expect(() => readBody(new Uint8Array(16).buffer)).toThrow();
  });
});

describe("the skeleton", () => {
  it("gives each joint's turn out in full across its bones", () => {
    for (const [part, drive] of Object.entries(DRIVES)) {
      expect(drive.reduce((s, [, share]) => s + share, 0), part).toBeCloseTo(1);
    }
  });

  it("puts every body bone in a part, fingers with the wrist and toes with the ankle", () => {
    const parts = ["pelvis", ...Object.keys(server.JOINTS)];
    const of = boneParts();
    const part = (/** @type {string} */ bone) => parts[of[BONES.indexOf(bone)]];
    expect(part("finger2-3.L")).toBe("l_wrist");
    expect(part("toe1-2.R")).toBe("r_ankle");
    expect(part("clavicle.L")).toBe("chest");
    expect(part("eye.R")).toBe("head");
    expect(part("spine05")).toBe("pelvis");
    // The low belly is tapped as the hips; the waist above it as the waist.
    expect(part("spine04")).toBe("pelvis");
    expect(part("spine03")).toBe("spine");
  });

  it("moves its joints with the shape", () => {
    const skeleton = makeSkeleton();
    const pose = newPose();
    posed(skeleton, pose);
    const arm = () => ropePoint(skeleton, ["l_shoulder", 0, 0, 0], pose).distanceTo(ropePoint(skeleton, ["l_wrist", 0, 0, 0], pose));
    const long = arm();
    posed(skeleton, { ...pose, shape: [50, 50, 25, 160] });
    expect(arm()).toBeLessThan(long - 4);
  });
});

describe("a pose's shape", () => {
  it("is the in-between body for a new pose, and is saved", () => {
    expect(newPose().shape).toEqual(DEFAULT_SHAPE);
    expect(forSaving(newPose()).shape).toEqual(DEFAULT_SHAPE);
    expect(server.parsePose(forSaving(newPose())).shape).toEqual(DEFAULT_SHAPE);
  });

  it("is checked by the server, and an older pose without one is kept without one", () => {
    const { shape: _, ...older } = forSaving(newPose());
    expect(server.parsePose(older)).not.toHaveProperty("shape");
    expect(() => server.parsePose({ ...older, shape: [50, 50, 25, 140] })).toThrow();
    expect(() => server.parsePose({ ...older, shape: [50, 50, 25] })).toThrow();
  });

  it("keeps the body's lowest point where it was as the shape changes: feet standing, knees kneeling", () => {
    const skeleton = makeSkeleton();
    const sole = (/** @type {import("../../public/js/pose-format.js").Pose} */ p) => {
      posed(skeleton, p);
      return Math.min(ropePoint(skeleton, ["l_ankle", 0, 0, 0], p).y, ropePoint(skeleton, ["l_knee", 0, 0, 0], p).y);
    };
    const standing = newPose();
    const kneeling = { ...newPose(), lift: 19, joints: { ...newPose().joints, l_hip: [68, 8, 0], r_hip: [68, 8, 0], l_knee: [155], r_knee: [155] } };
    for (const pose of [standing, kneeling]) {
      for (const shape of /** @type {Shape[]} */ ([[50, 50, 25, 150], [0, 80, 100, 200]])) {
        const moved = withShape(skeleton, pose, shape);
        expect(moved.shape).toEqual(shape);
        // The lowest joint (a toe) stays put; the ankles and knees follow
        // within a few centimetres (a smaller body's joints are nearer its skin).
        expect(Math.abs(sole(moved) - sole(pose))).toBeLessThan(3.5);
      }
    }
    expect(withShape(skeleton, standing, [50, 50, 25, 150]).lift).toBeLessThan(standing.lift - 10);
  });

  it("opens an older pose on the in-between body, its ropes where they were on the first figure", () => {
    const older = olderJointPlaces();
    const { shape: _, ...saved } = {
      ...newPose(),
      ropes: [{ c: /** @type {const} */ ("red"), w: /** @type {const} */ (2), p: /** @type {import("../../public/js/pose-format.js").RopePoint[]} */ ([
        ["l_wrist", 0, 0, 0], ["chest", 50, 120, 105], ["l_knee", -20, -100, 0],
      ]) }],
    };
    const pose = readPose(saved);
    expect(pose.shape).toEqual(DEFAULT_SHAPE);
    const skeleton = makeSkeleton();
    posed(skeleton, pose);
    for (const [i, [bone, x, y, z]] of saved.ropes[0].p.entries()) {
      const was = older[bone];
      const now = ropePoint(skeleton, pose.ropes[0].p[i], pose);
      expect(now.x, bone).toBeCloseTo(was[0] + x / 10, 0);
      expect(now.y, bone).toBeCloseTo(pose.lift + was[1] + y / 10, 0);
      expect(now.z, bone).toBeCloseTo(was[2] + z / 10, 0);
    }
    // One saved with a shape is left as it is.
    expect(readPose(pose).ropes).toEqual(pose.ropes);
    expect(anchorBone("l_wrist")).toBe("wrist.L");
  });
});
