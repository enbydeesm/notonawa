// Poses: the server's checks (src/poses/parse.js), the page's pure parts
// (figure-rig.js, pose-format.js, import-poses.js), and the figure itself:
// posed with three.js's math (pose-skeleton.js), its presets put the body
// where their names say.
import { describe, it, expect } from "vitest";
import * as server from "../../src/poses/parse.js";
import * as page from "../../public/js/pose-format.js";
import {
  JOINTS, BODY_PRESETS, ARMS_PRESETS, ARM_JOINTS, ORIENTATIONS, SHAPES, STANDING_LIFT, withBodyPreset, withArmsPreset, clampJoint, jointRotation,
} from "../../public/js/figure-rig.js";
import { makeSkeleton, posed, onBone, ropePoint, toBone, toHardpoint, BAMBOO_RADIUS } from "../../public/js/pose-skeleton.js";
import { takePoses } from "../../public/js/import-poses.js";

/** @typedef {import("../../public/js/pose-format.js").Pose} Pose */

/** @param {Partial<Pose>} [changes] @returns {Pose} */
const pose = (changes = {}) => ({ ...page.newPose(), ...changes });

/**
 * A new pose with a body preset and an arms preset, by name.
 * @param {string} body
 * @param {string} [arms]
 */
function preset(body, arms = "At sides") {
  const b = BODY_PRESETS.find((p) => p.name === body);
  const a = ARMS_PRESETS.find((p) => p.name === arms);
  if (!b || !a) throw new Error(`No preset ${body} / ${arms}`);
  const p = page.newPose();
  return page.withPosture(p, withArmsPreset(withBodyPreset(p, b), a));
}

describe("the page and the server", () => {
  it("agree on the joints, their order and their limits", () => {
    expect(JOINTS.map((j) => j.name)).toEqual(Object.keys(server.JOINTS));
    for (const joint of JOINTS) {
      expect(joint.moves.map((m) => [m.min, m.max]), joint.name).toEqual(server.JOINTS[joint.name]);
    }
    expect(["pelvis", ...JOINTS.map((j) => j.name)]).toEqual(server.BONES);
    expect(Object.keys(SHAPES).sort()).toEqual([...server.BONES].sort());
  });

  it("agree on the format", () => {
    expect(page.FORMAT_VERSION).toBe(server.FORMAT_VERSION);
    expect(page.COLORS).toEqual(server.COLORS);
    expect(page.WIDTHS).toEqual(server.WIDTHS);
    expect(page.RING).toBe(server.RING);
    expect([page.MAX_POSES, page.MAX_ROPES, page.MAX_ROPE_POINTS, page.MAX_POINTS, page.OFFSET])
      .toEqual([server.MAX_PER_ITEM, server.MAX_ROPES, server.MAX_ROPE_POINTS, server.MAX_POINTS, server.OFFSET]);
    expect(page.CAMERA).toEqual(server.CAMERA);
    expect(page.RING_RANGE).toEqual(server.RING_RANGE);
    expect([page.BAMBOO, page.HASHIRA]).toEqual([server.BAMBOO, server.HASHIRA]);
    expect([page.BAMBOO_RANGE, page.BAMBOO_LENGTH]).toEqual([server.BAMBOO_RANGE, server.BAMBOO_LENGTH]);
    expect([page.HASHIRA_RANGE, page.HASHIRA_SIZE]).toEqual([server.HASHIRA_RANGE, server.HASHIRA_SIZE]);
  });

  it("agree that every preset, a new pose and every new hardpoint can be saved", () => {
    expect(server.parsePose(page.newPose())).toEqual(page.newPose());
    for (const body of BODY_PRESETS) {
      for (const arms of ARMS_PRESETS) {
        const data = preset(body.name, arms.name);
        expect(server.parsePose(data), `${body.name}, ${arms.name}`).toEqual(data);
      }
    }
    for (const kind of page.HARDPOINTS) {
      const data = page.setHardpoint(page.newPose(), kind);
      expect(server.parsePose(data), kind).toEqual(data);
    }
  });
});

