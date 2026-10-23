// Poses: the server's checks (src/poses/parse.js), the page's pure parts
// (figure-rig.js, pose-format.js, import-poses.js), and the figure itself:
// posed with three.js's math (pose-skeleton.js), its presets put the body
// where their names say.
import { describe, it, expect } from "vitest";
import * as server from "../../src/poses/parse.js";
import * as page from "../../public/js/pose-format.js";
import { JOINTS, PRESETS, ORIENTATIONS, SHAPES, STANDING_LIFT, presetPosture, clampJoint, jointRotation } from "../../public/js/figure-rig.js";
import { makeSkeleton, posed, onBone, ropePoint, toBone } from "../../public/js/pose-skeleton.js";
import { takePoses } from "../../public/js/import-poses.js";

/** @typedef {import("../../public/js/pose-format.js").Pose} Pose */

/** @param {Partial<Pose>} [changes] @returns {Pose} */
const pose = (changes = {}) => ({ ...page.newPose(), ...changes });

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
  });

  it("agree that every preset and a new pose can be saved", () => {
    expect(server.parsePose(page.newPose())).toEqual(page.newPose());
    for (const preset of PRESETS) {
      const data = page.withPosture(page.newPose(), presetPosture(preset));
      expect(server.parsePose(data), preset.name).toEqual(data);
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

  it("checks edits, orders and ids", () => {
    const id = "3f1c2a9e-1d2b-4c3d-8e4f-5a6b7c8d9e0f";
    expect(server.parseEdit({ data: ok })).toEqual({ data: ok });
    expect(server.parseEdit({ caption: null })).toEqual({ caption: null });
    expect(() => server.parseEdit({})).toThrow(/Nothing to change/);
    expect(() => server.parseEdit({ caption: "plain" })).toThrow(/encrypted/);
    expect(server.parseOrder([id])).toEqual([id]);
    expect(() => server.parseOrder([id, id])).toThrow(/once/);
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
   * The figure in a preset (or a pose), and where its parts are.
   * @param {string | Pose} which a preset's name, or a pose
   */
  function figure(which) {
    const skeleton = makeSkeleton();
    const found = typeof which === "string" ? PRESETS.find((p) => p.name === which) : null;
    if (typeof which === "string" && !found) throw new Error(`No preset ${which}`);
    const data = found ? page.withPosture(page.newPose(), presetPosture(found)) : /** @type {Pose} */ (which);
    posed(skeleton, data);
    /** @param {string} bone @param {[number, number, number]} [cm] */
    const at = (bone, cm) => onBone(skeleton, bone, cm);
    return {
      at,
      head: at("head", [0, 17, 1]),
      nose: at("head", [0, 16, 11]),
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
    expect(f.nose.z).toBeGreaterThan(f.head.z);
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
    const f = figure("Standing, box tie");
    const backOfChest = f.at("chest", [0, 12, -10.5]).z;
    for (const p of [...f.elbows, ...f.wrists]) expect(p.z).toBeLessThan(backOfChest - 3);
    // Each forearm reaches past the middle of the back.
    expect(f.wrists[0].x).toBeLessThan(2);
    expect(f.wrists[1].x).toBeGreaterThan(-2);
    // One above the other, so they don't pass through each other.
    expect(Math.abs(f.wrists[0].y - f.wrists[1].y)).toBeGreaterThan(5);
  });

  it("kneels with its shins on the floor", () => {
    for (const name of ["Kneeling, sitting back", "Kneeling up"]) {
      const f = figure(name);
      for (const knee of f.knees) expect(knee.y, name).toBeGreaterThan(3);
      for (const knee of f.knees) expect(knee.y, name).toBeLessThan(9);
      for (const ankle of [f.at("l_ankle"), f.at("r_ankle")]) expect(ankle.y, name).toBeLessThan(9);
    }
  });

  it("lies face down and face up, on its side, and upside down facing the front", () => {
    const down = figure("Face down");
    expect(down.nose.y).toBeLessThan(down.head.y);
    expect(down.head.z).toBeGreaterThan(down.pelvis.z + 40);
    const up = figure("Face up");
    expect(up.nose.y).toBeGreaterThan(up.head.y);
    const side = figure("On its side");
    expect(Math.abs(side.head.y - side.pelvis.y)).toBeLessThan(25);
    // Lying on its right side: the left shoulder above the right.
    expect(side.at("l_shoulder").y).toBeGreaterThan(side.at("r_shoulder").y);
    const upside = figure("Upside down");
    expect(upside.head.y).toBeLessThan(upside.pelvis.y - 40);
    expect(upside.nose.z).toBeGreaterThan(upside.head.z);
    expect(upside.head.y).toBeGreaterThan(5);
    for (const sole of upside.soles) expect(sole.y).toBeGreaterThan(upside.pelvis.y);
  });

  it("has orientations that are what they say", () => {
    for (const { name, body } of ORIENTATIONS) {
      const f = figure(pose({ body, lift: 150 }));
      const up = f.head.y - f.pelvis.y;
      if (name === "Upright") expect(up, name).toBeGreaterThan(40);
      if (name === "Upside down") expect(up, name).toBeLessThan(-40);
      if (name === "Face down") expect(f.nose.y, name).toBeLessThan(f.head.y);
      if (name === "Face up") expect(f.nose.y, name).toBeGreaterThan(f.head.y);
      if (name === "On its side") expect(Math.abs(up), name).toBeLessThan(10);
    }
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
    expect(page.setCamera(p, [190, 100, 10, 400]).camera).toEqual([-170, 89, 60, 350]);
    expect(page.setCamera(p, [-190, 0, 300, 100]).camera[0]).toBe(170);
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

  it("takes the ring's rope points with it, and ropes left too short", () => {
    const p = pose({
      ring: [0, 280, 0],
      ropes: [
        { c: "red", w: 2, p: [["chest", 0, 0, 0], ["ring", 0, 0, 0]] },
        { c: "blue", w: 2, p: [["chest", 0, 0, 0], ["ring", 0, 0, 0], ["pelvis", 0, 0, 0]] },
      ],
    });
    const without = page.setRing(p, null);
    expect(without.ring).toBeNull();
    expect(without.ropes).toEqual([{ c: "blue", w: 2, p: [["chest", 0, 0, 0], ["pelvis", 0, 0, 0]] }]);
    expect(page.setRing(p, [500, 9, -1]).ring).toEqual([300, 9, -1]);
  });

  it("says when there's no room for another rope or point", () => {
    const full = pose({ ropes: Array(page.MAX_ROPES).fill({ c: "red", w: 1, p: [["chest", 0, 0, 0], ["chest", 9, 9, 9]] }) });
    expect(page.cantAdd(full, null)).toMatch(/at most/);
    expect(page.cantAdd(page.newPose(), null)).toBeNull();
    expect(page.cantAdd(page.newPose(), { c: "red", w: 1, p: Array(page.MAX_ROPE_POINTS).fill(["chest", 0, 0, 0]) })).toMatch(/new one/);
  });

  it("keeps a preset's figure but the pose's ropes, ring and view", () => {
    const p = pose({ ring: [0, 280, 0], camera: [90, 0, 200, 100], ropes: [{ c: "red", w: 1, p: [["chest", 0, 0, 0], ["ring", 0, 0, 0]] }] });
    const kneeling = page.withPosture(p, presetPosture(/** @type {any} */ (PRESETS.find((x) => x.name === "Kneeling up"))));
    expect([kneeling.ring, kneeling.camera, kneeling.ropes]).toEqual([p.ring, p.camera, p.ropes]);
    expect(kneeling.joints.l_knee).toEqual([90]);
  });

  it("opens a saved pose whole, even one missing joints or with angles out of reach", () => {
    const opened = page.readPose(/** @type {any} */ ({ joints: { l_knee: [400] }, ring: [0, 280, 0] }));
    expect(opened.joints.l_knee).toEqual([155]);
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
    expect(h.pose.camera).toEqual([90, 0, 200, 100]);
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
