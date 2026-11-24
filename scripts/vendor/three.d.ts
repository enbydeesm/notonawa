// Types for public/js/vendor/three.js: only the parts of three.js bundled
// there (three-entry.mjs), and only what the poser (pose-scene.js) uses of
// them. Written by hand, to keep the type checker following the poser
// without another package; copied into public/js/vendor/ by
// scripts/vendor.mjs. Add to it when the poser uses more of three.js.

export type ColorLike = Color | string | number;

export class Color {
  constructor(color?: ColorLike);
  r: number;
  g: number;
  b: number;
}

export class Vector2 {
  constructor(x?: number, y?: number);
  x: number;
  y: number;
}

export class Matrix4 {
  elements: number[];
  makeTranslation(x: number, y: number, z: number): this;
  multiplyMatrices(a: Matrix4, b: Matrix4): this;
  set(n11: number, n12: number, n13: number, n14: number, n21: number, n22: number, n23: number, n24: number,
    n31: number, n32: number, n33: number, n34: number, n41: number, n42: number, n43: number, n44: number): this;
}

export class Quaternion {
  constructor(x?: number, y?: number, z?: number, w?: number);
  x: number;
  y: number;
  z: number;
  w: number;
  set(x: number, y: number, z: number, w: number): this;
  identity(): this;
  copy(q: Quaternion): this;
  slerp(q: Quaternion, t: number): this;
  invert(): this;
  normalize(): this;
  lengthSq(): number;
  multiply(q: Quaternion): this;
  premultiply(q: Quaternion): this;
}

export class Vector3 {
  constructor(x?: number, y?: number, z?: number);
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): this;
  setScalar(s: number): this;
  copy(v: Vector3): this;
  clone(): Vector3;
  add(v: Vector3): this;
  addScaledVector(v: Vector3, s: number): this;
  sub(v: Vector3): this;
  lerp(v: Vector3, alpha: number): this;
  dot(v: Vector3): number;
  lengthSq(): number;
  project(camera: Camera): this;
  transformDirection(m: Matrix4): this;
  applyMatrix4(m: Matrix4): this;
  applyQuaternion(q: Quaternion): this;
  multiplyScalar(s: number): this;
  length(): number;
  distanceTo(v: Vector3): number;
}

export type EulerOrder = "XYZ" | "YXZ" | "ZXY" | "ZYX" | "YZX" | "XZY";

export class Euler {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number, order?: EulerOrder): this;
}

export class Object3D {
  position: Vector3;
  rotation: Euler;
  quaternion: Quaternion;
  scale: Vector3;
  name: string;
  frustumCulled: boolean;
  children: Object3D[];
  parent: Object3D | null;
  userData: Record<string, any>;
  visible: boolean;
  matrixWorld: Matrix4;
  add(...objects: Object3D[]): this;
  remove(...objects: Object3D[]): this;
  traverse(callback: (object: Object3D) => void): void;
  updateMatrixWorld(force?: boolean): void;
  localToWorld(vector: Vector3): Vector3;
  worldToLocal(vector: Vector3): Vector3;
  lookAt(x: number, y: number, z: number): void;
}

export class Group extends Object3D {}

export class Bone extends Object3D {}

export class Skeleton {
  constructor(bones?: Bone[], boneInverses?: Matrix4[]);
  bones: Bone[];
  boneInverses: Matrix4[];
  dispose(): void;
}

export class Scene extends Object3D {
  background: Color | null;
}

export class Camera extends Object3D {}

export class PerspectiveCamera extends Camera {
  constructor(fov?: number, aspect?: number, near?: number, far?: number);
  aspect: number;
  updateProjectionMatrix(): void;
}

export type TypedArray = Float32Array | Uint16Array | Uint8Array | Int16Array;

export class BufferAttribute {
  constructor(array: TypedArray, itemSize: number, normalized?: boolean);
  array: TypedArray;
  count: number;
  needsUpdate: boolean;
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
  setXYZ(index: number, x: number, y: number, z: number): this;
}

export class BufferGeometry {
  getAttribute(name: string): BufferAttribute;
  setAttribute(name: string, attribute: BufferAttribute): this;
  setIndex(index: BufferAttribute): this;
  computeVertexNormals(): void;
  dispose(): void;
}

export class CircleGeometry extends BufferGeometry {
  constructor(radius?: number, segments?: number);
}
export class CylinderGeometry extends BufferGeometry {
  constructor(radiusTop?: number, radiusBottom?: number, height?: number, radialSegments?: number);
}
export class SphereGeometry extends BufferGeometry {
  constructor(radius?: number, widthSegments?: number, heightSegments?: number);
}
export class TorusGeometry extends BufferGeometry {
  constructor(radius?: number, tube?: number, radialSegments?: number, tubularSegments?: number);
}

export class Curve<T> {
  getPoint(t: number): T;
}
export class CatmullRomCurve3 extends Curve<Vector3> {
  constructor(points?: Vector3[], closed?: boolean, curveType?: "centripetal" | "chordal" | "catmullrom", tension?: number);
}
export class TubeGeometry extends BufferGeometry {
  constructor(path?: Curve<Vector3>, tubularSegments?: number, radius?: number, radialSegments?: number, closed?: boolean);
}

export class Material {
  dispose(): void;
  onBeforeCompile: (shader: { vertexShader: string, fragmentShader: string }) => void;
  customProgramCacheKey: () => string;
}
export class MeshStandardMaterial extends Material {
  constructor(parameters?: { color?: ColorLike, roughness?: number, metalness?: number, flatShading?: boolean, vertexColors?: boolean, transparent?: boolean, opacity?: number, depthWrite?: boolean });
}
export class MeshBasicMaterial extends Material {
  constructor(parameters?: { color?: ColorLike });
}

export class Mesh extends Object3D {
  constructor(geometry?: BufferGeometry, material?: Material);
  geometry: BufferGeometry;
  material: Material;
}

export class SkinnedMesh extends Mesh {
  constructor(geometry?: BufferGeometry, material?: Material);
  skeleton: Skeleton;
  bindMode: "attached" | "detached";
  bind(skeleton: Skeleton, bindMatrix?: Matrix4): void;
  applyBoneTransform(index: number, target: Vector3): Vector3;
  computeBoundingSphere(): void;
}

export class Light extends Object3D {}
export class HemisphereLight extends Light {
  constructor(skyColor?: ColorLike, groundColor?: ColorLike, intensity?: number);
}
export class DirectionalLight extends Light {
  constructor(color?: ColorLike, intensity?: number);
}

export interface Intersection {
  distance: number;
  point: Vector3;
  object: Object3D;
  face?: { a: number, b: number, c: number, normal: Vector3 } | null;
}

export class Ray {
  origin: Vector3;
  direction: Vector3;
}

export class Raycaster {
  ray: Ray;
  setFromCamera(coords: Vector2, camera: Camera): void;
  intersectObjects(objects: Object3D[], recursive?: boolean): Intersection[];
}

export class WebGLRenderer {
  constructor(parameters?: { antialias?: boolean, preserveDrawingBuffer?: boolean, canvas?: HTMLCanvasElement });
  domElement: HTMLCanvasElement;
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: Object3D, camera: Camera): void;
  dispose(): void;
  forceContextLoss(): void;
}
