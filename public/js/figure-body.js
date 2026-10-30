// The poser's body: its shape from four sliders (gender, muscle, weight,
// height), where its joints are for that shape, and its measurements. Pure
// (the mesh is read from bytes handed in), so it's tested like the poses.
//
// The body comes from Anny (github.com/naver/anny), built by
// scripts/figure/: its shape at every corner of the sliders, posed arms
// down (figure-body-data.js has the joints; /figure/body-*.bin, the mesh).
// A shape between the corners is their blend, each weighted by how near the
// sliders are to it, so it's exactly what Anny would make. Always an adult:
// Anny's age is fixed at its young-adult setting.
//
// The sliders, as a pose keeps them (`shape`, whole numbers):
//   gender  0 (masculine) to 100 (feminine), 50 in between
//   muscle  0 (soft) to 100 (muscular)
//   weight  0 to 100: 50 is Anny's heaviest; past it the body goes on
//           getting heavier the same way, with fat added to the belly,
//           waist, hips, thighs, arms and neck (export_body.py, FAT)
//   height  cm, top of the head to the soles

import {
  BONES, PARENTS, CORNERS, CORNER_KEYS, HEADS, CORNER_HEADS, FAT_HEADS, BIND_HEADS, CORNER_BIND_HEADS, FAT_BIND_HEADS,
  TURNS, CORNER_STATURE, CORNER_FLOOR, FAT_STATURE, FAT_FLOOR, BODY_FILE, SEGMENTS, RADII, CORNER_RADII, FAT_RADII,
} from "./figure-body-data.js";

export { BONES, PARENTS, BODY_FILE, TURNS, SEGMENTS };

/** @typedef {[number, number, number, number]} Shape gender, muscle, weight, height (cm) */

/** Each slider's range. @type {readonly (readonly [number, number])[]} */
export const SHAPE_RANGES = Object.freeze([[0, 100], [0, 100], [0, 100], [150, 200]]);
/** The sliders' names, and what each end means. */
export const SHAPE_SLIDERS = Object.freeze([
  { label: "Gender", ends: ["Masculine", "Feminine"] },
  { label: "Muscle", ends: ["Soft", "Muscular"] },
  { label: "Weight", ends: ["Lighter", "Heavier"] },
  { label: "Body height (cm)", ends: ["150", "200"] },
]);
/** Anny's in-between body, at the height it has there (copy it before changing). */
export const DEFAULT_SHAPE = /** @type {Shape} */ ([50, 50, 25, 184]);

/**
 * How much each anchor counts for a value between them: the two either
 * side share it, and past the last the last two go on in a straight line
 * (so weight can go past Anny's heaviest).
 * @param {number} x
 * @param {readonly number[]} anchors ascending
 * @returns {number[]} one per anchor, summing to 1
 */
export function hats(x, anchors) {
  const out = anchors.map(() => 0);
  let i = 0;
  while (i < anchors.length - 2 && x > anchors[i + 1]) i++;
  const t = (x - anchors[i]) / (anchors[i + 1] - anchors[i]);
  out[i] = 1 - t;
  out[i + 1] = t;
  return out;
}

/**
 * How much each corner counts for Anny's own slider values (0 to 1; weight
 * up to 2), and how much of the heavier shape is added.
 * @param {number[]} values gender, muscle, weight, height, Anny's
 * @returns {{ corners: Float64Array, fat: number }}
 */
function blend(values) {
  const weights = values.map((v, i) => hats(v, CORNERS[i]));
  const corners = new Float64Array(CORNER_KEYS.length);
  CORNER_KEYS.forEach((key, c) => {
    corners[c] = key.reduce((p, v, i) => p * weights[i][CORNERS[i].indexOf(v)], 1);
  });
  return { corners, fat: Math.max(0, values[2] - 1) };
}

/** @param {Float64Array} corners @param {readonly number[]} perCorner */
const sum = (corners, perCorner) => corners.reduce((s, a, c) => s + a * perCorner[c], 0);

/**
 * Anny's height slider (0 to 1) for a height in cm, with the other sliders
 * as they are: height is a straight line between its two corners.
 * @param {number} g @param {number} m @param {number} w Anny's values
 * @param {number} cm
 */
function heightValue(g, m, w, cm) {
  const at = (/** @type {number} */ h) => {
    const { corners, fat } = blend([g, m, w, h]);
    return sum(corners, CORNER_STATURE) + fat * FAT_STATURE;
  };
  const low = at(0), high = at(1);
  return (cm - low) / (high - low);
}

/**
 * The corners' weights for a shape (the sliders as a pose keeps them).
 * @param {Shape} shape
 * @returns {{ corners: Float64Array, fat: number }}
 */
export function shapeBlend([gender, muscle, weight, height]) {
  const g = gender / 100, m = muscle / 100, w = weight / 50;
  return blend([g, m, w, heightValue(g, m, w, height)]);
}

/**
 * Where every bone's joint is for a shape, standing arms down (cm, from
 * the hip centre; BONES order, three numbers each).
 * @type {(shape: Shape) => Float64Array}
 */
export const bodyHeads = (shape) => blendHeads(shape, HEADS, CORNER_HEADS, FAT_HEADS);

/**
 * Where every bone's joint is for a shape in the pose the skin is bound in
 * (Anny's own, arms out), BONES order: each bone's skin is moved from there.
 * @param {Shape} shape
 * @returns {Float64Array}
 */
export const bindHeads = (shape) => blendHeads(shape, BIND_HEADS, CORNER_BIND_HEADS, FAT_BIND_HEADS);

/**
 * The body's segments as capsules for a shape (SEGMENTS order, three
 * numbers each): radius, how far forward of its line, and how far out a
 * torso segment's side capsules are (cm).
 * @type {(shape: Shape) => Float64Array}
 */
