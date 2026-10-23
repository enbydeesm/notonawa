// The poser's 3D view: the figure (figure-rig.js) built from simple shapes,
// a floor, the ring and the ropes, drawn by three.js (vendor/three.js,
// bundled with only the parts used here). Loaded only when a pose is shown
// (poses-ui.js imports it), so the rest of the app doesn't fetch it.
//
// A view draws when asked (draw), not over and over, which spares a
// phone's battery. It also says what's under a point on it (pick): a body
// part, the ring or a rope, and where on the part, as the millimetres from
// its bone that a rope point is kept in (pose-format.js).
//
// Pictures of poses (thumbnails, and "Add as photo") come from one hidden
// view, reused (browsers allow only a few 3D views at once).

import {
  CapsuleGeometry, CatmullRomCurve3, CircleGeometry, Color, CylinderGeometry, DirectionalLight, Group,
  HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Raycaster,
  Scene, SphereGeometry, TorusGeometry, TubeGeometry, Vector2, Vector3, WebGLRenderer,
} from "./vendor/three.js";
import { SHAPES } from "./figure-rig.js";
import { ROPE_RADIUS } from "./pose-format.js";
import { makeSkeleton, posed, ropePoint, toBone, RING_RADIUS } from "./pose-skeleton.js";

/** @typedef {import("./pose-format.js").Pose} Pose */
/** @typedef {import("./vendor/three.js").Object3D} Object3D */
/** @typedef {import("./pose-format.js").Rope} Rope */
/**
 * What's under a point on the view.
 * @typedef {{ kind: "body", bone: string, mm: [number, number, number] } | { kind: "ring" } | { kind: "rope", index: number }} Hit
 */

/**
 * The view's colors, from app.css.
 * @param {string} name e.g. "pose-figure", "ink-red"
 */
const cssColor = (name) => new Color(getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim() || "#888");

/**
 * Whether this browser can draw 3D at all.
 * @returns {boolean}
 */