describe("parsePose", () => {
  const ok = pose({ ring: [0, 280, 0], ropes: [{ c: "red", w: 2, p: [["chest", 0, 120, 110], ["ring", 0, 0, 0]] }] });

  it("accepts a pose, keeping only its format's fields", () => {
    expect(server.parsePose(ok)).toEqual(ok);
    const extra = { ...ok, x: 1, ropes: [{ ...ok.ropes[0], y: 2 }] };
    expect(server.parsePose(extra)).toEqual(ok);
  });

  it("reads an older pose: a camera of four numbers, and no bamboo or hashira", () => {
    const { bamboo, hashira, ...older } = { ...ok, camera: [20, 10, 300, 110] };
    expect([bamboo, hashira]).toEqual([null, null]);
    expect(server.parsePose(older)).toEqual({ ...ok, camera: [20, 10, 300, 110, 0, 0] });
  });

  it("takes rope points on a bamboo or a hashira", () => {
    const onBamboo = pose({ bamboo: [0, 195, 0, 30], ropes: [{ c: "red", w: 2, p: [["chest", 0, 0, 0], ["bamboo", -750, 0, 0]] }] });
    expect(server.parsePose(onBamboo)).toEqual(onBamboo);
    const onPost = pose({ hashira: [0, -27, 0], ropes: [{ c: "red", w: 2, p: [["chest", 0, 0, 0], ["hashira", 0, 1200, 50]] }] });
    expect(server.parsePose(onPost)).toEqual(onPost);
  });

  it("puts joints left out at rest", () => {
    const parsed = server.parsePose({ ...ok, joints: { l_knee: [40] } });
    expect(parsed.joints.l_knee).toEqual([40]);
    expect(parsed.joints.r_shoulder).toEqual([0, 0, 0]);
  });

  it("refuses anything else, saying why", () => {
    const bad = (/** @type {unknown} */ value, /** @type {RegExp} */ why) => expect(() => server.parsePose(value)).toThrow(why);
    bad(null, /missing/);
    bad({ ...ok, v: 2 }, /newer version/);
    bad({ ...ok, joints: null }, /no joints/);
    bad({ ...ok, joints: { tail: [1] } }, /doesn't know/);
    bad({ ...ok, joints: { l_knee: [-5] } }, /further than a body can/);
    bad({ ...ok, joints: { l_knee: [10, 10] } }, /further than a body can/);
    bad({ ...ok, joints: { l_knee: [1.5] } }, /further than a body can/);
    bad({ ...ok, body: [181, 0, 0] }, /turn/);
    bad({ ...ok, lift: 251 }, /off the floor/);
    bad({ ...ok, camera: [0, 90, 300, 100] }, /view/);
    bad({ ...ok, ring: [0, 500, 0] }, /ring is out of reach/);
    bad({ ...ok, ring: null }, /ring that isn't there/);
    bad({ ...ok, camera: [0, 0, 300, 100, 301, 0] }, /view/);
    bad({ ...ok, bamboo: [0, 195, 0, 0] }, /only have one/);
    bad({ ...ok, ring: null, hashira: [0, 0, 0], bamboo: [0, 195, 0, 0] }, /only have one/);
    bad({ ...ok, ring: null, bamboo: [0, 195, 0, 91] }, /bamboo is out of reach/);
    bad({ ...ok, ring: null, hashira: [0, 0, 46] }, /hashira is out of reach/);
    const bambooRope = (/** @type {any[]} */ point) => [{ c: "red", w: 1, p: [point, ["chest", 0, 0, 0]] }];
    bad({ ...ok, ring: null, ropes: bambooRope(["bamboo", 0, 0, 0]) }, /bamboo that isn't there/);
    bad({ ...ok, ring: null, bamboo: [0, 195, 0, 0], ropes: bambooRope(["bamboo", 751, 0, 0]) }, /off the bamboo/);
    bad({ ...ok, ring: null, bamboo: [0, 195, 0, 0], ropes: bambooRope(["bamboo", 0, 5, 0]) }, /off the bamboo/);
    bad({ ...ok, ring: null, ropes: bambooRope(["hashira", 0, 0, 0]) }, /hashira that isn't there/);
    bad({ ...ok, ring: null, hashira: [0, 0, 0], ropes: bambooRope(["hashira", 0, 4501, 0]) }, /off the hashira/);
    bad({ ...ok, ropes: "x" }, /rope list/);
    bad({ ...ok, ropes: [{ c: "gold", w: 1, p: ok.ropes[0].p }] }, /rope isn't/);
    bad({ ...ok, ropes: [{ c: "red", w: 1, p: [["chest", 0, 0, 0]] }] }, /too few/);
    bad({ ...ok, ropes: [{ c: "red", w: 1, p: [["chest", 0, 0], ["chest", 0, 0, 0]] }] }, /point isn't/);
    bad({ ...ok, ropes: [{ c: "red", w: 1, p: [["ring", 1, 0, 0], ["chest", 0, 0, 0]] }] }, /point isn't/);
    bad({ ...ok, ropes: [{ c: "red", w: 1, p: [["wing", 0, 0, 0], ["chest", 0, 0, 0]] }] }, /off the figure/);
    bad({ ...ok, ropes: [{ c: "red", w: 1, p: [["chest", 601, 0, 0], ["chest", 0, 0, 0]] }] }, /off the figure/);
    bad({ ...ok, ropes: Array(server.MAX_ROPES + 1).fill(ok.ropes[0]) }, /ropes/);
    const long = { c: "red", w: 1, p: Array(server.MAX_ROPE_POINTS).fill(["chest", 0, 0, 0]) };
    bad({ ...ok, ropes: Array(16).fill(long) }, /too detailed/);
  });

  it("checks edits and ids", () => {
    expect(server.parseEdit({ data: ok })).toEqual({ data: ok });
    expect(server.parseEdit({ caption: null })).toEqual({ caption: null });
    expect(() => server.parseEdit({})).toThrow(/Nothing to change/);
    expect(() => server.parseEdit({ caption: "plain" })).toThrow(/encrypted/);
    expect(() => server.parsePoseId("x")).toThrow(/pose id/);
  });
});

describe("the figure's joints", () => {
  it("keep their angles within limits, as whole degrees", () => {
    expect(clampJoint("l_elbow", [200])).toEqual([150]);
    expect(clampJoint("l_elbow", [-3])).toEqual([0]);
    expect(clampJoint("spine", [10.4, -99])).toEqual([10, -35, 0]);
    expect(() => clampJoint("tail", [1])).toThrow();
  });

  it("turn their bone the way each movement is named", () => {
    const r = jointRotation("l_shoulder", [90, 0, 0]);
    expect(r.order).toBe("ZXY");
    expect(r.x).toBeCloseTo(-Math.PI / 2);
    expect(jointRotation("r_shoulder", [0, 90, 0]).z).toBeCloseTo(-Math.PI / 2);
    expect(jointRotation("l_shoulder", [0, 90, 0]).z).toBeCloseTo(Math.PI / 2);
  });
});

describe("the figure, posed", () => {
  /**
   * The figure in presets (or a pose), and where its parts are.
   * @param {string | Pose} which a body preset's name, then ", " and an
   *   arms preset's if not at its sides; or a pose
   */
  function figure(which) {
    const skeleton = makeSkeleton();
    const data = typeof which === "string" ? preset(...(/** @type {[string, string]} */ (which.split(", ")))) : which;
    posed(skeleton, data);
    /** @param {string} bone @param {[number, number, number]} [cm] */
    const at = (bone, cm) => onBone(skeleton, bone, cm);
    return {
      at,
      head: at("head", [0, 17, 1]),
      face: at("head", [0, 16, 11]),
      pelvis: at("pelvis"),
      /** The bottom of each foot (its sole, under the ankle). */
      soles: [at("l_ankle", [0, -7.5, 5.5]), at("r_ankle", [0, -7.5, 5.5])],
      wrists: [at("l_wrist"), at("r_wrist")],
      elbows: [at("l_elbow"), at("r_elbow")],
      knees: [at("l_knee"), at("r_knee")],
      skeleton, data,
    };
  }

  it("stands on the floor, about as tall as an adult, facing the front", () => {
    const f = figure(page.newPose());
    for (const sole of f.soles) expect(Math.abs(sole.y)).toBeLessThan(1.5);
    expect(f.at("head", [0, 28.5, 1]).y).toBeGreaterThan(170);
    expect(f.at("head", [0, 28.5, 1]).y).toBeLessThan(182);
    expect(f.face.z).toBeGreaterThan(f.head.z);
    // Its left is on the viewer's right (+x), facing the front (+z).
    expect(f.at("l_wrist").x).toBeGreaterThan(0);
    expect(f.at("r_wrist").x).toBeLessThan(0);
    expect(f.pelvis.y).toBe(STANDING_LIFT);
  });

  it("raises an arm forward, and bends an elbow and a knee the way a body does", () => {
    const forward = figure(page.setJoint(page.newPose(), "l_shoulder", 0, 90));
    const shoulder = forward.at("l_shoulder");
    expect(forward.at("l_elbow").z - shoulder.z).toBeCloseTo(29, 0);
    const out = figure(page.setJoint(page.newPose(), "r_shoulder", 1, 90));
    expect(out.at("r_elbow").x - out.at("r_shoulder").x).toBeCloseTo(-29, 0);
    // A forearm comes forward; a lower leg goes back.
    const elbow = figure(page.setJoint(page.newPose(), "l_elbow", 0, 90));
    expect(elbow.at("l_wrist").z).toBeGreaterThan(20);
    const knee = figure(page.setJoint(page.newPose(), "r_knee", 0, 90));
    expect(knee.at("r_ankle").z).toBeLessThan(-30);
    // Toes up.
    const toes = figure(page.setJoint(page.newPose(), "l_ankle", 0, 30));
    expect(toes.at("l_ankle", [0, 0, 15]).y).toBeGreaterThan(toes.at("l_ankle").y + 5);
  });

  it("in a box tie, has the elbows and wrists behind the back, the forearms crossing", () => {
    const f = figure("Standing, Behind back");
    const backOfChest = f.at("chest", [0, 12, -10.5]).z;
    for (const p of [...f.elbows, ...f.wrists]) expect(p.z).toBeLessThan(backOfChest - 3);
    // Each forearm reaches past the middle of the back.
    expect(f.wrists[0].x).toBeLessThan(2);
    expect(f.wrists[1].x).toBeGreaterThan(-2);
    // One above the other, so they don't pass through each other.
    expect(Math.abs(f.wrists[0].y - f.wrists[1].y)).toBeGreaterThan(5);
  });

  it("with its arms crossed in front, has the forearms across the chest, one above the other", () => {
    const f = figure("Standing, Crossed in front");
    const frontOfChest = f.at("chest", [0, 12, 10]).z;
    for (const p of [...f.elbows, ...f.wrists]) expect(p.z).toBeGreaterThan(frontOfChest + 4);
    expect(f.wrists[0].x).toBeLessThan(0);
    expect(f.wrists[1].x).toBeGreaterThan(0);
    expect(Math.abs(f.wrists[0].y - f.wrists[1].y)).toBeGreaterThan(5);
  });

  it("with its arms behind its head, has the hands behind the head and the elbows out", () => {
    const f = figure("Standing, Arms behind head");
    const hands = [f.at("l_wrist", [0, -6, 0]), f.at("r_wrist", [0, -6, 0])];
    for (const hand of hands) expect(hand.z).toBeLessThan(f.head.z - 12);
    for (const hand of hands) expect(Math.abs(hand.y - f.head.y)).toBeLessThan(8);
    expect(f.elbows[0].x).toBeGreaterThan(20);
    expect(f.elbows[1].x).toBeLessThan(-20);
  });

  it("kneels with its shins on the floor", () => {
    for (const name of ["Kneeling", "Kneeling up"]) {
      const f = figure(name);
      for (const knee of f.knees) expect(knee.y, name).toBeGreaterThan(3);
      for (const knee of f.knees) expect(knee.y, name).toBeLessThan(9);
      for (const ankle of [f.at("l_ankle"), f.at("r_ankle")]) expect(ankle.y, name).toBeLessThan(9);
    }
  });

  it("lies face down and face up, on its side, and upside down facing the front", () => {
    const down = figure("Face down");
    expect(down.face.y).toBeLessThan(down.head.y);
    expect(down.head.z).toBeGreaterThan(down.pelvis.z + 40);
    const up = figure("Face up");
    expect(up.face.y).toBeGreaterThan(up.head.y);
    const side = figure("On its side");
    expect(Math.abs(side.head.y - side.pelvis.y)).toBeLessThan(25);
    // Lying on its right side: the left shoulder above the right.
    expect(side.at("l_shoulder").y).toBeGreaterThan(side.at("r_shoulder").y);
    const upside = figure("Upside down");
    expect(upside.head.y).toBeLessThan(upside.pelvis.y - 40);
    expect(upside.face.z).toBeGreaterThan(upside.head.z);
    expect(upside.head.y).toBeGreaterThan(5);
    for (const sole of upside.soles) expect(sole.y).toBeGreaterThan(upside.pelvis.y);
  });

  it("has orientations that are what they say", () => {
    for (const { name, body } of ORIENTATIONS) {
      const f = figure(pose({ body, lift: 150 }));
      const up = f.head.y - f.pelvis.y;
      if (name === "Upright") expect(up, name).toBeGreaterThan(40);
      if (name === "Upside down") expect(up, name).toBeLessThan(-40);
      if (name === "Face down") expect(f.face.y, name).toBeLessThan(f.head.y);
      if (name === "Face up") expect(f.face.y, name).toBeGreaterThan(f.head.y);
      if (name === "On its side") expect(Math.abs(up), name).toBeLessThan(10);
    }
  });

  it("puts a bamboo's rope points under it, along it as it's turned, and a hashira's on the post", () => {
    const skeleton = makeSkeleton();
    const across = pose({ bamboo: [10, 195, 0, 0] });
    expect(ropePoint(skeleton, ["bamboo", 500, 0, 0], across)).toMatchObject({ x: 60, y: 195 - BAMBOO_RADIUS, z: 0 });
    const turned = pose({ bamboo: [0, 195, 0, 90] });
    const end = ropePoint(skeleton, ["bamboo", 500, 0, 0], turned);
    expect([end.x, end.z]).toEqual([expect.closeTo(0), expect.closeTo(-50)]);
    const post = pose({ hashira: [0, -27, 90] });
    const point = ropePoint(skeleton, ["hashira", 50, 1000, 0], post);
    expect([point.x, point.y, point.z]).toEqual([expect.closeTo(0), 100, expect.closeTo(-32)]);
    expect(toHardpoint(post, "hashira", point).map((n) => Math.round(n))).toEqual([5, 100, 0]);
    expect(toHardpoint(turned, "bamboo", end)).toEqual([expect.closeTo(50), -BAMBOO_RADIUS, expect.closeTo(0)]);
  });

  it("keeps a rope point on its part when the figure moves, and the ring's under the ring", () => {
    const standing = figure(page.newPose());
    const onForearm = standing.at("l_elbow", [0, -12, 4]);
    const mm = toBone(standing.skeleton, "l_elbow", onForearm);
    expect(mm).toEqual([0, -120, 40]);
    const bent = pose({ ring: [10, 280, 0] });
    const moved = figure(page.setJoint(bent, "l_elbow", 0, 90));
    const point = ropePoint(moved.skeleton, ["l_elbow", ...mm], moved.data);
    expect(point.distanceTo(moved.at("l_elbow"))).toBeCloseTo(Math.hypot(12, 4), 1);
    expect(point.z).toBeGreaterThan(5);
    expect(ropePoint(moved.skeleton, ["ring", 0, 0, 0], moved.data)).toMatchObject({ x: 10, y: 275, z: 0 });
  });
});

describe("changing a pose", () => {
  it("sets joints, the body, the lift and the view within their limits", () => {
    let p = page.setJoint(page.newPose(), "r_knee", 0, 999);
    expect(p.joints.r_knee).toEqual([155]);
    p = page.setBody(p, 2, 200);
    expect(p.body).toEqual([0, 0, 180]);
    expect(page.setLift(p, -4).lift).toBe(0);
    expect(page.setCamera(p, [190, 100, 10, 400]).camera).toEqual([-170, 89, 60, 350, 0, 0]);
    expect(page.setCamera(p, [-190, 0, 300, 100, -400, 7]).camera).toEqual([170, 0, 300, 100, -300, 7]);
  });

  it("pans the view sideways as the screen sees it, and up", () => {
    const front = page.setCamera(page.newPose(), [0, 0, 300, 100, 0, 0]);
    expect(page.panCamera(front, 20, 5).camera).toEqual([0, 0, 300, 105, 20, 0]);
    const side = page.setCamera(page.newPose(), [90, 0, 300, 100, 0, 0]);
    expect(page.panCamera(side, 20, 0).camera.slice(4)).toEqual([0, -20]);
  });

  it("lays a rope point by point, only adding it once it has two, and ignores a double tap", () => {
    /** @type {import("../../public/js/pose-format.js").Rope} */
    let rope = { c: "red", w: 2, p: [] };
    rope = page.addPoint(rope, page.bonePoint("chest", [0, 100, 110]));
    expect(page.finishRope(page.newPose(), rope).ropes).toEqual([]);
    rope = page.addPoint(rope, page.bonePoint("chest", [1, 101, 110]));
    expect(rope.p).toHaveLength(1);
    rope = page.addPoint(rope, page.bonePoint("chest", [0, -900, 110]));
    expect(rope.p[1]).toEqual(["chest", 0, -600, 110]);
    const p = page.finishRope(page.newPose(), rope);
    expect(p.ropes).toEqual([rope]);
    expect(page.removeRope(p, 0).ropes).toEqual([]);
  });

  describe("hardpoints", () => {
    const ropes = [
      { c: /** @type {const} */ ("red"), w: /** @type {const} */ (2), p: /** @type {any} */ ([["chest", 0, 0, 0], ["ring", 0, 0, 0]]) },
      { c: /** @type {const} */ ("blue"), w: /** @type {const} */ (2), p: /** @type {any} */ ([["chest", 0, 0, 0], ["ring", 0, 0, 0], ["pelvis", 0, 0, 0]]) },
    ];
    const ringed = pose({ ring: [0, 195, 0], ropes });

    it("adds one at a time, in view, in place of any other", () => {
      const p = page.setHardpoint(page.newPose(), "ring");
      expect([p.ring, p.bamboo, p.hashira]).toEqual([[0, 195, 0], null, null]);
      const b = page.setHardpoint(p, "bamboo");
      expect([b.ring, b.bamboo, b.hashira]).toEqual([null, [0, 195, 0, 0], null]);
      expect(page.hardpointOf(page.setHardpoint(b, "hashira"))).toBe("hashira");
      expect(page.setHardpoint(b, "bamboo")).toBe(b);
    });

    it("moves uplines across between a ring and a bamboo", () => {
      expect(page.hardpointPointsLost(ringed, "bamboo")).toBe(0);
      const b = page.setHardpoint(ringed, "bamboo");
      expect(b.ropes.map((r) => r.p[1])).toEqual([["bamboo", 0, 0, 0], ["bamboo", 0, 0, 0]]);
      expect(page.setHardpoint(b, "ring").ropes).toEqual(ropes);
    });

    it("takes the old one's rope points, and ropes left too short, otherwise", () => {
      expect(page.hardpointPointsLost(ringed, "hashira")).toBe(2);
      expect(page.hardpointPointsLost(ringed, null)).toBe(2);
      for (const next of /** @type {const} */ (["hashira", null])) {
        const p = page.setHardpoint(ringed, next);
        expect(p.ring).toBeNull();
        expect(p.ropes).toEqual([{ c: "blue", w: 2, p: [["chest", 0, 0, 0], ["pelvis", 0, 0, 0]] }]);
      }
    });

    it("moves the one there within its limits", () => {
      expect(page.moveHardpoint(ringed, [500, 9, -1]).ring).toEqual([300, 9, -1]);
      expect(page.moveHardpoint(page.setHardpoint(ringed, "bamboo"), [0, 195, 0, 100]).bamboo).toEqual([0, 195, 0, 90]);
      expect(page.moveHardpoint(page.newPose(), [1, 2, 3])).toEqual(page.newPose());
    });

    it("keeps rope points on the bamboo and hashira", () => {
      expect(page.bambooPoint(9000)).toEqual(["bamboo", 750, 0, 0]);
      expect(page.hashiraPoint([10, -5, 700])).toEqual(["hashira", 10, 0, 600]);
    });
  });

  it("says when there's no room for another rope or point", () => {
    const full = pose({ ropes: Array(page.MAX_ROPES).fill({ c: "red", w: 1, p: [["chest", 0, 0, 0], ["chest", 9, 9, 9]] }) });
    expect(page.cantAdd(full, null)).toMatch(/at most/);
    expect(page.cantAdd(page.newPose(), null)).toBeNull();
    expect(page.cantAdd(page.newPose(), { c: "red", w: 1, p: Array(page.MAX_ROPE_POINTS).fill(["chest", 0, 0, 0]) })).toMatch(/new one/);
  });

  it("keeps a preset's figure but the pose's ropes, ring and view", () => {
    const p = pose({ ring: [0, 280, 0], camera: [90, 0, 200, 100, 0, 0], ropes: [{ c: "red", w: 1, p: [["chest", 0, 0, 0], ["ring", 0, 0, 0]] }] });
    const up = /** @type {import("../../public/js/figure-rig.js").BodyPreset} */ (BODY_PRESETS.find((x) => x.name === "Kneeling up"));
    const kneeling = page.withPosture(p, withBodyPreset(p, up));
    expect([kneeling.ring, kneeling.camera, kneeling.ropes]).toEqual([p.ring, p.camera, p.ropes]);
    expect(kneeling.joints.l_knee).toEqual([90]);
  });

  it("keeps the arms when the body changes, and the body when the arms do", () => {
    const behind = /** @type {any} */ (ARMS_PRESETS.find((x) => x.name === "Behind back"));
    const kneeling = /** @type {any} */ (BODY_PRESETS.find((x) => x.name === "Kneeling"));
    const up = /** @type {any} */ (BODY_PRESETS.find((x) => x.name === "Kneeling up"));
    // Kneeling, arms at the sides; then behind the back; then kneeling up.
    let p = page.withPosture(page.newPose(), withBodyPreset(page.newPose(), kneeling));
    expect(ARM_JOINTS.every((j) => p.joints[j].every((a) => a === 0))).toBe(true);
    p = page.withPosture(p, withArmsPreset(p, behind));
    expect([p.lift, p.joints.l_knee, p.joints.l_elbow]).toEqual([29, [155], [100]]);
    // An arm moved by hand stays as it is, too.
    p = page.setJoint(p, "r_wrist", 0, 30);
    p = page.withPosture(p, withBodyPreset(p, up));
    expect([p.lift, p.joints.l_knee, p.joints.l_elbow, p.joints.r_wrist]).toEqual([55, [90], [100], [30, 0]]);
    expect(p.joints.l_hip).toEqual([0, 0, 0]);
  });

  it("opens a saved pose whole, even one missing joints or with angles out of reach", () => {
    const opened = page.readPose(/** @type {any} */ ({ joints: { l_knee: [400] }, ring: [0, 280, 0], camera: [1, 2, 300, 4] }));
    expect(opened.joints.l_knee).toEqual([155]);
    expect([opened.camera, opened.bamboo, opened.hashira]).toEqual([[1, 2, 300, 4, 0, 0], null, null]);
    expect(opened.joints.head).toEqual([0, 0, 0]);
    expect(opened.ring).toEqual([0, 280, 0]);
    expect(opened.ropes).toEqual([]);
  });
});

describe("undo and redo", () => {
  it("go back and forward over changes, but not the view", () => {
    let h = page.startHistory(page.newPose());
    h = page.change(h, page.setJoint(h.pose, "l_elbow", 0, 90));
    expect(page.change(h, h.pose)).toBe(h);
    h = page.look(h, page.setCamera(h.pose, [90, 0, 200, 100]));
    h = page.undo(h);
    expect(h.pose.joints.l_elbow).toEqual([0]);
    expect(h.pose.camera).toEqual([90, 0, 200, 100, 0, 0]);
    h = page.redo(h);
    expect(h.pose.joints.l_elbow).toEqual([90]);
    expect(page.undo(page.startHistory(page.newPose())).past).toEqual([]);
    expect(page.redo(h)).toBe(h);
  });

  it(`keep the last ${page.MAX_UNDO} changes`, () => {
    let h = page.startHistory(page.newPose());
    for (let i = 0; i < page.MAX_UNDO + 5; i++) h = page.change(h, page.setLift(h.pose, i % 2 ? 50 : 60 + i % 100));
    expect(h.past).toHaveLength(page.MAX_UNDO);
  });
});

describe("takePoses", () => {
  it("takes the poses off ties, plans and workshops, keeping where each goes", () => {
    const data = page.newPose();
    const doc = {
      ties: [{ title: "A", poses: [{ data, caption: "Step 2", position: 1 }, { data, caption: " ", position: 0 }] }, { title: "B" }],
      plans: [{ id: "p1", title: "TK", poses: [{ data }] }, { id: "p2", poses: [{ data: "junk" }] }],
      workshops: [{ title: "W", poses: [{ data, caption: null }] }],
    };
    const taken = takePoses(doc);
    expect(taken.doc.ties).toEqual([{ title: "A" }, { title: "B" }]);
    expect(taken.doc.plans[0]).toEqual({ id: "p1", title: "TK" });
    expect(taken.doc.workshops).toEqual([{ title: "W" }]);
    expect(taken.ties.get(0)?.map((p) => [p.caption, p.position])).toEqual([[null, 0], ["Step 2", 1]]);
    expect(taken.plans.get("p1")).toHaveLength(1);
    expect(taken.plans.has("p2")).toBe(false);
    expect(taken.workshops.get(0)).toHaveLength(1);
    expect(taken.count).toBe(4);
  });
});
