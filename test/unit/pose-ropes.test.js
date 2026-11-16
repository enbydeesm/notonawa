// Ropes that do more than lie on the body: cinches pulling an upline aside
// (pose-format.js, pose-cinch.js), the body moved to keep the uplines'
// lengths and see-saw ropes over the ring (pose-constraints.js), checked
// by the server too (src/poses/parse.js); and the poser's pencil marks
// (pose-marks.js).
import { describe, it, expect } from "vitest";
import { Vector3 } from "../../public/js/vendor/three.js";
import * as page from "../../public/js/pose-format.js";
import * as server from "../../src/poses/parse.js";
import { JOINTS } from "../../public/js/figure-rig.js";
import { makeSkeleton, posed, ropePoint, RING_RADIUS } from "../../public/js/pose-skeleton.js";
import { cinchPoints, bends, ropeLine, ropeRuns, segmentLength, spotOn, spotPoint, sagging } from "../../public/js/pose-cinch.js";
import { cinchBody, keepSeesaws, chainFor, ropeLength, setRopeLength } from "../../public/js/pose-constraints.js";
import { toViewUnits, viewBox, onPicture, marksShow, addMark, markAt, VIEW_HEIGHT } from "../../public/js/pose-marks.js";

/** @typedef {import("../../public/js/pose-format.js").Pose} Pose */
/** @typedef {import("../../public/js/pose-format.js").Rope} Rope */
/** @typedef {import("../../public/js/pose-format.js").RopePoint} RopePoint */

/** @param {RopePoint[]} p @param {Partial<Rope>} [more] @returns {Rope} */
const rope = (p, more = {}) => ({ c: "red", w: 2, p, ...more });
/** @type {RopePoint} */
const RING = ["ring", 0, 0, 0];

/**
 * Face down under a ring, with uplines from the chest and the left thigh,
 * and a cinch between them halfway up (taut, at first).
 */
function suspended() {
  /** @type {Pose} */
  const base = { ...page.newPose(), body: [90, 0, 0], lift: 110, ring: [0, 195, 0] };
  const withUplines = { ...base, ropes: [rope([["chest", 0, 0, 0], RING]), rope([["l_hip", 0, -200, 0], RING])] };
  const taut = page.addCinch(withUplines, { c: "blue", w: 1 }, [page.ropeSpot(0, 0, 0.5), page.ropeSpot(1, 0, 0.5)], 0);
  const skeleton = makeSkeleton();
  posed(skeleton, taut);
  const gap = Math.round(cinchPoints(skeleton, taut, 2).span);
  return { pose: page.setCinchLength(taut, 2, gap), gap };
}

/** Within 1.5 cm: the solver stops close, and poses keep whole degrees. @param {number} a @param {number} b */
const near = (a, b) => expect(Math.abs(a - b)).toBeLessThan(1.5);

/** A skeleton posed in a pose. @param {Pose} pose */
function measure(pose) {
  const skeleton = makeSkeleton();
  posed(skeleton, pose);
  return skeleton;
}

/** Every joint's angles within its limits, as whole degrees. @param {Pose} pose */
function withinLimits(pose) {
  for (const joint of JOINTS) {
    joint.moves.forEach((m, i) => {
      const a = pose.joints[joint.name][i];
      expect(Number.isInteger(a), joint.name).toBe(true);
      expect(a).toBeGreaterThanOrEqual(m.min);
      expect(a).toBeLessThanOrEqual(m.max);
    });
  }
}

