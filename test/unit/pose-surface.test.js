// Rope on the skin (pose-surface.js): the way round the body between two
// points, and wraps.
import { describe, it, expect } from "vitest";
import { Vector3 } from "../../public/js/vendor/three.js";
import * as page from "../../public/js/pose-format.js";
import { makeSkeleton, posed, onBone, toBone } from "../../public/js/pose-skeleton.js";
import { ropeRuns } from "../../public/js/pose-cinch.js";
import { skinOf, alongSkin, wrapRound, liftedOut, WRAP_POINTS } from "../../public/js/pose-surface.js";

/** @typedef {import("../../public/js/pose-format.js").Pose} Pose */
/** @typedef {import("../../public/js/pose-format.js").RopePoint} RopePoint */

const skeleton = makeSkeleton();
/** The body's capsules for a pose. @param {Pose} pose */
const skinFor = (pose) => {
  posed(skeleton, pose);
  return skinOf(skeleton);
};
/** How far a point is from a capsule's line, less its radius: under 0 is inside. @param {Vector3} p @param {{ a: Vector3, b: Vector3, r: number }} capsule */
function outside(p, { a, b, r }) {
  const ab = b.clone().sub(a);
  const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(a.clone().addScaledVector(ab, t)) - r;
}
/** The left forearm's capsule. @param {ReturnType<typeof skinOf>} skin */
const forearm = (skin) => skin.groups[5][0];

describe("a rope between two points on one part", () => {
  it("goes round it, not through it: from the front of a forearm to its back", () => {
    const pose = page.newPose();
    const skin = skinFor(pose);
    const { a, b, r } = forearm(skin);
    const mid = a.clone().lerp(b, 0.5);
    const front = mid.clone().add(new Vector3(0, 0, r + 0.6)), back = mid.clone().add(new Vector3(0, 0, -(r + 0.6)));
    // Straight between them is through the middle of the arm.
    expect(outside(front.clone().lerp(back, 0.5), forearm(skin))).toBeLessThan(-2);
    const between = alongSkin(skin, "l_elbow", front, "l_elbow", back);
    expect(between.length).toBeGreaterThanOrEqual(5);
    for (const p of between) {
      expect(outside(p, forearm(skin))).toBeGreaterThan(0.3);
      expect(outside(p, forearm(skin))).toBeLessThan(1.5);
    }
    // In order round it: each step is short.
    [front, ...between, back].reduce((last, p) => {
      expect(p.distanceTo(last)).toBeLessThan(r * 1.2);
      return p;
    });
  });

  it("stays on the skin between points under a capsule's surface, rather than jutting out to it (the small of the back, an ankle)", () => {
    // The capsules stand out past the skin where it curves in: a wrap's
    // points, on the real skin, are then inside one. The way between them
    // keeps as far out as they are, not out on the capsule.
    const skin = skinFor(page.newPose());
    const { a, b, r } = forearm(skin);
    const mid = a.clone().lerp(b, 0.5);
    const front = mid.clone().add(new Vector3(0, 0, r - 1)), back = mid.clone().add(new Vector3(0, 0, -(r - 1)));
    const between = alongSkin(skin, "l_elbow", front, "l_elbow", back);
    expect(between.length).toBeGreaterThanOrEqual(5);
    for (const p of between) {
      expect(outside(p, forearm(skin))).toBeLessThan(-0.5);
      expect(outside(p, forearm(skin))).toBeGreaterThan(-1.5);
    }
  });

  it("adds nothing between points close together, or when an end isn't on the body", () => {
    const skin = skinFor(page.newPose());
    const { a, b, r } = forearm(skin);
    const mid = a.clone().lerp(b, 0.5).add(new Vector3(0, 0, r + 0.6));
    expect(alongSkin(skin, "l_elbow", mid, "l_elbow", mid.clone().add(new Vector3(0, 1, 0)))).toEqual([]);
    expect(alongSkin(skin, "l_elbow", mid, "ring", new Vector3(0, 250, 0))).toEqual([]);
    expect(alongSkin(skin, "rope", mid, "l_elbow", mid)).toEqual([]);
  });

  it("goes round the trunk between the chest and the waist as one, staying outside both", () => {
    const pose = page.newPose();
    const skin = skinFor(pose);
    posed(skeleton, pose);
    const front = liftedOut(onBone(skeleton, "chest", [0, 5, 14]), skin.groups[2]);
    const back = liftedOut(onBone(skeleton, "spine", [0, 5, -14]), skin.groups[1]);
    const between = alongSkin(skin, "chest", front, "spine", back);
    expect(between.length).toBeGreaterThanOrEqual(5);
    for (const p of between) for (const c of [...skin.groups[1], ...skin.groups[2]]) expect(outside(p, c)).toBeGreaterThan(0.3);
    // It passes the body's side, not its middle.
    expect(Math.max(...between.map((p) => Math.abs(p.x)))).toBeGreaterThan(10);
  });

  it("between different limbs runs straight, lifted out of what's in its way", () => {
    const skin = skinFor(page.newPose());
    const { a, b, r } = forearm(skin);
    const here = a.clone().lerp(b, 0.5).add(new Vector3(r + 0.6, 0, 0));
    const thigh = skin.groups[7][0];
    const there = thigh.a.clone().lerp(thigh.b, 0.5).add(new Vector3(-(thigh.r + 0.6), 0, 0));
    const between = alongSkin(skin, "l_elbow", here, "l_hip", there);
    for (const p of between) for (const c of [forearm(skin), thigh]) expect(outside(p, c)).toBeGreaterThan(0.3);
  });

  it("is how a rope round the body is drawn: more points than it was tapped at, none inside the arm", () => {
    const base = page.newPose();
    const skin = skinFor(base);
    const { a, b, r } = forearm(skin);
    const mid = a.clone().lerp(b, 0.5);
    /** @param {Vector3} v @returns {RopePoint} */
    const point = (v) => page.bonePoint("l_elbow", toBone(skeleton, "l_elbow", v));
    const pose = { ...base, ropes: [{ c: /** @type {const} */ ("red"), w: /** @type {const} */ (2), p: [
      point(mid.clone().add(new Vector3(0, 0, r + 0.6))), point(mid.clone().add(new Vector3(0, 0, -(r + 0.6)))),
    ] }, { c: /** @type {const} */ ("red"), w: /** @type {const} */ (2), p: [
      point(mid.clone().add(new Vector3(0, 0, r + 0.6))), point(mid.clone().add(new Vector3(0, 0, -(r + 0.6)))), point(mid.clone().add(new Vector3(0, 3, r + 0.6))),
    ] }] };
    posed(skeleton, pose);
    // Two points: a rope of its own length, drawn straight (it sags, with slack).
    expect(ropeRuns(skeleton, pose, 0)[0].length).toBe(2);
    // Three: round the arm and back.
    const [run] = ropeRuns(skeleton, pose, 1);
    expect(run.length).toBeGreaterThan(8);
    for (const p of run) expect(outside(p, forearm(skin))).toBeGreaterThan(0.2);
  });
});

