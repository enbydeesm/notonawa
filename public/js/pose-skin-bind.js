// Rope on the body that moves with the skin. A rope point on the body is
// kept on a part ([bone, x, y, z]: mm from the part's joint), but where it's
// drawn isn't that bone's turn alone: it's where the skin there goes. Each
// point is first placed on the body standing straight (every bone at rest,
// as the skeleton is built: lined up with the world, at its joint), where
// it takes the bone weights of the skin nearest it (up to four bones, as a
// vertex has). Posed, it's moved by the same blend of those bones as the
// skin is (dual-quaternion skinning, pose-skinning.js), so a wrap round the
// waist bends and stretches with it, as if drawn on the skin, rather than
// turning stiffly with the spine or the chest. The way round between two
// points is laid out on the straight body (where the capsules fit it) and
// moved the same way (pose-cinch.js).
//
// Going back (a tap, a drag): the point on the straight body that ends up
// under the finger, found by guessing, seeing where the guess lands, and
// moving it by the miss, a few times over.
//
// Pure apart from three.js's math: the mesh is handed in (the 3D view
// loads it; the unit tests read it from disk).

import { Matrix4, Quaternion, Vector3 } from "./vendor/three.js";
import { BONES, PARENTS, TURNS, bindHeads, bodyPositions } from "./figure-body.js";
import { toDualQuat, blendDualQuats, dqTransform } from "./pose-skinning.js";

/** @typedef {import("./figure-body.js").Body} Body */
/** @typedef {import("./figure-body.js").Shape} Shape */
/** @typedef {import("./vendor/three.js").Object3D} Object3D */

/** The skin vertices a point's weights come from. */
const NEAREST = 4;
/** The root bone (the pelvis), the one with no parent. */
const ROOT = PARENTS.indexOf(-1);
/** The parts that are one stretch of skin (pose-surface.js's trunk): a point on one takes weights from all. */
const TRUNK = Object.freeze(["pelvis", "hips", "spine", "chest"]);

/**
 * A part's stretch of skin, the skin a point on it takes its weights from:
 * the trunk, the head, or a whole arm or leg, so a point by the elbow kept
 * on the forearm still bends as the skin above the elbow does.
 * @param {string} part
 */
export const groupOf = (part) => (TRUNK.includes(part) ? "trunk"
  : part === "head" ? "head" : `${part.slice(0, 2)}${/shoulder|elbow|wrist/.test(part) ? "arm" : "leg"}`);
/** How near a guess has to land when going back (cm). */
const CLOSE = 0.01;
/** The most guesses going back. */
const TRIES = 8;

/**
 * A point's skin weights: which bones (BONES' indices), how much each, and
 * which way the skin faces there (on the straight body).
 * @typedef {{ bones: number[], weights: number[], normal: Vector3 }} Weights
 */

/**
 * The skin as the ropes need it: the mesh, which part each vertex is on,
 * and each part's stretch of vertices.
 * @typedef {{ body: Body, names: readonly string[], groups: Map<string, Uint32Array>,
 *   rests: Map<string, Rest> }} Binding
 */

/**
 * The straight body for one shape: every vertex and its normal there, and
 * each point's weights once worked out.
 * @typedef {{ positions: Float32Array, normals: Float32Array, heads: ArrayLike<number>, found: Map<string, Weights> }} Rest
 */

/**
 * Each bone's skin moved from where it's bound (Anny's pose, arms out) to
 * its joint standing arms down: back from its bound joint, then its turn.
 * The same as the 3D view's skin.
 * @param {Shape} shape
 * @returns {Matrix4[]}
 */
export function bindInverses(shape) {
  const bound = bindHeads(shape);
  return BONES.map((name, i) => {
    const m = new Matrix4();
    const [x, y, z] = [-bound[i * 3], -bound[i * 3 + 1], -bound[i * 3 + 2]];
    const t = TURNS[name];
    if (!t) return m.makeTranslation(x, y, z);
    return m.set(t[0], t[1], t[2], t[0] * x + t[1] * y + t[2] * z,
      t[3], t[4], t[5], t[3] * x + t[4] * y + t[5] * z,
      t[6], t[7], t[8], t[6] * x + t[7] * y + t[8] * z,
      0, 0, 0, 1);
  });
}