describe("cinches, in the format", () => {
  it("are tied through spots on ropes or the body, one at least on a rope, any number on a rope", () => {
    const { pose } = suspended();
    expect(page.isCinch(pose.ropes[2])).toBe(true);
    expect(page.isUpline(pose.ropes[0])).toBe(true);
    expect(page.cinchesOn(pose, 0)).toEqual([2]);
    expect(page.ropeSpot(1, 0, 0.0001)).toEqual(["rope", 1, 0, 20]);
    const body = page.bonePoint("pelvis", [0, 0, 0]);
    // Another on the same uplines, and one on the same upline twice.
    expect(page.cantCinch(pose, [page.ropeSpot(0, 0, 0.3), body])).toBeNull();
    expect(page.cantCinch(pose, [page.ropeSpot(0, 0, 0.3), page.ropeSpot(0, 0, 0.6)])).toBeNull();
    // A bridge back and forth between the uplines.
    expect(page.cantCinch(pose, [0.2, 0.3, 0.4, 0.5].map((t, k) => page.ropeSpot(k % 2, 0, t)))).toBeNull();
    expect(page.cantCinch(pose, [page.ropeSpot(2, 0, 0.5), body])).toMatch(/another cinch/);
    expect(page.cantCinch(pose, [page.ropeSpot(5, 0, 0.3), body])).toMatch(/isn't there/);
    expect(page.cantCinch(pose, [page.ropeSpot(0, 0, 0.3)])).toMatch(/Tap another rope/);
    expect(page.cantCinchAt(pose, RING)).toMatch(/not the ring/);
    // Spots on two ropes aren't the same point, however close their numbers.
    const laid = page.addPoint(rope([page.ropeSpot(1, 0, 0.5)]), page.ropeSpot(2, 0, 0.5));
    expect(laid.p).toHaveLength(2);
    expect(page.addPoint(laid, page.ropeSpot(2, 0, 0.502)).p).toHaveLength(2);
    // On a rope round the body, with no point where an upline hangs: fine,
    // and it pulls those ropes together rather than any upline.
    const onBody = { ...pose, ropes: [...pose.ropes, rope([["chest", 0, 0, 0], ["pelvis", 0, 0, 0]])] };
    expect(page.cantCinch(onBody, [page.ropeSpot(3, 0, 0.5), body])).toBeNull();
    expect(page.pullsUplines(onBody.ropes, rope([page.ropeSpot(3, 0, 0.5), body], { l: 0 }))).toBe(false);
    expect(page.pullsUplines(pose.ropes, pose.ropes[2])).toBe(true);
    // Never only on the body.
    expect(page.cantCinch(onBody, [body, page.bonePoint("chest", [0, 0, 0])])).toMatch(/a point on a rope/);
  });

  it("go with a rope they're on, and the rest are renumbered", () => {
    const { pose } = suspended();
    const first = rope([["chest", 0, 0, 0], ["pelvis", 0, 0, 0]]);
    const moved = { ...pose, ropes: [first, ...pose.ropes.slice(0, 2), { ...pose.ropes[2], p: [page.ropeSpot(1, 0, 0.5), page.ropeSpot(2, 0, 0.5)] }] };
    const without = page.removeRope(moved, 0);
    expect(without.ropes).toEqual(pose.ropes);
    expect(page.removeRope(pose, 1).ropes).toEqual([pose.ropes[0]]);
    expect(page.removeRope(pose, 2).ropes).toEqual(pose.ropes.slice(0, 2));
  });

  it("stay between a ring and a bamboo, and go with the uplines otherwise", () => {
    const { pose } = suspended();
    expect(page.setHardpoint(pose, "bamboo").ropes[2]).toEqual(pose.ropes[2]);
    expect(page.setHardpoint(pose, "hashira").ropes).toEqual([]);
    const seesaw = page.finishRope(pose, rope([["l_wrist", 0, 0, 0], RING, ["r_wrist", 0, 0, 0]]));
    expect(page.setHardpoint(seesaw, "hashira").ropes).toEqual([rope([["l_wrist", 0, 0, 0], ["r_wrist", 0, 0, 0]])]);
  });

  it("are saved, checked, by the server", () => {
    const { pose } = suspended();
    expect(server.parsePose(pose)).toEqual(pose);
    const bad = (/** @type {Rope[]} */ ropes, /** @type {RegExp} */ why) => expect(() => server.parsePose({ ...pose, ropes })).toThrow(why);
    const [a, b, cinch] = pose.ropes;
    bad([a, b, { ...cinch, l: 1001 }], /cinch isn't/);
    bad([a, b, { ...cinch, l: 2.5 }], /cinch isn't/);
    bad([a, b, { ...cinch, l: undefined }], /added to another isn't/);
    // Several cinches on a rope, one through three points, one on the same rope twice: fine.
    const more = [a, b, cinch, { ...cinch }, { ...cinch, p: [...cinch.p, ["chest", 0, 0, 0]] }, { ...cinch, p: [["rope", 0, 0, 300], ["rope", 0, 0, 700]] }];
    expect(server.parsePose({ ...pose, ropes: more }).ropes).toEqual(more);
    bad([a, b, { ...cinch, p: [["rope", 0, 0, 1000], cinch.p[1]] }], /cinch isn't/);
    bad([a, b, { ...cinch, p: [["rope", 7, 0, 500], cinch.p[1]] }], /isn't there/);
    bad([a, b, { ...cinch, p: [["rope", 0, 1, 500], cinch.p[1]] }], /isn't there/);
    bad([a, b, cinch, { ...cinch, p: [["rope", 2, 0, 500], ["chest", 0, 0, 0]] }], /isn't there/);
    bad([a, b, { ...cinch, p: [cinch.p[0], RING] }], /cinch isn't/);
    const plain = rope([["chest", 0, 0, 0], ["pelvis", 0, 0, 0]]);
    // On a rope round the body only: fine. On no rope at all: not a cinch.
    const round = [plain, { ...cinch, p: [["rope", 0, 0, 500], ["chest", 0, 0, 0]] }];
    expect(server.parsePose({ ...pose, ring: null, ropes: round }).ropes).toEqual(round);
    bad([plain, { ...cinch, p: [["pelvis", 0, 0, 0], ["chest", 0, 0, 0]] }], /isn't on a rope/);
  });
});

describe("a cinch, in the room", () => {
  it("leaves the uplines straight while taut, and bends them toward each other as it's shortened", () => {
    const { pose, gap } = suspended();
    const skeleton = measure(pose);
    const taut = cinchPoints(skeleton, pose, 2);
    expect(taut.to[0].distanceTo(taut.from[0])).toBeLessThan(0.01);
    const straight = segmentLength(skeleton, pose, 0, 0);
    const shorter = page.setCinchLength(pose, 2, gap - 20);
    const pulled = cinchPoints(skeleton, shorter, 2);
    expect(pulled.to[0].distanceTo(pulled.to[1])).toBeCloseTo(gap - 20, 0);
    expect(pulled.to[0].distanceTo(pulled.from[0])).toBeCloseTo(10, 0);
    expect(ropeLine(skeleton, shorter, 0)).toHaveLength(3);
    expect(ropeLine(skeleton, shorter, 2)).toEqual(pulled.to);
    expect(bends(skeleton, shorter).get(1)?.[0].segment).toBe(0);
    expect(segmentLength(skeleton, shorter, 0, 0)).toBeGreaterThan(straight + 1);
    // Longer than the gap is taut, not slack.
    expect(cinchPoints(skeleton, page.setCinchLength(pose, 2, gap + 50), 2).to[0].distanceTo(taut.from[0])).toBeLessThan(0.01);
  });

  it("is drawn with each hanging stretch straight, a bend making two, and the rest curving round the body", () => {
    const { pose, gap } = suspended();
    // Round the hips and waist first, then up: its hanging stretch is segment 2.
    /** @type {Pose} */
    const wrapped = {
      ...pose, ropes: [{ ...pose.ropes[0], p: [["pelvis", 0, 0, 0], ["spine", 0, 0, 0], ...pose.ropes[0].p] }, pose.ropes[1],
        { ...pose.ropes[2], p: [page.ropeSpot(0, 2, 0.5), pose.ropes[2].p[1]] }],
    };
    const shorter = page.setCinchLength(wrapped, 2, gap - 20);
    const skeleton = measure(shorter);
    // Round the body: through its three points, and more between them to lie on the skin.
    const [round, ...hanging] = ropeRuns(skeleton, shorter, 0);
    expect(round.length).toBeGreaterThanOrEqual(3);
    expect(hanging.map((run) => run.length)).toEqual([2, 2]);
    expect(ropeRuns(skeleton, shorter, 2).map((run) => run.length)).toEqual([2]);
    const seesaw = rope([["l_wrist", 0, 0, 0], RING, ["r_wrist", 0, 0, 0]]);
    expect(ropeRuns(skeleton, { ...shorter, ropes: [seesaw] }, 0).map((run) => run.length)).toEqual([2, 2]);
  });

  it("pulls more than one point, each toward those beside it, until its line is as long as it is", () => {
    const { pose, gap } = suspended();
    // A bridge: chest's upline, thigh's, chest's again.
    const bridge = rope([page.ropeSpot(0, 0, 0.4), page.ropeSpot(1, 0, 0.5), page.ropeSpot(0, 0, 0.6)], { l: 0 });
    const tied = { ...pose, ropes: [pose.ropes[0], pose.ropes[1], bridge] };
    const skeleton = measure(tied);
    const { span } = cinchPoints(skeleton, tied, 2);
    const shorter = page.setCinchLength(tied, 2, Math.round(span - 30));
    const { from, to } = cinchPoints(skeleton, shorter, 2);
    const length = to.reduce((sum, p, i) => (i ? sum + p.distanceTo(to[i - 1]) : 0), 0);
    expect(length).toBeCloseTo(span - 30, 0);
    for (let k = 0; k < 3; k++) expect(to[k].distanceTo(from[k])).toBeGreaterThan(1);
    // Two bends on the chest's upline, in order along it; its line goes through both.
    const bent = bends(skeleton, shorter);
    expect(bent.get(0)?.map((b) => b.along)).toEqual([400, 600]);
    expect(ropeLine(skeleton, shorter, 0, bent)).toHaveLength(4);
    expect(ropeRuns(skeleton, shorter, 0, bent).map((run) => run.length)).toEqual([2, 2, 2]);
    expect(gap).toBeGreaterThan(0);
  });

  it("pulls only the upline when its other end is on the body", () => {
    const { pose } = suspended();
    const toBody = { ...pose, ropes: [pose.ropes[0], pose.ropes[1], rope([page.ropeSpot(0, 0, 0.5), ["pelvis", 0, 0, 0]], { l: 0 })] };
    const skeleton = measure(toBody);
    const { from, to } = cinchPoints(skeleton, toBody, 2);
    expect(to[1].distanceTo(from[1])).toBeLessThan(0.01);
    expect(to[0].distanceTo(from[1])).toBeLessThan(0.01);
  });

  it("on ropes round the body only, pulls them together, its points on the body staying", () => {
    // Two wraps round the trunk (no hardpoint), a cinch between them and on to the pelvis.
    /** @type {Pose} */
    const wraps = {
      ...page.newPose(),
      ropes: [rope([["chest", -150, 0, 120], ["chest", 150, 0, 120]]), rope([["spine", -150, 0, 120], ["spine", 150, 0, 120]])],
    };
    const tied = { ...wraps, ropes: [...wraps.ropes, rope([page.ropeSpot(0, 0, 0.5), page.ropeSpot(1, 0, 0.5)], { l: 0 })] };
    const skeleton = measure(tied);
    const { span } = cinchPoints(skeleton, tied, 2);
    expect(span).toBeGreaterThan(5);
    const shorter = page.setCinchLength(tied, 2, Math.round(span / 2));
    const { from, to } = cinchPoints(skeleton, shorter, 2);
    expect(to[0].distanceTo(to[1])).toBeCloseTo(Math.round(span / 2), 0);
    // Both ends moved, half the way each.
    expect(to[0].distanceTo(from[0])).toBeCloseTo(to[1].distanceTo(from[1]), 1);
    expect(to[0].distanceTo(from[0])).toBeGreaterThan(1);
    // Each wrap bends where it's pulled, and is drawn through the bend.
    const bent = bends(skeleton, shorter);
    expect(bent.get(0)?.map((b) => b.along)).toEqual([500]);
    expect(bent.get(1)?.map((b) => b.along)).toEqual([500]);
    // A rope of two points is drawn straight, so in two runs either side of the bend.
    expect(ropeRuns(skeleton, shorter, 0, bent).map((run) => run.length)).toEqual([2, 2]);
    // Its point on the body stays where it is.
    const toBody = { ...wraps, ropes: [...wraps.ropes, rope([page.ropeSpot(0, 0, 0.5), ["pelvis", 0, 0, 0]], { l: 0 })] };
    const pulled = cinchPoints(skeleton, page.setCinchLength(toBody, 2, 1), 2);
    expect(pulled.to[1].distanceTo(pulled.from[1])).toBeLessThan(0.01);
    expect(pulled.to[0].distanceTo(pulled.from[0])).toBeGreaterThan(1);
    // A cinch on an upline and a body rope still pulls only the upline.
    const { pose } = suspended();
    const mixed = { ...pose, ropes: [...pose.ropes.slice(0, 2), rope([["chest", -150, 0, 120], ["chest", 150, 0, 120]])] };
    const both = { ...mixed, ropes: [...mixed.ropes, rope([page.ropeSpot(0, 0, 0.5), page.ropeSpot(2, 0, 0.5)], { l: 1 })] };
    const pair = cinchPoints(measure(both), both, 3);
    expect(pair.to[1].distanceTo(pair.from[1])).toBeLessThan(0.01);
    expect(pair.to[0].distanceTo(pair.from[0])).toBeGreaterThan(1);
  });

  it("finds where on a rope it was tapped", () => {
    const { pose } = suspended();
    const skeleton = measure(pose);
    const top = ropePoint(skeleton, RING, pose);
    const bottom = ropePoint(skeleton, ["chest", 0, 0, 0], pose);
    const tapped = bottom.clone().lerp(top, 0.25).add(new Vector3(0.5, 0, 0));
    const spot = spotOn(skeleton, pose, 0, tapped);
    expect(spot.segment).toBe(0);
    expect(spot.along).toBeCloseTo(0.25, 2);
  });
});

describe("the ring", () => {
  it("is 15 cm across, uplines tied on at its bottom, the body left where a saved pose has it", () => {
    expect(RING_RADIUS * 2).toBe(15);
    const { pose } = suspended();
    const skeleton = measure(pose);
    const top = ropePoint(skeleton, RING, pose);
    expect([top.x, top.y, top.z]).toEqual([0, 195 - 7.5, 0]);
    // The body is placed by its own numbers, not by the ring: only the upline's length follows the ring's size.
    const chest = ropePoint(skeleton, ["chest", 0, 0, 0], pose);
    const moved = ropePoint(measure({ ...pose, ring: [0, 205, 0] }), ["chest", 0, 0, 0], pose);
    expect(moved.distanceTo(chest)).toBeLessThan(0.001);
  });
});

describe("a rope added to another", () => {
  it("starts at a spot on it, follows it as it bends, and goes with it", () => {
    const { pose, gap } = suspended();
    const added = rope([page.ropeSpot(0, 0, 0.7), ["r_wrist", 0, 0, 0]]);
    expect(page.cantAddTo(pose, 0)).toBeNull();
    expect(page.cantAddTo(pose, 2)).toMatch(/to a cinch/);
    const tied = page.finishRope(pose, added);
    expect(page.isAdded(tied.ropes[3])).toBe(true);
    expect(page.canSeesaw(rope([page.ropeSpot(0, 0, 0.7), RING, ["r_wrist", 0, 0, 0]]))).toBe(false);
    expect(server.parsePose(tied)).toEqual(tied);
    // Its start is on the upline as drawn, through the cinch's bend.
    const shorter = page.setCinchLength(tied, 2, gap - 20);
    const skeleton = measure(shorter);
    const start = ropeLine(skeleton, shorter, 3)[0];
    expect(start.distanceTo(spotPoint(skeleton, shorter, added.p[0]))).toBeLessThan(0.01);
    expect(start.distanceTo(ropePoint(skeleton, added.p[0], shorter))).toBeGreaterThan(0.5);
    // Erasing the upline takes it too; erasing an earlier rope renumbers it.
    expect(page.removeRope(tied, 0).ropes).toEqual([pose.ropes[1]]);
    const later = { ...tied, ropes: [rope([["chest", 0, 0, 0], ["pelvis", 0, 0, 0]]), ...tied.ropes.map((r) => ({
      ...r, p: r.p.map((p) => /** @type {RopePoint} */ (p[0] === "rope" ? ["rope", p[1] + 1, p[2], p[3]] : p)) }))] };
    expect(page.removeRope(later, 0).ropes).toEqual(tied.ropes);
  });

  it("is checked by the server: on a rope before it, not a cinch, with no other spot", () => {
    const { pose } = suspended();
    const bad = (/** @type {Rope[]} */ ropes, /** @type {RegExp} */ why) => expect(() => server.parsePose({ ...pose, ropes })).toThrow(why);
    const [a, b, cinch] = pose.ropes;
    bad([a, b, cinch, rope([["rope", 3, 0, 500], ["chest", 0, 0, 0]])], /isn't there/);
    bad([a, b, cinch, rope([["rope", 2, 0, 500], ["chest", 0, 0, 0]])], /isn't there/);
    bad([a, b, cinch, rope([["rope", 0, 0, 500], ["rope", 1, 0, 500]])], /added to another isn't/);
  });
});

describe("slack", () => {
  it("makes a rope's hanging stretches sag, saved with it, nothing else moving", () => {
    const { pose } = suspended();
    const slack = page.setSlack(pose, 0, 40);
    expect(slack.ropes[0].k).toBe(40);
    expect(page.setSlack(slack, 0, 0).ropes[0].k).toBeUndefined();
    expect(page.setSlack(pose, 0, 500).ropes[0].k).toBe(300);
    expect(page.setSlack(pose, 2, 30).ropes[2]).toEqual(pose.ropes[2]);
    expect(server.parsePose(slack)).toEqual(slack);
    expect(() => server.parsePose(page.setSlack(pose, 0, 40) && { ...pose, ropes: [{ ...pose.ropes[0], k: 301 }, ...pose.ropes.slice(1)] })).toThrow(/slack/);
    expect(server.parsePose({ ...pose, ropes: [{ ...pose.ropes[0], k: 300 }, ...pose.ropes.slice(1)] }).ropes[0].k).toBe(300);
    expect(slack.joints).toEqual(pose.joints);
    const skeleton = measure(slack);
    const [run] = ropeRuns(skeleton, slack, 0);
    expect(run.length).toBeGreaterThan(2);
    const straight = ropeRuns(skeleton, pose, 0)[0];
    // Ends where they were, the middle hanging lower.
    expect(run[0].distanceTo(straight[0])).toBeLessThan(0.01);
    expect(run[run.length - 1].distanceTo(straight[straight.length - 1])).toBeLessThan(0.01);
    const middle = straight[0].clone().lerp(straight[straight.length - 1], 0.5);
    expect(run[5].y).toBeLessThan(middle.y - 3);
    // Without the cinch's bend: a spot halfway up, and a rope added there, are on the sag as drawn.
    const plain = page.setSlack({ ...pose, ropes: pose.ropes.slice(0, 2) }, 0, 40);
    const [sag] = ropeRuns(skeleton, plain, 0);
    const spot = page.ropeSpot(0, 0, 0.5);
    expect(spotPoint(skeleton, plain, spot).distanceTo(sag[5])).toBeLessThan(0.5);
    const added = page.finishRope(plain, rope([spot, ["r_wrist", 0, 0, 0]]));
    expect(ropeLine(skeleton, added, 2)[0].distanceTo(sag[5])).toBeLessThan(0.5);
  });

  it("sags deeper with more slack, and bows a rope hanging straight down forward", () => {
    const a = new Vector3(0, 100, 0), b = new Vector3(100, 100, 0);
    const depth = (/** @type {number} */ extra) => a.y - sagging(a, b, extra)[5].y;
    expect(depth(10)).toBeGreaterThan(5);
    expect(depth(40)).toBeGreaterThan(depth(10));
    expect(sagging(a, b, 0)).toEqual([a, b]);
    const down = sagging(new Vector3(0, 200, 0), new Vector3(0, 100, 0), 20);
    expect(down[5].z).toBeGreaterThan(5);
  });
});

describe("moving the body", () => {
  it("is done by the joints between the body and the rope's end", () => {
    expect(chainFor("l_knee").map((a) => "joint" in a && a.joint)).toContain("l_hip");
    expect(chainFor("chest").map((a) => "joint" in a && a.joint)).toEqual(["spine", "spine", "chest", "chest"]);
    expect(chainFor("pelvis")).toEqual([{ body: 0 }, { body: 2 }, { lift: true }]);
  });

  it("with a cinch, keeps the uplines as long as they were, drawing the chest and thigh together", () => {
    const { pose, gap } = suspended();
    const before = measure(pose);
    const lengths = [segmentLength(before, pose, 0, 0), segmentLength(before, pose, 1, 0)];
    const chestToThigh = ropePoint(before, ["chest", 0, 0, 0], pose).distanceTo(ropePoint(before, ["l_hip", 0, -200, 0], pose));
    const moved = cinchBody(pose, 2, gap - 20);
    expect(moved.ropes[2].l).toBe(gap - 20);
    const after = measure(moved);
    expect(segmentLength(after, moved, 0, 0)).toBeCloseTo(lengths[0], 0);
    expect(segmentLength(after, moved, 1, 0)).toBeCloseTo(lengths[1], 0);
    expect(ropePoint(after, ["chest", 0, 0, 0], moved).distanceTo(ropePoint(after, ["l_hip", 0, -200, 0], moved))).toBeLessThan(chestToThigh);
    withinLimits(moved);
  });

  it("round the body, with Move the body, draws the parts it's tied to together, the ropes staying as tied", () => {
    // A wrap round the left forearm and one round the left thigh, the arm out a little, cinched together.
    /** @type {Pose} */
    const standing = page.setJoint(page.newPose(), "l_shoulder", 1, 40);
    const wraps = { ...standing, ropes: [rope([["l_wrist", -40, -60, 0], ["l_wrist", 40, -60, 0]]), rope([["l_hip", -60, -200, 0], ["l_hip", 60, -200, 0]])] };
    const tied = page.addCinch(wraps, { c: "blue", w: 1 }, [page.ropeSpot(0, 0, 0.5), page.ropeSpot(1, 0, 0.5)], 0);
    const span = cinchPoints(measure(tied), tied, 2).span;
    expect(span).toBeGreaterThan(20);
    const moved = cinchBody(tied, 2, Math.round(span - 15));
    expect(moved.ropes[2].l).toBe(Math.round(span - 15));
    expect(moved.joints.l_shoulder).not.toEqual(tied.joints.l_shoulder);
    const after = cinchPoints(measure(moved), moved, 2);
    // The arm came in, so the cinch is short enough as tied: the wraps aren't pulled off the body.
    near(after.span, Math.round(span - 15));
    after.to.forEach((at, k) => expect(at.distanceTo(after.from[k])).toBeLessThan(1));
    withinLimits(moved);
    // Both ends on one part: nothing can bring them closer, so the cinch pulls the ropes as before.
    const chest = { ...standing, ropes: [rope([["chest", -150, 0, 130], ["chest", 150, 0, 130]]), rope([["chest", -150, -80, 130], ["chest", 150, -80, 130]])] };
    const cinched = page.addCinch(chest, { c: "blue", w: 1 }, [page.ropeSpot(0, 0, 0.5), page.ropeSpot(1, 0, 0.5)], 0);
    const shorter = cinchBody(cinched, 2, 1);
    expect(shorter.joints).toEqual(cinched.joints);
    expect(shorter).toEqual(page.setCinchLength(cinched, 2, 1));
  });

  it("gives a two-point rope a Length: shorter moves the body, longer is slack", () => {
    // Arms out to the sides, a rope from wrist to wrist across the front.
    /** @type {Pose} */
    const open = page.setJoint(page.setJoint({ ...page.newPose(), ring: [0, 250, 0] }, "l_shoulder", 1, 80), "r_shoulder", 1, 80);
    const across = { ...open, ropes: [rope([["l_wrist", 0, -60, 0], ["r_wrist", 0, -60, 0]])] };
    expect(page.hasLength(across.ropes[0])).toBe(true);
    const length = ropeLength(measure(across), across, 0);
    expect(length).toBeGreaterThan(60);
    // Longer: slack, the body as it was, drawn sagging.
    const slack = setRopeLength(across, 0, Math.round(length) + 20);
    expect(slack.joints).toEqual(across.joints);
    expect(slack.ropes[0].k).toBeCloseTo(20, -0.5);
    const [run] = ropeRuns(measure(slack), slack, 0);
    expect(run.length).toBe(11);
    expect(Math.min(...run.map((v) => v.y))).toBeLessThan(Math.min(run[0].y, run[10].y) - 5);
    // Shorter: the arms come in, no slack.
    const shorter = setRopeLength(slack, 0, Math.round(length) - 30);
    expect(shorter.ropes[0].k).toBeUndefined();
    near(ropeLength(measure(shorter), shorter, 0), Math.round(length) - 30);
    expect(shorter.joints.l_shoulder).not.toEqual(open.joints.l_shoulder);
    withinLimits(shorter);
    // To the ring from a wrist: the arm reaches up to it.
    const up = { ...open, ropes: [rope([["l_wrist", 0, -60, 0], RING])] };
    const toRing = ropeLength(measure(up), up, 0);
    const reached = setRopeLength(up, 0, Math.round(toRing) - 20);
    near(ropeLength(measure(reached), reached, 0), Math.round(toRing) - 20);
    expect(reached.lift).toBe(up.lift);
    // To the ring from the chest: the whole body rises to it, its joints as they were.
    const chest = { ...open, ropes: [rope([["chest", 0, 0, 0], RING])] };
    const fromChest = ropeLength(measure(chest), chest, 0);
    const lifted = setRopeLength(chest, 0, Math.round(fromChest) - 20);
    expect(lifted.lift).toBeGreaterThan(chest.lift);
    expect(lifted.joints).toEqual(chest.joints);
    near(ropeLength(measure(lifted), lifted, 0), Math.round(fromChest) - 20);
    // From a spot on an upline to a wrist: the arm comes to the spot.
    const twoUplines = { ...open, ropes: [rope([["chest", 0, 0, 0], RING]), rope([page.ropeSpot(0, 0, 0.5), ["l_wrist", 0, -60, 0]])] };
    expect(page.hasLength(twoUplines.ropes[1])).toBe(true);
    const toSpot = ropeLength(measure(twoUplines), twoUplines, 1);
    const drawn = setRopeLength(twoUplines, 1, Math.round(toSpot) - 15);
    near(ropeLength(measure(drawn), drawn, 1), Math.round(toSpot) - 15);
    expect(drawn.joints.l_shoulder).not.toEqual(open.joints.l_shoulder);
    // Longer ropes and cinches keep Slack and their own length.
    expect(page.hasLength(rope([["chest", 0, 0, 0], RING, ["l_hip", 0, -200, 0]]))).toBe(false);
    expect(page.hasLength(rope([page.ropeSpot(0, 0, 0.5), ["chest", 0, 0, 0]], { l: 10 }))).toBe(false);
    expect(page.hasLength(rope([RING, page.ropeSpot(0, 0, 0.5)]))).toBe(false);
  });

  it("with a see-saw rope, takes the other end away as one end comes closer", () => {
    // Both arms out to the sides, so the right hand can come down as the left goes up.
    /** @type {Pose} */
    const standing = page.setJoint(page.setJoint({ ...page.newPose(), ring: [0, 250, 0] }, "l_shoulder", 1, 90), "r_shoulder", 1, 90);
    const before = page.finishRope(standing, rope([["l_wrist", 0, -80, 0], RING, ["r_wrist", 0, -80, 0]]));
    expect(before.ropes[0].s).toBe(true);
    const total = (/** @type {Pose} */ p) => {
      const sk = measure(p);
      return segmentLength(sk, p, 0, 0) + segmentLength(sk, p, 0, 1);
    };
    const raised = page.setJoint(before, "l_shoulder", 1, 110);
    expect(total(raised)).toBeLessThan(total(before) - 2);
    const kept = keepSeesaws(before, raised, ["l_shoulder"]);
    expect(total(kept)).toBeCloseTo(total(before), 0);
    expect(kept.joints.l_shoulder).toEqual(raised.joints.l_shoulder);
    expect(kept.joints.r_shoulder[1]).toBeLessThan(90);
    withinLimits(kept);
    // Not a see-saw: nothing else moves.
    const tied = page.setSeesaw(before, 0, false);
    expect(tied.ropes[0].s).toBeUndefined();
    const raisedTied = page.setJoint(tied, "l_shoulder", 1, 110);
    expect(keepSeesaws(tied, raisedTied, ["l_shoulder"])).toBe(raisedTied);
    // Its other end on the hips: nothing can take it up.
    const toHips = page.finishRope(standing, rope([["l_wrist", 0, -80, 0], RING, ["pelvis", 0, 0, 0]]));
    const raisedHips = page.setJoint(toHips, "l_shoulder", 1, 110);
    expect(keepSeesaws(toHips, raisedHips, ["l_shoulder"])).toBe(raisedHips);
  });

  it("only makes a see-saw of a rope over the ring or bamboo and back", () => {
    expect(page.canSeesaw(rope([["chest", 0, 0, 0], RING, ["pelvis", 0, 0, 0]]))).toBe(true);
    expect(page.canSeesaw(rope([["chest", 0, 0, 0], RING]))).toBe(false);
    expect(page.canSeesaw(rope([["chest", 0, 0, 0], RING, ["pelvis", 0, 0, 0], RING, ["chest", 0, 0, 0]]))).toBe(false);
    expect(page.finishRope(page.newPose(), rope([["chest", 0, 0, 0], ["pelvis", 0, 0, 0]])).ropes[0].s).toBeUndefined();
    const seesaw = { ...page.newPose(), ring: [0, 195, 0], ropes: [rope([["chest", 0, 0, 0], RING, ["pelvis", 0, 0, 0]], { s: true })] };
    expect(server.parsePose(seesaw)).toEqual(seesaw);
    const notOne = { ...seesaw, ropes: [rope([["chest", 0, 0, 0], RING], { s: true })] };
    expect(() => server.parsePose(notOne)).toThrow(/see-saw/);
    expect(() => server.parsePose({ ...seesaw, ropes: [{ ...seesaw.ropes[0], s: 1 }] })).toThrow(/rope isn't/);
    expect(page.setSeesaw(notOne, 0, true).ropes[0].s).toBeUndefined();
  });
});

describe("moving an upline along the bamboo", () => {
  it("slides that rope's point on the bamboo, kept on it, leaving the rest", () => {
    const { pose } = suspended();
    const b = page.setHardpoint(pose, "bamboo");
    const moved = page.moveAlongBamboo(b, 0, 1, -40);
    expect(moved.ropes[0].p[1]).toEqual(["bamboo", -400, 0, 0]);
    expect(moved.ropes[1]).toEqual(b.ropes[1]);
    expect(page.moveAlongBamboo(b, 0, 1, 500).ropes[0].p[1]).toEqual(["bamboo", 760, 0, 0]);
    // Not a point on the bamboo, or no bamboo: nothing changes.
    expect(page.moveAlongBamboo(b, 0, 0, 10)).toBe(b);
    expect(page.moveAlongBamboo(pose, 0, 1, 10)).toBe(pose);
    expect(server.parsePose(moved)).toEqual(moved);
  });
});

describe("what's only the poser's", () => {
  it("isn't saved: pencil marks, and whether a cinch moves the body", () => {
    const { pose } = suspended();
    const editing = { ...pose, marks: { camera: pose.camera, strokes: [] }, ropes: pose.ropes.map((r, i) => (i === 2 ? { ...r, still: /** @type {true} */ (true) } : r)) };
    expect(page.forSaving(editing)).toEqual(pose);
    expect(server.parsePose(editing)).toEqual(pose);
  });
});

describe("pencil marks", () => {
  /** @type {import("../../public/js/pose-format.js").Camera} */
  const camera = [25, 8, 330, 100, 0, 0];

  it("are kept in view units: from the middle across, and 1000 down", () => {
    expect(toViewUnits(200, 300, { width: 400, height: 600 })).toEqual([0, 500]);
    expect(toViewUnits(0, 0, { width: 400, height: 600 })).toEqual([-333, 0]);
    expect(viewBox({ width: 500, height: 1000 })).toBe(`-250 0 500 ${VIEW_HEIGHT}`);
  });

  it("go on a picture of another shape over what they were drawn on", () => {
    const [line] = onPicture([{ c: "red", w: 2, p: [0, 500, -100, 1000] }], { width: 900, height: 1200 });
    expect(line.p).toEqual([450, 600, 330, 1200]);
    expect(line.width).toBeCloseTo(10);
  });

  it("show only on the view they were drawn on, and a new view starts afresh", () => {
    const first = addMark(undefined, camera, { c: "red", w: 2, p: [0, 0, 10, 10] });
    expect(marksShow(first, camera)).toBe(true);
    expect(marksShow(first, [26, 8, 330, 100, 0, 0])).toBe(false);
    expect(marksShow(undefined, camera)).toBe(false);
    const second = addMark(first, camera, { c: "blue", w: 1, p: [50, 50] });
    expect(second.strokes).toHaveLength(2);
    const turned = addMark(second, [90, 8, 330, 100, 0, 0], { c: "blue", w: 1, p: [50, 50] });
    expect(turned.strokes).toHaveLength(1);
    expect(markAt(second.strokes, [5, 5])).toBe(0);
    expect(markAt(second.strokes, [300, 300])).toBe(-1);
  });
});
