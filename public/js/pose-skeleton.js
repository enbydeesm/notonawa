// The figure's bones as three.js objects, posed: where every joint, and
// every rope point, is in the room for a pose. No drawing here (that's
// pose-scene.js), so the unit tests can check poses with three.js's math
// alone: that a preset's hands really are behind its back, say.
//
// The bones are the body's own (figure-body.js: Anny's skeleton, its
// joints where the pose's body shape puts them), each lined up with the
// world at rest. A pose's joints turn them (figure-rig.js, DRIVES); a part
// of the body ("chest", "l_elbow"…) is the bone its rope points are kept on.

import { Bone, Object3D, Quaternion, Vector3 } from "./vendor/three.js";
import { JOINTS, DRIVES, TAPPED_AS, POSED_AS, anchorBone, carrierBone, jointRotation, bodyRotation } from "./figure-rig.js";
import { BONES, PARENTS, DEFAULT_SHAPE, bodyHeads, sameShape } from "./figure-body.js";
import { RING, BAMBOO, HASHIRA, ROPE, setShape, clamp } from "./pose-format.js";
import { LIFT_RANGE } from "./figure-rig.js";

/** @typedef {import("./pose-format.js").Pose} Pose */
/** @typedef {import("./pose-format.js").RopePoint} RopePoint */

/** The ring's size, and where ropes meet it (the bottom of the ring), cm. */
export const RING_RADIUS = 5;
/** The bamboo's thickness: ropes meet its underside, cm. */
export const BAMBOO_RADIUS = 2.5;

/**
 * A point in a hardpoint's own directions (cm), turned `turn` degrees
 * about the upright and moved to `at`, as a point in the room.
 * @param {[number, number, number]} at
 * @param {number} turn
 * @param {[number, number, number]} local
 */
function turned([ax, ay, az], turn, [x, y, z]) {
  const t = turn * Math.PI / 180;
  return new Vector3(ax + x * Math.cos(t) + z * Math.sin(t), ay + y, az - x * Math.sin(t) + z * Math.cos(t));
}

/**
 * A point in the room (cm) in a hardpoint's own directions: the bamboo's
 * from its middle, along it in x; the hashira's from its foot.
 * @param {Pose} pose
 * @param {"bamboo" | "hashira"} kind
 * @param {Vector3} world
 * @returns {[number, number, number]} cm
 */
export function toHardpoint(pose, kind, world) {
  const [ax, ay, az, turn] = kind === BAMBOO ? /** @type {number[]} */ (pose.bamboo)
    : [/** @type {number[]} */ (pose.hashira)[0], 0, /** @type {number[]} */ (pose.hashira)[1], /** @type {number[]} */ (pose.hashira)[2]];
  const t = turn * Math.PI / 180;
  const dx = world.x - ax, dz = world.z - az;
  return [dx * Math.cos(t) - dz * Math.sin(t), world.y - ay, dx * Math.sin(t) + dz * Math.cos(t)];
}

/**
 * A new skeleton at rest: the pelvis (the body's root), every body bone by
 * name (`all`), and every part by name (`bones`: the bone its rope points
 * are kept on).
 * @param {Object3D} [pelvis] the root to build on (a Group, in the scene)
 * @param {import("./figure-body.js").Shape} [shape] the body's shape
 */
export function makeSkeleton(pelvis = new Object3D(), shape = DEFAULT_SHAPE) {
  /** @type {Map<string, Object3D>} */
  const all = new Map();
  BONES.forEach((name, i) => {
    if (PARENTS[i] < 0) {
      all.set(name, pelvis);
      return;
    }
    const bone = new Bone();
    bone.name = name;
    /** @type {Object3D} */ (all.get(BONES[PARENTS[i]])).add(bone);
    all.set(name, bone);
  });
  // Each part's rope points are on its anchor: at its joint, carried by the
  // last bone it turns (which has the whole turn, twist included). Most
  // parts' anchor is that bone itself.
  /** @type {Map<string, Object3D>} */
  const bones = new Map(["pelvis", ...JOINTS.map((j) => j.name)].map((part) => {
    const carrier = /** @type {Object3D} */ (all.get(carrierBone(part)));
    if (carrierBone(part) === anchorBone(part)) return [part, carrier];
    const anchor = new Object3D();
    carrier.add(anchor);
    return [part, anchor];
  }));
  const skeleton = { pelvis, bones, all, shape: /** @type {import("./figure-body.js").Shape} */ ([...shape]), heads: /** @type {Float64Array} */ (new Float64Array(0)) };
  reshape(skeleton, shape);
  return skeleton;
}