describe("a wrap", () => {
  it("goes once round the part from where it was tapped, back to it, on the skin", () => {
    const skin = skinFor(page.newPose());
    const { a, b, r } = forearm(skin);
    const tapped = a.clone().lerp(b, 0.4).add(new Vector3(0, 0, r + 0.6));
    const wrap = wrapRound(skin, "l_elbow", tapped, 1, 1.5);
    expect(wrap.length).toBe(WRAP_POINTS + 1);
    expect(wrap[0].distanceTo(tapped)).toBeLessThan(0.01);
    expect(wrap[WRAP_POINTS].distanceTo(tapped)).toBeLessThan(0.5);
    for (const p of wrap) {
      expect(outside(p, forearm(skin))).toBeGreaterThan(0.3);
      expect(outside(p, forearm(skin))).toBeLessThan(1.5);
    }
    // Halfway round is the far side of the arm.
    expect(wrap[WRAP_POINTS / 2].z).toBeLessThan(tapped.z - r);
  });

  it("with more turns, moves along the part a rope's width each turn", () => {
    const skin = skinFor(page.newPose());
    const { a, b, r } = forearm(skin);
    const tapped = a.clone().lerp(b, 0.4).add(new Vector3(0, 0, r + 0.6));
    const wrap = wrapRound(skin, "l_elbow", tapped, 3, 1.5);
    expect(wrap.length).toBe(3 * WRAP_POINTS + 1);
    const along = b.clone().sub(a);
    along.multiplyScalar(1 / along.length());
    expect(Math.abs(wrap[3 * WRAP_POINTS].clone().sub(tapped).dot(along))).toBeCloseTo(4.5, 1);
  });

  it("goes round the chest wider at the sides than front to back, and keeps as far out as the tap was", () => {
    const pose = page.newPose();
    const skin = skinFor(pose);
    const tapped = liftedOut(onBone(skeleton, "chest", [0, 8, 3]), skin.groups[2]);
    const wrap = wrapRound(skin, "chest", tapped, 1, 1.5);
    expect(wrap.length).toBe(WRAP_POINTS + 1);
    for (const p of wrap) for (const c of skin.groups[2]) expect(outside(p, c)).toBeGreaterThan(0.3);
    const across = Math.max(...wrap.map((p) => p.x)) - Math.min(...wrap.map((p) => p.x));
    const deep = Math.max(...wrap.map((p) => p.z)) - Math.min(...wrap.map((p) => p.z));
    expect(across).toBeGreaterThan(deep);
  });

  it("isn't made on a hardpoint or a rope", () => {
    const skin = skinFor(page.newPose());
    expect(wrapRound(skin, "ring", new Vector3(0, 200, 0), 1, 1.5)).toEqual([]);
  });
});