export function canDraw3d() {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * A 3D view of poses, on a canvas of its own (view.canvas).
 * @param {{ keepPicture?: boolean, pixelRatio?: number }} [options]
 *   keepPicture: so the canvas can be saved as an image after drawing;
 *   pixelRatio: canvas pixels to a CSS pixel (the screen's, up to 2, by default)
 */
export function poseView({ keepPicture = false, pixelRatio = Math.min(window.devicePixelRatio || 1, 2) } = {}) {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: keepPicture });
  renderer.setPixelRatio(pixelRatio);
  const canvas = renderer.domElement;

  const scene = new Scene();
  scene.background = cssColor("pose-backdrop");
  const camera = new PerspectiveCamera(38, 1, 5, 5000);

  scene.add(new HemisphereLight(0xffffff, cssColor("pose-floor"), 1.6));
  const key = new DirectionalLight(0xffffff, 1.8);
  key.position.set(160, 320, 260);
  scene.add(key);
  const fill = new DirectionalLight(0xffffff, 0.6);
  fill.position.set(-220, 120, -180);
  scene.add(fill);

  const floor = new Mesh(new CircleGeometry(260, 64), new MeshStandardMaterial({ color: cssColor("pose-floor"), roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // --- the figure ------------------------------------------------------------

  const skin = new MeshStandardMaterial({ color: cssColor("pose-figure"), roughness: 0.75 });
  const selectedSkin = new MeshStandardMaterial({ color: cssColor("pose-selected"), roughness: 0.6 });
  const sphere = new SphereGeometry(1, 28, 18);

  // The pelvis is the figure's root, moved and turned as the whole body.
  const skeleton = makeSkeleton(new Group());
  const { bones } = skeleton;
  scene.add(skeleton.pelvis);
  /** Every part's meshes, for picking and for showing which is selected. @type {Mesh[]} */
  const parts = [];
  for (const [name, shapes] of Object.entries(SHAPES)) {
    const bone = /** @type {Object3D} */ (bones.get(name));
    for (const shape of shapes) {
      /** @type {Mesh} */
      let mesh;
      if ("capsule" in shape) {
        const [a, b] = shape.capsule;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        mesh = new Mesh(new CapsuleGeometry(shape.r, length, 6, 16), skin);
        mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      } else {
        mesh = new Mesh(sphere, skin);
        mesh.position.set(shape.ellipsoid[0], shape.ellipsoid[1], shape.ellipsoid[2]);
        mesh.scale.set(shape.radii[0], shape.radii[1], shape.radii[2]);
      }
      mesh.userData.bone = name;
      bone.add(mesh);
      parts.push(mesh);
    }
  }

  // --- the ring, and the line it hangs from ----------------------------------

  const ringMaterial = new MeshStandardMaterial({ color: cssColor("pose-ring"), metalness: 0.6, roughness: 0.35 });
  const ring = new Group();
  const hoop = new Mesh(new TorusGeometry(RING_RADIUS, 0.9, 12, 40), ringMaterial);
  hoop.userData.ring = true;
  const hanger = new Mesh(new CylinderGeometry(0.35, 0.35, 1, 8), ringMaterial);
  ring.add(hoop, hanger);
  scene.add(ring);

  // --- ropes -----------------------------------------------------------------

  const ropes = new Group();
  scene.add(ropes);
  /** @type {Map<string, MeshStandardMaterial>} */
  const inks = new Map();
  /** @param {string} c */
  const ink = (c) => {
    let material = inks.get(c);
    if (!material) inks.set(c, material = new MeshStandardMaterial({ color: cssColor(`ink-${c}`), roughness: 0.8 }));
    return material;
  };
  const marker = new MeshBasicMaterial({ color: cssColor("ink-black") });

  /** The pose drawn last, so the view can be drawn again at a new size. @type {Pose | null} */
  let shown = null;

  /** Takes the old ropes off, freeing what they held. */
  function clearRopes() {
    for (const child of [...ropes.children]) {
      ropes.remove(child);
      if (child instanceof Mesh && child.geometry !== sphere) child.geometry.dispose();
    }
  }

  /**
   * @param {Rope} rope
   * @param {Pose} pose
   * @param {number} index its place in pose.ropes, or -1 for the one being laid
   */
  function addRope(rope, pose, index) {
    const points = rope.p.map((p) => ropePoint(skeleton, p, pose));
    const radius = ROPE_RADIUS[rope.w];
    if (points.length >= 2) {
      const curve = new CatmullRomCurve3(points, false, "centripetal");
      const tube = new Mesh(new TubeGeometry(curve, Math.max(12, points.length * 12), radius, 8, false), ink(rope.c));
      tube.userData.rope = index;
      ropes.add(tube);
    }
    // The rope being laid shows where each tap landed.
    if (index === -1) {
      for (const point of points) {
        const dot = new Mesh(sphere, marker);
        dot.position.copy(point);
        dot.scale.setScalar(radius * 1.8);
        ropes.add(dot);
      }
    }
  }

  /**
   * Shows a pose (and the rope being laid, and the part being posed).
   * @param {Pose} pose
   * @param {{ laying?: Rope | null, selected?: string | null }} [extras]
   */
  function show(pose, { laying = null, selected = null } = {}) {
    shown = pose;
    posed(skeleton, pose);
    for (const mesh of parts) mesh.material = mesh.userData.bone === selected ? selectedSkin : skin;

    ring.visible = !!pose.ring;
    if (pose.ring) {
      const [x, y, z] = pose.ring;
      hoop.position.set(x, y, z);
      // The line it hangs from, up out of sight.
      const top = 900;
      hanger.position.set(x, (y + RING_RADIUS + top) / 2, z);
      hanger.scale.set(1, Math.max(1, top - y - RING_RADIUS), 1);
    }

    clearRopes();
    pose.ropes.forEach((rope, i) => addRope(rope, pose, i));
    if (laying) addRope(laying, pose, -1);

    // The camera circles a point above the floor, looking at it.
    const [yaw, pitch, distance, height] = pose.camera;
    const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
    camera.position.set(Math.sin(y) * Math.cos(p) * distance, height + Math.sin(p) * distance, Math.cos(y) * Math.cos(p) * distance);
    camera.lookAt(0, height, 0);
  }

  /** Draws the pose shown. */
  function draw() {
    renderer.render(scene, camera);
  }

  /**
   * Sizes the view (CSS pixels), keeping its picture in proportion.
   * @param {number} width
   * @param {number} height
   */
  function setSize(width, height) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (shown) draw();
  }

  const raycaster = new Raycaster();

  /**
   * What's under a point on the canvas (in CSS pixels from its corner).
   * @param {number} x
   * @param {number} y
   * @param {{ ropes?: boolean }} [options] ropes: also look for ropes (to
   *   delete one); otherwise ropes are looked through
   * @returns {Hit | null}
   */
  function pick(x, y, { ropes: withRopes = false } = {}) {
    const box = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new Vector2((x / box.width) * 2 - 1, -(y / box.height) * 2 + 1), camera);
    /** @type {Object3D[]} */
    const targets = [...parts];
    if (ring.visible) targets.push(hoop);
    if (withRopes) targets.push(...ropes.children.filter((c) => c.userData.rope !== undefined && c.userData.rope >= 0));
    const [hit] = raycaster.intersectObjects(targets, false);
    if (!hit) return null;
    if (hit.object.userData.ring) return { kind: "ring" };
    if (hit.object.userData.rope !== undefined) return { kind: "rope", index: hit.object.userData.rope };
    // Just off the surface, so the rope lies on the body, not in it.
    const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new Vector3();
    const onSurface = hit.point.clone().addScaledVector(normal, 0.6);
    const bone = /** @type {string} */ (hit.object.userData.bone);
    return { kind: "body", bone, mm: toBone(skeleton, bone, onSurface) };
  }

  /** Frees the view (its 3D context and everything drawn with it). */
  function dispose() {
    clearRopes();
    scene.traverse((o) => {
      if (o instanceof Mesh && o.geometry !== sphere) o.geometry.dispose();
    });
    sphere.dispose();
    for (const m of [skin, selectedSkin, ringMaterial, marker, ...inks.values(), floor.material]) m.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }

  return { canvas, show, draw, setSize, pick, dispose };
}

/** @typedef {ReturnType<typeof poseView>} PoseView */

/** The hidden view pictures are made with, made when first needed. @type {PoseView | null} */
let painter = null;

/**
 * A picture of a pose, from its own view.
 * @param {Pose} pose
 * @param {{ width: number, height: number, type?: string, quality?: number }} size
 * @returns {Promise<Blob>}
 */
export function poseImage(pose, { width, height, type = "image/png", quality }) {
  // Exactly width × height, whatever the screen.
  painter ??= poseView({ keepPicture: true, pixelRatio: 1 });
  const view = painter;
  view.setSize(width, height);
  view.show(pose);
  view.draw();
  return new Promise((resolve, reject) => {
    view.canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't make a picture of the pose."))), type, quality);
  });
}

/** Frees the hidden picture view (when the forms using it close). */
export function releasePainter() {
  painter?.dispose();
  painter = null;
}