/** @typedef {ReturnType<typeof makeSkeleton>} Skeleton */

/**
 * Moves the joints to where a body shape has them (the bones' turns stay).
 * @param {Skeleton} skeleton
 * @param {import("./figure-body.js").Shape} shape
 */
export function reshape(skeleton, shape) {
  const heads = bodyHeads(shape);
  BONES.forEach((name, i) => {
    const parent = PARENTS[i];
    if (parent < 0) return;
    /** @type {Object3D} */ (skeleton.all.get(name)).position.set(
      heads[i * 3] - heads[parent * 3], heads[i * 3 + 1] - heads[parent * 3 + 1], heads[i * 3 + 2] - heads[parent * 3 + 2],
    );
  });
  // An anchor apart from its carrier sits at the part's joint.
  for (const [part, anchor] of skeleton.bones) {
    if (anchor === skeleton.all.get(carrierBone(part))) continue;
    const a = BONES.indexOf(anchorBone(part)) * 3, c = BONES.indexOf(carrierBone(part)) * 3;
    anchor.position.set(heads[a] - heads[c], heads[a + 1] - heads[c + 1], heads[a + 2] - heads[c + 2]);
  }
  skeleton.shape = [...shape];
  skeleton.heads = heads;
}

/** The parts of the body: the pelvis, then each joint's. */
const PART_NAMES = Object.freeze(["pelvis", ...JOINTS.map((j) => j.name)]);

/**
 * Which part each body bone is tapped as: the part whose joint turns it
 * (or TAPPED_AS says: for a rope point; POSED_AS, posing), or, for one no
 * joint turns (a finger, a collarbone), its nearest parent's.
 * @param {{ posing?: boolean }} [options]
 * @returns {number[]} an index into PART_NAMES for each of BONES
 */
export function boneParts({ posing = false } = {}) {
  /** @type {Map<string, number>} */
  const driven = new Map();
  PART_NAMES.forEach((part, i) => { for (const [name] of DRIVES[part]) driven.set(name, i); });
  for (const [name, part] of Object.entries(posing ? POSED_AS : TAPPED_AS)) driven.set(name, PART_NAMES.indexOf(part));
  /** @type {number[]} */
  const out = [];
  BONES.forEach((name, i) => {
    out.push(driven.get(name) ?? (PARENTS[i] < 0 ? 0 : out[PARENTS[i]]));
  });
  return out;
}

/**
 * Which part each of the mesh's vertices is on: the one whose bones move
 * it most (for a rope point, or with `posing`, for posing).
 * @param {{ joints: Uint8Array, weights: Uint8Array, vertices: number }} body
 * @param {{ posing?: boolean }} [options]
 * @returns {{ names: readonly string[], of: Uint8Array }} the parts, and an index into them per vertex
 */
export function vertexParts({ joints, weights, vertices }, options) {
  const ofBone = boneParts(options);
  const of = new Uint8Array(vertices);
  const sums = new Float64Array(PART_NAMES.length);
  for (let v = 0; v < vertices; v++) {
    sums.fill(0);
    for (let k = 0; k < 4; k++) sums[ofBone[joints[v * 4 + k]]] += weights[v * 4 + k];
    let best = 0;
    for (let p = 1; p < sums.length; p++) if (sums[p] > sums[best]) best = p;
    of[v] = best;
  }
  return { names: PART_NAMES, of };
}

/** For working out a joint's swing and twist as quaternions. */
const turning = new Object3D();
const swing = new Quaternion();
const twist = new Quaternion();
const share = new Quaternion();