describe("a rope's points, moved and taken out", () => {
  /** @param {RopePoint[]} p */
  const rope = (p) => ({ c: /** @type {const} */ ("red"), w: /** @type {const} */ (2), p });
  /** @type {RopePoint} */
  const RING = ["ring", 0, 0, 0];
  const base = () => ({ ...page.newPose(), ring: /** @type {[number, number, number]} */ ([0, 250, 0]), ropes: [
    rope([["chest", 0, 0, 100], ["chest", 100, 0, 0], ["chest", 0, 0, -100], RING]),
    rope([page.ropeSpot(0, 1, 0.5), ["l_elbow", 0, 0, 0]]),
  ] });

  it("only a point on the body has a dot: not the hardpoint's, a spot on a rope, or a cinch's", () => {
    const pose = base();
    expect([0, 1, 2, 3].map((k) => page.onBody(pose.ropes[0], k))).toEqual([true, true, true, false]);
    expect([0, 1].map((k) => page.onBody(pose.ropes[1], k))).toEqual([false, true]);
    expect(page.onBody({ ...rope([page.ropeSpot(0, 0, 0.5), ["chest", 0, 0, 0]]), l: 10 }, 1)).toBe(false);
  });

  it("moves one point, the rest and what's tied on the rope as they were", () => {
    const pose = base();
    const moved = page.movePoint(pose, 0, 1, page.bonePoint("spine", [120, 10, 0]));
    expect(moved.ropes[0].p[1]).toEqual(["spine", 120, 10, 0]);
    expect(moved.ropes[0].p.filter((_, k) => k !== 1)).toEqual(pose.ropes[0].p.filter((_, k) => k !== 1));
    expect(moved.ropes[1]).toEqual(pose.ropes[1]);
    // Not the ring's point, nor a rope that isn't there.
    expect(page.movePoint(pose, 0, 3, page.bonePoint("spine", [0, 0, 0]))).toBe(pose);
    expect(page.movePoint(pose, 5, 0, page.bonePoint("spine", [0, 0, 0]))).toBe(pose);
  });

  it("takes a point out, and with it what was tied on that rope; a rope of two points goes altogether", () => {
    const pose = base();
    const fewer = page.removePoint(pose, 0, 0);
    expect(fewer.ropes.length).toBe(1);
    expect(fewer.ropes[0].p).toEqual(pose.ropes[0].p.slice(1));
    // Nothing tied on it: only the point goes.
    const alone = { ...pose, ropes: [pose.ropes[0]] };
    expect(page.removePoint(alone, 0, 2).ropes[0].p.length).toBe(3);
    const short = { ...page.newPose(), ropes: [rope([["chest", 0, 0, 100], ["chest", 100, 0, 0]])] };
    expect(page.removePoint(short, 0, 0).ropes).toEqual([]);
    // The ring's point can't be taken out by a dot.
    expect(page.removePoint(pose, 0, 3)).toBe(pose);
  });
});
