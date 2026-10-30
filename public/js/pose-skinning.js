// Dual-quaternion skinning for the poser's body: each vertex is moved by a
// blend of its bones' turns and moves as one rigid motion, rather than a
// blend of where each bone would put it (three.js's own, linear blending).
// A tightly bent elbow or knee then keeps its volume and rounds off,
// rather than folding to a sharp point, and a twisted forearm doesn't
// shrink. Pure: the shader code is a string, and the CPU's version
// (dqTransform, for tapping the body where it's drawn) is plain math.
//
// Bone matrices are rigid (a turn and a move, no scaling), as the body's
// are. The body's bind matrix is the identity, so it's left out.

/**
 * A rigid motion as a dual quaternion: its turn (`r`, x y z w) and its
 * move (`d`, the dual part).
 * @typedef {{ r: [number, number, number, number], d: [number, number, number, number] }} DualQuat
 */

/**
 * The turn of a rigid 4 × 4 matrix as a quaternion.
 * @param {ArrayLike<number>} e the matrix's elements, column by column (three.js's Matrix4.elements)
 * @returns {[number, number, number, number]}
 */
function turnOf(e) {
  // R(row, column) = e[column * 4 + row]
  const r00 = e[0], r10 = e[1], r20 = e[2], r01 = e[4], r11 = e[5], r21 = e[6], r02 = e[8], r12 = e[9], r22 = e[10];
  const trace = r00 + r11 + r22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return [(r21 - r12) / s, (r02 - r20) / s, (r10 - r01) / s, s / 4];
  }
  if (r00 > r11 && r00 > r22) {
    const s = Math.sqrt(1 + r00 - r11 - r22) * 2;
    return [s / 4, (r01 + r10) / s, (r02 + r20) / s, (r21 - r12) / s];
  }
  if (r11 > r22) {
    const s = Math.sqrt(1 + r11 - r00 - r22) * 2;
    return [(r01 + r10) / s, s / 4, (r12 + r21) / s, (r02 - r20) / s];
  }
  const s = Math.sqrt(1 + r22 - r00 - r11) * 2;
  return [(r02 + r20) / s, (r12 + r21) / s, s / 4, (r10 - r01) / s];
}

/**
 * A rigid matrix as a dual quaternion.
 * @param {ArrayLike<number>} e column by column
 * @returns {DualQuat}
 */
export function toDualQuat(e) {
  const [x, y, z, w] = turnOf(e);
  const [tx, ty, tz] = [e[12], e[13], e[14]];
  // d = ½ (t, 0) × r
  return {
    r: [x, y, z, w],
    d: [
      0.5 * (tx * w + ty * z - tz * y),
      0.5 * (ty * w + tz * x - tx * z),
      0.5 * (tz * w + tx * y - ty * x),
      -0.5 * (tx * x + ty * y + tz * z),
    ],
  };
}

/**
 * Blends rigid motions by weight, each turned the same way round as the
 * first (q and −q are the same turn), and normalised.
 * @param {DualQuat[]} motions
 * @param {ArrayLike<number>} weights
 * @returns {DualQuat}
 */
export function blendDualQuats(motions, weights) {
  const r = [0, 0, 0, 0], d = [0, 0, 0, 0];
  const first = motions[0].r;
  motions.forEach(({ r: qr, d: qd }, i) => {
    const w = weights[i];
    if (!w) return;
    const sign = qr[0] * first[0] + qr[1] * first[1] + qr[2] * first[2] + qr[3] * first[3] < 0 ? -w : w;
    for (let k = 0; k < 4; k++) {
      r[k] += sign * qr[k];
      d[k] += sign * qd[k];
    }
  });
  const length = Math.hypot(r[0], r[1], r[2], r[3]) || 1;
  return {
    r: /** @type {[number, number, number, number]} */ (r.map((n) => n / length)),
    d: /** @type {[number, number, number, number]} */ (d.map((n) => n / length)),
  };
}

/**
 * A point moved by a (normalised) dual quaternion.
 * @param {DualQuat} dq
 * @param {[number, number, number]} p
 * @returns {[number, number, number]}
 */
export function dqTransform({ r, d }, [px, py, pz]) {
  const [x, y, z, w] = r;
  // Turned: p + 2 r × (r × p + w p)
  const cx = y * pz - z * py + w * px, cy = z * px - x * pz + w * py, cz = x * py - y * px + w * pz;
  const tx = px + 2 * (y * cz - z * cy), ty = py + 2 * (z * cx - x * cz), tz = pz + 2 * (x * cy - y * cx);
  // Moved: 2 (w d − d.w r + r × d)
  const mx = 2 * (w * d[0] - d[3] * x + (y * d[2] - z * d[1]));
  const my = 2 * (w * d[1] - d[3] * y + (z * d[0] - x * d[2]));
  const mz = 2 * (w * d[2] - d[3] * z + (x * d[1] - y * d[0]));
  return [tx + mx, ty + my, tz + mz];
}