/**
 * Puts the skeleton in a pose (and works out where everything is).
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 */
export function posed(skeleton, pose) {
  const { pelvis, all } = skeleton;
  if (pose.shape && !sameShape(pose.shape, skeleton.shape)) reshape(skeleton, pose.shape);
  // Poses saved before the figure could be moved have no shift.
  const [x, z] = pose.shift ?? [0, 0];
  pelvis.position.set(x, pose.lift, z);
  const turn = bodyRotation(pose.body);
  pelvis.rotation.set(turn.x, turn.y, turn.z, turn.order);
  for (const joint of JOINTS) {
    const r = jointRotation(joint.name, pose.joints[joint.name]);
    // The turn as a swing, then a twist about the bone's length: a joint
    // that shares them differently turns about y last (its twist), so the
    // two are its angles without and with only that turn.
    const drive = DRIVES[joint.name];
    if (drive.some(([, s, t = s]) => s !== t)) {
      turning.rotation.set(r.x, 0, r.z, r.order);
      swing.copy(turning.quaternion);
      turning.rotation.set(0, r.y, 0, r.order);
      twist.copy(turning.quaternion);
    } else {
      turning.rotation.set(r.x, r.y, r.z, r.order);
      swing.copy(turning.quaternion);
      twist.identity();
    }
    // Each bone takes its share of each (they add up to the whole, as each
    // turns about the same axes, already turned by the ones above).
    for (const [name, swingShare, twistShare = swingShare] of DRIVES[joint.name]) {
      const bone = /** @type {Object3D} */ (all.get(name));
      bone.quaternion.identity().slerp(swing, swingShare).multiply(share.identity().slerp(twist, twistShare));
    }
  }
  let root = pelvis;
  while (root.parent) root = root.parent;
  root.updateMatrixWorld(true);
}

/**
 * How high the body's lowest joint is in a pose (cm).
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 */
function lowestJoint(skeleton, pose) {
  posed(skeleton, pose);
  let low = Infinity;
  for (const bone of skeleton.all.values()) low = Math.min(low, bone.localToWorld(new Vector3()).y);
  return low;
}

/**
 * A pose with a new body shape, moved up or down so the body's lowest
 * point stays as high as it was: feet stay on the floor standing, knees
 * kneeling, and a body lying down stays down.
 * @param {Skeleton} skeleton any (it's posed)
 * @param {Pose} pose
 * @param {import("./figure-body.js").Shape} shape
 * @returns {Pose}
 */
export function withShape(skeleton, pose, shape) {
  const next = setShape(pose, shape);
  const drop = lowestJoint(skeleton, pose) - lowestJoint(skeleton, next);
  return Math.abs(drop) < 0.5 ? next : { ...next, lift: clamp(next.lift + drop, LIFT_RANGE) };
}

/**
 * Where a point on a bone is in the room (cm), the skeleton posed.
 * @param {Skeleton} skeleton
 * @param {string} bone
 * @param {[number, number, number]} [cm] from the bone's joint, in its own directions
 */
export const onBone = ({ bones }, bone, cm = [0, 0, 0]) =>
  /** @type {Object3D} */ (bones.get(bone)).localToWorld(new Vector3(...cm));

/**
 * Where a rope point is in the room (cm), the skeleton posed. A cinch's
 * spot on another rope is on the straight line between that rope's two
 * points, before the cinch pulls it (pose-cinch.js).
 * @param {Skeleton} skeleton
 * @param {RopePoint} point
 * @param {Pose} pose
 * @returns {Vector3}
 */
export function ropePoint(skeleton, [bone, x, y, z], pose) {
  if (bone === ROPE) {
    const { p } = pose.ropes[x];
    return ropePoint(skeleton, p[y], pose).lerp(ropePoint(skeleton, p[y + 1], pose), z / 1000);
  }
  if (bone === RING) {
    const [rx, ry, rz] = /** @type {number[]} */ (pose.ring);
    return new Vector3(rx, ry - RING_RADIUS, rz);
  }
  if (bone === BAMBOO) {
    const [bx, by, bz, turn] = /** @type {number[]} */ (pose.bamboo);
    return turned([bx, by, bz], turn, [x / 10, -BAMBOO_RADIUS, 0]);
  }
  if (bone === HASHIRA) {
    const [hx, hz, turn] = /** @type {number[]} */ (pose.hashira);
    return turned([hx, 0, hz], turn, [x / 10, y / 10, z / 10]);
  }
  return onBone(skeleton, bone, [x / 10, y / 10, z / 10]);
}

/**
 * A point in the room (cm) as the millimetres from a bone a rope point is
 * kept in, the skeleton posed.
 * @param {Skeleton} skeleton
 * @param {string} bone
 * @param {Vector3} world
 * @returns {[number, number, number]}
 */
export function toBone({ bones }, bone, world) {
  const local = /** @type {Object3D} */ (bones.get(bone)).worldToLocal(world.clone());
  return [Math.round(local.x * 10), Math.round(local.y * 10), Math.round(local.z * 10)];
}
