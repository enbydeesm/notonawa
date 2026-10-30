// The parts of three.js the poser uses (pose-scene.js), bundled by
// scripts/vendor.mjs into one minified public/js/vendor/three.js. Only
// these are bundled, so the page loads a fraction of the library. Add a
// name here (and to three.d.ts beside this file) to use it.
export {
  Bone,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