/**
 * The skin for ropes to follow.
 * @param {Body} body
 * @param {{ names: readonly string[], of: Uint8Array }} parts which part each vertex is on (vertexParts)
 * @returns {Binding}
 */
export function makeBinding(body, { names, of }) {
  /** @type {Map<string, number[]>} */
  const lists = new Map();
  for (let v = 0; v < body.vertices; v++) {
    const group = groupOf(names[of[v]]);
    let list = lists.get(group);
    if (!list) lists.set(group, list = []);
    list.push(v);
  }
  return { body, names, groups: new Map([...lists].map(([g, l]) => [g, Uint32Array.from(l)])), rests: new Map() };
}

/**
 * Where a bone is on the straight body (cm, from the pelvis): its joint.
 * @param {ArrayLike<number>} heads the skeleton's rest joints (bodyHeads)
 * @param {number} i its index in BONES
 */
const restHead = (heads, i) => new Vector3(heads[i * 3] - heads[ROOT * 3], heads[i * 3 + 1] - heads[ROOT * 3 + 1], heads[i * 3 + 2] - heads[ROOT * 3 + 2]);

/**
 * The straight body for a shape, worked out once.
 * @param {Binding} binding
 * @param {Shape} shape
 * @param {ArrayLike<number>} heads the skeleton's rest joints, for that shape
 * @returns {Rest}
 */
export function restOf(binding, shape, heads) {
  const key = shape.join();
  const kept = binding.rests.get(key);
  if (kept) return kept;
  const { body } = binding;
  const bind = bodyPositions(body, shape);
  const inverses = bindInverses(shape);
  const motions = BONES.map((_, i) => {
    const h = restHead(heads, i);
    return toDualQuat(new Matrix4().makeTranslation(h.x, h.y, h.z).multiply(inverses[i]).elements);
  });
  const positions = new Float32Array(bind.length);
  for (let v = 0; v < body.vertices; v++) {
    /** @type {import("./pose-skinning.js").DualQuat[]} */
    const ms = [];
    /** @type {number[]} */
    const ws = [];
    for (let k = 0; k < 4; k++) {
      const w = body.weights[v * 4 + k] / 255;
      if (!w) continue;
      ms.push(motions[body.joints[v * 4 + k]]);
      ws.push(w);
    }
    const [x, y, z] = dqTransform(blendDualQuats(ms, ws), [bind[v * 3], bind[v * 3 + 1], bind[v * 3 + 2]]);
    positions[v * 3] = x;
    positions[v * 3 + 1] = y;
    positions[v * 3 + 2] = z;
  }
  const rest = { positions, normals: normalsOf(positions, body.faces), heads: Float64Array.from(heads), found: new Map() };
  // A few shapes kept: the slider being dragged makes a new one each step.
  if (binding.rests.size >= 3) binding.rests.delete(/** @type {string} */ (binding.rests.keys().next().value));
  binding.rests.set(key, rest);
  return rest;
}

/**
 * Each vertex's normal, from the faces round it (weighted by their size).
 * @param {Float32Array} p @param {Uint16Array} faces
 */