/** GLSL: the same, before the vertex shader's main(). */
const FUNCTIONS = /* glsl */`
vec4 dqTurnOf( mat4 m ) {
  float trace = m[0][0] + m[1][1] + m[2][2];
  if ( trace > 0.0 ) {
    float s = sqrt( trace + 1.0 ) * 2.0;
    return vec4( ( m[1][2] - m[2][1] ) / s, ( m[2][0] - m[0][2] ) / s, ( m[0][1] - m[1][0] ) / s, 0.25 * s );
  }
  if ( m[0][0] > m[1][1] && m[0][0] > m[2][2] ) {
    float s = sqrt( 1.0 + m[0][0] - m[1][1] - m[2][2] ) * 2.0;
    return vec4( 0.25 * s, ( m[1][0] + m[0][1] ) / s, ( m[2][0] + m[0][2] ) / s, ( m[1][2] - m[2][1] ) / s );
  }
  if ( m[1][1] > m[2][2] ) {
    float s = sqrt( 1.0 + m[1][1] - m[0][0] - m[2][2] ) * 2.0;
    return vec4( ( m[1][0] + m[0][1] ) / s, 0.25 * s, ( m[2][1] + m[1][2] ) / s, ( m[2][0] - m[0][2] ) / s );
  }
  float s = sqrt( 1.0 + m[2][2] - m[0][0] - m[1][1] ) * 2.0;
  return vec4( ( m[2][0] + m[0][2] ) / s, ( m[2][1] + m[1][2] ) / s, 0.25 * s, ( m[0][1] - m[1][0] ) / s );
}
vec4 dqMoveOf( mat4 m, vec4 r ) {
  vec3 t = m[3].xyz;
  return 0.5 * vec4( t * r.w + cross( t, r.xyz ), -dot( t, r.xyz ) );
}
void dqAdd( inout vec4 real, inout vec4 dual, mat4 m, float w, vec4 first ) {
  vec4 r = dqTurnOf( m );
  float s = dot( r, first ) < 0.0 ? -w : w;
  real += s * r;
  dual += s * dqMoveOf( m, r );
}
vec3 dqTurn( vec4 r, vec3 p ) {
  return p + 2.0 * cross( r.xyz, cross( r.xyz, p ) + r.w * p );
}
vec3 dqMove( vec4 r, vec4 d ) {
  return 2.0 * ( r.w * d.xyz - d.w * r.xyz + cross( r.xyz, d.xyz ) );
}
`;

/** GLSL, in place of skinnormal_vertex (which runs first): the blend, and the normal turned by it. */
const NORMAL = /* glsl */`
#ifdef USE_SKINNING
  vec4 dqFirst = dqTurnOf( boneMatX );
  vec4 dqReal = vec4( 0.0 );
  vec4 dqDual = vec4( 0.0 );
  dqAdd( dqReal, dqDual, boneMatX, skinWeight.x, dqFirst );
  dqAdd( dqReal, dqDual, boneMatY, skinWeight.y, dqFirst );
  dqAdd( dqReal, dqDual, boneMatZ, skinWeight.z, dqFirst );
  dqAdd( dqReal, dqDual, boneMatW, skinWeight.w, dqFirst );
  float dqLength = length( dqReal );
  dqReal /= dqLength;
  dqDual /= dqLength;
  objectNormal = dqTurn( dqReal, objectNormal );
#endif
`;

/** GLSL, in place of skinning_vertex: the point turned and moved by the blend. */
const POSITION = /* glsl */`
#ifdef USE_SKINNING
  transformed = dqTurn( dqReal, transformed ) + dqMove( dqReal, dqDual );
#endif
`;

/**
 * Puts dual-quaternion skinning into a three.js material's vertex shader
 * (for its onBeforeCompile).
 * @param {string} vertexShader
 * @returns {string}
 */
export function withDualQuatSkinning(vertexShader) {
  for (const chunk of ["#include <skinning_pars_vertex>", "#include <skinnormal_vertex>", "#include <skinning_vertex>"]) {
    if (!vertexShader.includes(chunk)) throw new Error(`The shader has no ${chunk}.`);
  }
  return vertexShader
    .replace("#include <skinning_pars_vertex>", `#include <skinning_pars_vertex>\n${FUNCTIONS}`)
    .replace("#include <skinnormal_vertex>", NORMAL)
    .replace("#include <skinning_vertex>", POSITION);
}