export const segmentSizes = (shape) => blendHeads(shape, RADII, CORNER_RADII, FAT_RADII);

/**
 * @param {Shape} shape
 * @param {readonly number[]} base @param {readonly (readonly number[])[]} perCorner @param {readonly number[]} fatDelta
 */
function blendHeads(shape, base, perCorner, fatDelta) {
  const { corners, fat } = shapeBlend(shape);
  const out = Float64Array.from(base);
  corners.forEach((a, c) => {
    if (!a) return;
    const delta = perCorner[c];
    for (let i = 0; i < out.length; i++) out[i] += a * delta[i];
  });
  if (fat) for (let i = 0; i < out.length; i++) out[i] += fat * fatDelta[i];
  return out;
}

/**
 * How high the hip centre is above the soles when standing: the lift that
 * puts this body's feet on the floor.
 * @param {Shape} shape
 */
export function standingLift(shape) {
  const { corners, fat } = shapeBlend(shape);
  return sum(corners, CORNER_FLOOR) + fat * FAT_FLOOR;
}

/**
 * A shape kept within the sliders' ranges, as whole numbers; the default
 * for anything missing.
 * @param {unknown} shape
 * @returns {Shape}
 */
export function cleanShape(shape) {
  const values = Array.isArray(shape) ? shape : [];
  return /** @type {Shape} */ (SHAPE_RANGES.map(([min, max], i) => {
    const n = Number(values[i]);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : DEFAULT_SHAPE[i];
  }));
}

/** @param {Shape} a @param {Shape} b */
export const sameShape = (a, b) => a.every((n, i) => n === b[i]);

// --- the mesh -------------------------------------------------------------

/**
 * The mesh: its in-between shape, the components every other shape is
 * made of, its triangles, and which bones move each vertex.
 * @typedef {{
 *   vertices: number, components: number,
 *   base: Float32Array, basis: Int16Array, scales: Float32Array, coeff: Float32Array,
 *   fat: Int16Array, fatScale: number, faces: Uint16Array, joints: Uint8Array, weights: Uint8Array,
 *   waist: Uint16Array,
 * }} Body
 */

const TYPES = /** @type {const} */ ({ float32: Float32Array, int16: Int16Array, uint16: Uint16Array, uint8: Uint8Array });

/**
 * Reads the mesh file (pack_body.py): "NOTOBODY", a header's length, the
 * header (JSON: each section's type, where it starts and how long it is),
 * then the sections.
 * @param {ArrayBuffer} buffer
 * @returns {Body}
 */
export function readBody(buffer) {
  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 8));
  if (magic !== "NOTOBODY") throw new Error("Not a body file.");
  const length = new DataView(buffer).getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, length)));
  const start = 12 + length;
  /** @type {Record<string, any>} */
  const s = {};
  for (const { name, type, offset, length: n } of header.sections) {
    s[name] = new TYPES[/** @type {keyof typeof TYPES} */ (type)](buffer, start + offset, n);
  }
  return {
    vertices: header.vertices, components: header.components,
    base: s.base, basis: s.basis, scales: s.scales, coeff: s.coeff, fat: s.fat, fatScale: s.fatScale[0],
    faces: s.faces, joints: s.joints, weights: s.weights, waist: s.waist,
  };
}

/**
 * Every vertex's place for a shape (cm, in Anny's pose, arms out, from
 * the hip centre): the in-between shape plus each component as much as the
 * corners' blend says, plus the heavier shape.
 * @param {Body} body
 * @param {Shape} shape
 * @param {Float32Array} [out]
 * @returns {Float32Array}
 */
export function bodyPositions(body, shape, out = new Float32Array(body.base.length)) {
  const { corners, fat } = shapeBlend(shape);
  const { components: R, vertices: V } = body;
  out.set(body.base);
  for (let r = 0; r < R; r++) {
    let amount = 0;
    corners.forEach((a, c) => { amount += a * body.coeff[c * R + r]; });
    const k = amount * body.scales[r];
    if (!k) continue;
    const from = r * V * 3;
    for (let i = 0; i < V * 3; i++) out[i] += k * body.basis[from + i];
  }
  if (fat) {
    const k = fat * body.fatScale;
    for (let i = 0; i < V * 3; i++) out[i] += k * body.fat[i];
  }
  return out;
}

/** Body density, kg per litre (as Anny measures). */
const DENSITY = 0.98;

/**
 * A body's measurements, as Anny makes them: its height, its waist (round
 * a ring of vertices), its volume (the closed mesh's), its mass from that,
 * and the BMI.
 * @param {Body} body
 * @param {Float32Array} p its vertices (bodyPositions)
 * @returns {{ height: number, waist: number, volume: number, mass: number, bmi: number }}
 *   cm, cm, litres, kg, kg/m²
 */
export function measurements(body, p) {
  let low = Infinity, high = -Infinity;
  for (let i = 1; i < p.length; i += 3) {
    if (p[i] < low) low = p[i];
    if (p[i] > high) high = p[i];
  }
  let six = 0;
  const f = body.faces;
  for (let i = 0; i < f.length; i += 3) {
    const a = f[i] * 3, b = f[i + 1] * 3, c = f[i + 2] * 3;
    six += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  const volume = Math.abs(six) / 6 / 1000;
  let waist = 0;
  const ring = body.waist;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] * 3, b = ring[(i + ring.length - 1) % ring.length] * 3;
    waist += Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]);
  }
  const height = high - low, mass = volume * DENSITY;
  return { height, waist, volume, mass, bmi: mass / (height / 100) ** 2 };
}