function normalsOf(p, faces) {
  const n = new Float32Array(p.length);
  for (let f = 0; f < faces.length; f += 3) {
    const [a, b, c] = [faces[f] * 3, faces[f + 1] * 3, faces[f + 2] * 3];
    const [ux, uy, uz] = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const [vx, vy, vz] = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const [nx, ny, nz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const i of [a, b, c]) {
      n[i] += nx;
      n[i + 1] += ny;
      n[i + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

/**
 * A point's skin weights on the straight body: the nearest vertices of its
 * parts' stretches of skin, the nearer counting more, their bones' weights
 * added up and the four biggest kept.
 * @param {Binding} binding
 * @param {Rest} rest
 * @param {readonly string[]} groups the stretches of skin it can be on (groupOf)
 * @param {Vector3} p on the straight body
 * @returns {Weights}
 */
export function weightsAt(binding, rest, groups, p) {
  const key = `${groups.join("+")}|${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;
  const kept = rest.found.get(key);
  if (kept) return kept;
  const { body } = binding;
  const { positions: at, normals } = rest;
  /** The nearest few: [squared distance, vertex], nearest first. @type {[number, number][]} */
  const near = [];
  for (const group of groups) {
    for (const v of binding.groups.get(group) ?? []) {
      const d = (at[v * 3] - p.x) ** 2 + (at[v * 3 + 1] - p.y) ** 2 + (at[v * 3 + 2] - p.z) ** 2;
      if (near.length === NEAREST && d >= near[NEAREST - 1][0]) continue;
      let i = near.length === NEAREST ? NEAREST - 1 : near.length;
      near[i] = [d, v];
      while (i > 0 && near[i - 1][0] > d) {
        [near[i - 1], near[i]] = [near[i], near[i - 1]];
        i--;
      }
    }
  }
  /** @type {Map<number, number>} */
  const sums = new Map();
  const normal = new Vector3();
  for (const [d, v] of near) {
    // The nearest counts most: a point on a vertex takes its weights almost alone.
    const share = 1 / (d + 0.04);
    for (let k = 0; k < 4; k++) {
      const w = body.weights[v * 4 + k] / 255;
      if (w) sums.set(body.joints[v * 4 + k], (sums.get(body.joints[v * 4 + k]) ?? 0) + share * w);
    }
    normal.x += share * normals[v * 3];
    normal.y += share * normals[v * 3 + 1];
    normal.z += share * normals[v * 3 + 2];
  }
  const top = [...sums].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = top.reduce((s, [, w]) => s + w, 0) || 1;
  const found = { bones: top.map(([b]) => b), weights: top.map(([, w]) => w / total), normal: normal.normalize() };
  if (rest.found.size > 20000) rest.found.clear();
  rest.found.set(key, found);
  return found;
}

const motion = new Matrix4();
const unrest = new Matrix4();

/**
 * Where a point on the straight body is on the body as posed: moved by its
 * bones' blend, as the skin there is.
 * @param {Map<string, Object3D>} all the skeleton's bones by name, posed (matrixWorld up to date)
 * @param {Rest} rest
 * @param {Weights} weights
 * @param {Vector3} p on the straight body
 * @returns {Vector3}
 */
export function deform(all, rest, { bones, weights }, p) {
  if (!bones.length) return p.clone();
  const motions = bones.map((b) => {
    const head = restHead(rest.heads, b);
    unrest.makeTranslation(-head.x, -head.y, -head.z);
    return toDualQuat(motion.multiplyMatrices(/** @type {Object3D} */ (all.get(BONES[b])).matrixWorld, unrest).elements);
  });
  const [x, y, z] = dqTransform(blendDualQuats(motions, weights), [p.x, p.y, p.z]);
  return new Vector3(x, y, z);
}

const turn = new Quaternion();

/**
 * The point on the straight body that the posed body puts at `world`:
 * guessed from the part's own turn, then moved by each miss.
 * @param {Map<string, Object3D>} all the skeleton's bones, posed
 * @param {Object3D} anchor the part's
 * @param {Vector3} anchorRest where the anchor is on the straight body
 * @param {(p: Vector3) => Weights} weightsFor
 * @param {Rest} rest
 * @param {Vector3} world
 * @returns {Vector3} on the straight body
 */
export function undeform(all, anchor, anchorRest, weightsFor, rest, world) {
  anchor.getWorldQuaternion(turn).invert();
  const p = anchor.worldToLocal(world.clone()).add(anchorRest);
  for (let i = 0; i < TRIES; i++) {
    const miss = world.clone().sub(deform(all, rest, weightsFor(p), p));
    if (miss.length() < CLOSE) break;
    p.add(miss.applyQuaternion(turn));
  }
  return p;
}
