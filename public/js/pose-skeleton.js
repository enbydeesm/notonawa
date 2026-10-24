// The figure's bones as three.js objects, posed: where every joint, and
// every rope point, is in the room for a pose. No drawing here (that's
// pose-scene.js), so the unit tests can check poses with three.js's math
// alone: that a preset's hands really are behind its back, say.

import { Object3D, Vector3 } from "./vendor/three.js";
import { JOINTS, jointRotation, bodyRotation } from "./figure-rig.js";
import { RING, BAMBOO, HASHIRA } from "./pose-format.js";

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
 * A new skeleton at rest: the pelvis (its root) and every bone by name.
 * @param {Object3D} [pelvis] the root to build on (a Group, in the scene)
 */
export function makeSkeleton(pelvis = new Object3D()) {
  /** @type {Map<string, Object3D>} */
  const bones = new Map([["pelvis", pelvis]]);
  for (const joint of JOINTS) {
    const bone = new Object3D();
    bone.position.set(...joint.offset);
    /** @type {Object3D} */ (bones.get(joint.parent)).add(bone);
    bones.set(joint.name, bone);
  }
  return { pelvis, bones };
}

/** @typedef {ReturnType<typeof makeSkeleton>} Skeleton */

/**
 * Puts the skeleton in a pose (and works out where everything is).
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 */
export function posed({ pelvis, bones }, pose) {
  pelvis.position.set(0, pose.lift, 0);
  const turn = bodyRotation(pose.body);
  pelvis.rotation.set(turn.x, turn.y, turn.z, turn.order);
  for (const joint of JOINTS) {
    const r = jointRotation(joint.name, pose.joints[joint.name]);
    /** @type {Object3D} */ (bones.get(joint.name)).rotation.set(r.x, r.y, r.z, r.order);
  }
  let root = pelvis;
  while (root.parent) root = root.parent;
  root.updateMatrixWorld(true);
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
 * Where a rope point is in the room (cm), the skeleton posed.
 * @param {Skeleton} skeleton
 * @param {RopePoint} point
 * @param {Pose} pose
 */
export function ropePoint(skeleton, [bone, x, y, z], pose) {
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
