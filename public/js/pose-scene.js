// The poser's 3D view: the figure (figure-body.js: a realistic body, its
// skin moved by its skeleton, pose-skeleton.js), a floor, the hardpoint (a ring, bamboo or hashira) and the ropes, drawn by three.js (vendor/three.js,
// bundled with only the parts used here). Loaded only when a pose is shown
// (poses-ui.js imports it), so the rest of the app doesn't fetch it.
//
// A view draws when asked (draw), not over and over, which spares a
// phone's battery. It also says what's under a point on it (pick): a body
// part, the hardpoint or a rope, and where on it, as the millimetres a
// rope point is kept in (pose-format.js).
//
// Pictures of poses (thumbnails, and the poser's "Add to visuals") come
// from one hidden view, reused (browsers allow only a few 3D views at once).
//
// The body's mesh (about 2 MB) is fetched as this module loads, so anything
// importing it waits for it; the browser keeps it a week (/figure/* in
// _headers).

import {
  BufferAttribute, BufferGeometry, CatmullRomCurve3, CircleGeometry, Color, CylinderGeometry, DirectionalLight, Group,
  HemisphereLight, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Raycaster,
  Scene, Skeleton, SkinnedMesh, SphereGeometry, TorusGeometry, TubeGeometry, Vector2, Vector3, WebGLRenderer,
} from "./vendor/three.js";
import { BONES, BODY_FILE, readBody, bodyPositions, sameShape } from "./figure-body.js";
import { bindInverses } from "./pose-skin-bind.js";
import { ROPE, ROPE_RADIUS, HASHIRA_SIZE, isCinch, onBody } from "./pose-format.js";
import { withDualQuatSkinning, toDualQuat, blendDualQuats, dqTransform } from "./pose-skinning.js";
import {
  makeSkeleton, posed, ropePoint, toBone, toHardpoint, vertexParts, useSkin, RING_RADIUS, BAMBOO_RADIUS,
} from "./pose-skeleton.js";
import { bends, ropeRuns, spotPoint } from "./pose-cinch.js";
import { skinOf, stretchOf } from "./pose-surface.js";
import { segmentDistance } from "./drawing-format.js";

/** @typedef {import("./pose-format.js").Pose} Pose */
/** @typedef {import("./vendor/three.js").Object3D} Object3D */
/** @typedef {import("./pose-format.js").Rope} Rope */
/** @typedef {import("./pose-format.js").RopePoint} RopePoint */
/**
 * What's under a point on the view (on the body, `point` is where in the room).
 * `bone` is the part a rope point there is on, `part` the part tapping there poses.
 * @typedef {{ kind: "body", bone: string, part: string, mm: [number, number, number], point: Vector3 } | { kind: "ring" }
 *   | { kind: "bamboo", along: number } | { kind: "hashira", mm: [number, number, number] }
 *   | { kind: "rope", index: number, point: Vector3 }} Hit
 */

/**
 * How near a tap (CSS px) has to be to a rope to choose it: a finger's
 * width, as the ropes themselves are only a centimetre or two across.
 */
const ROPE_REACH = 18;
/** How far behind what's under a tap (cm) a rope can be and still be chosen (one lying on the body, not behind it). */
const ROPE_DEPTH = 3;
/** How near a chosen rope's dot a finger must be to hold it (CSS px). */
const HANDLE_REACH = 16;
/** The camera's field of view, up and down (degrees). */
const FOV = 38;
/** How solid a see-through rope is drawn: enough to see and tap, the ropes under it showing. */
const SEE_THROUGH = 0.35;
/** The furthest from a part's middle line its skin is looked for (cm). */
const SKIN_FAR = 60;

/** How long the lines a ring or bamboo hangs from are (up out of sight), cm. */
const HANG_LENGTH = 900;
/** The hanging lines' look, as a jute rope: three strands twisted round, one turn every PITCH cm. */
const STRAND = { count: 3, radius: 0.3, out: 0.32, pitch: 3.5, steps: 6 };

/**
 * The strands of a hanging line, from 0 up to HANG_LENGTH: three thin
 * tubes, twisted round each other.
 * @returns {TubeGeometry[]}
 */
function strands() {
  const { count, radius, out, pitch, steps } = STRAND;
  const points = Math.round(HANG_LENGTH / pitch * steps);
  return Array.from({ length: count }, (_, k) => {
    const curve = new CatmullRomCurve3(Array.from({ length: points + 1 }, (_, i) => {
      const y = i * HANG_LENGTH / points;
      const a = 2 * Math.PI * (y / pitch + k / count);
      return new Vector3(Math.cos(a) * out, y, Math.sin(a) * out);
    }));
    return new TubeGeometry(curve, points, radius, 5, false);
  });
}

/**
 * The view's colors, from app.css.
 * @param {string} name e.g. "pose-figure", "ink-red"
 */
const cssColor = (name) => new Color(getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim() || "#888");

/** The body's mesh. */
const body = readBody(await (await fetch(BODY_FILE)).arrayBuffer());
/** Which part of the body (figure-rig.js) each vertex is on, for a rope point tapped there, and for posing. */
const parts = vertexParts(body);
// Rope on the body follows this skin as it bends (pose-skin-bind.js).
useSkin(body);
const posedParts = vertexParts(body, { posing: true });

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
  const camera = new PerspectiveCamera(FOV, 1, 5, 5000);

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

  const sphere = new SphereGeometry(1, 28, 18);
  const skinColor = cssColor("pose-figure");
  const selectedColor = cssColor("pose-selected");
  const clashColor = cssColor("pose-clash");
  // A clash with collisions allowed: a warning, not refused.
  const warnColor = cssColor("pose-warn");

  // The pelvis is the figure's root, moved and turned as the whole body.
  const skeleton = makeSkeleton(new Group());
  scene.add(skeleton.pelvis);
  // The skin: the body's mesh, each vertex moved by up to four bones. Its
  // bones are at rest lined up with the world, at their joints standing
  // arms down; the skin is bound in Anny's pose, arms out (set with the
  // shape, fitSkin).
  const geometry = new BufferGeometry();
  const place = new BufferAttribute(new Float32Array(body.base.length), 3);
  const tint = new BufferAttribute(new Float32Array(body.base.length), 3);
  geometry.setAttribute("position", place);
  geometry.setAttribute("color", tint);
  geometry.setAttribute("skinIndex", new BufferAttribute(body.joints, 4));
  geometry.setAttribute("skinWeight", new BufferAttribute(body.weights, 4, true));
  geometry.setIndex(new BufferAttribute(body.faces, 1));
  const skinMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  // Dual-quaternion skinning (pose-skinning.js), so bent elbows and knees
  // round off rather than fold to a point.
  skinMaterial.onBeforeCompile = (shader) => { shader.vertexShader = withDualQuatSkinning(shader.vertexShader); };
  skinMaterial.customProgramCacheKey = () => "dual-quat-skin";
  const figure = new SkinnedMesh(geometry, skinMaterial);
  // Its bounds move with the pose: always drawn, and worked out afresh before a tap.
  figure.frustumCulled = false;
  const inverses = BONES.map(() => new Matrix4());
  const bones = /** @type {import("./vendor/three.js").Bone[]} */ (BONES.map((name) => skeleton.all.get(name)));
  figure.bindMode = "detached";
  figure.bind(new Skeleton(bones, inverses), new Matrix4());
  // Taps find the skin where it's drawn: the same skinning on the CPU.
  const boneMatrix = new Matrix4();
  figure.applyBoneTransform = (index, target) => {
    /** @type {import("./pose-skinning.js").DualQuat[]} */
    const motions = [];
    /** @type {number[]} */
    const weights = [];
    for (let k = 0; k < 4; k++) {
      const w = body.weights[index * 4 + k] / 255;
      if (!w) continue;
      const b = body.joints[index * 4 + k];
      motions.push(toDualQuat(boneMatrix.multiplyMatrices(bones[b].matrixWorld, inverses[b]).elements));
      weights.push(w);
    }
    const [x, y, z] = dqTransform(blendDualQuats(motions, weights), [target.x, target.y, target.z]);
    return target.set(x, y, z);
  };
  scene.add(figure);
  /** The shape the skin was last made in. @type {import("./figure-body.js").Shape | null} */
  let skinShape = null;
  /** The parts shown selected and clashing, as last painted. @type {string | undefined} */
  let painted;

  /** Makes the skin in the skeleton's shape (after posed() has reshaped it). */
  function fitSkin() {
    if (skinShape && sameShape(skinShape, skeleton.shape)) return;
    skinShape = [...skeleton.shape];
    bodyPositions(body, skinShape, /** @type {Float32Array} */ (place.array));
    place.needsUpdate = true;
    geometry.computeVertexNormals();
    // Each bone's skin is moved from where it's bound (Anny's pose) to its
    // joint standing arms down (the same the ropes follow, pose-skin-bind.js).
    bindInverses(skinShape).forEach((m, i) => { inverses[i].elements = m.elements; });
  }

  /**
   * Colors the part being posed, and parts a move is pushing into each
   * other (pose-contact.js).
   * @param {string | null} part
   * @param {Set<string> | null} clash
   * @param {boolean} warn collisions are allowed: the clash shows orange, not red
   */
  function paint(part, clash, warn) {
    const key = `${part}|${clash ? [...clash].sort().join() : ""}|${warn}`;
    if (key === painted) return;
    painted = key;
    const colors = /** @type {Float32Array} */ (tint.array);
    const chosen = part === null ? -1 : posedParts.names.indexOf(part);
    const clashing = new Set([...(clash ?? [])].map((p) => parts.names.indexOf(p)));
    for (let v = 0; v < parts.of.length; v++) {
      const c = clashing.has(parts.of[v]) ? (warn ? warnColor : clashColor) : posedParts.of[v] === chosen ? selectedColor : skinColor;
      colors[v * 3] = c.r;
      colors[v * 3 + 1] = c.g;
      colors[v * 3 + 2] = c.b;
    }
    tint.needsUpdate = true;
  }

  // --- the hardpoints: a ring, a bamboo or a hashira --------------------------

  const ringMaterial = new MeshStandardMaterial({ color: cssColor("pose-ring"), metalness: 0.6, roughness: 0.35 });
  const juteMaterial = new MeshStandardMaterial({ color: cssColor("pose-jute"), roughness: 0.95 });
  const line = strands();
  /** A jute line hanging from out of sight: moved by its foot (hang). */
  const hanger = () => {
    const group = new Group();
    group.add(...line.map((g) => new Mesh(g, juteMaterial)));
    return group;
  };
  /**
   * A line hanging something from out of sight, down to (x, y, z).
   * @param {Group} rope @param {number} x @param {number} y @param {number} z
   */
  const hang = (rope, x, y, z) => rope.position.set(x, y, z);

  const ring = new Group();
  const hoop = new Mesh(new TorusGeometry(RING_RADIUS, 0.9, 12, 40), ringMaterial);
  hoop.userData.hardpoint = "ring";
  const ringHanger = hanger();
  ring.add(hoop);
  scene.add(ringHanger);

  // A pole lying along its x (1 cm long, stretched to the bamboo's
  // length), hung from two lines in from its ends.
  const bambooMaterial = new MeshStandardMaterial({ color: cssColor("pose-bamboo"), roughness: 0.6 });
  const bamboo = new Group();
  const pole = new Mesh(new CylinderGeometry(BAMBOO_RADIUS, BAMBOO_RADIUS, 1, 16), bambooMaterial);
  pole.rotation.set(0, 0, Math.PI / 2);
  pole.userData.hardpoint = "bamboo";
  const bambooHangers = [hanger(), hanger()];
  bamboo.add(pole);
  scene.add(...bambooHangers);

  // A square post from the floor up: a four-sided cylinder, turned so its
  // faces line up with x and z, with flat faces.
  const woodMaterial = new MeshStandardMaterial({ color: cssColor("pose-wood"), roughness: 0.85, flatShading: true });
  const post = new Mesh(new CylinderGeometry(HASHIRA_SIZE.width / Math.SQRT2, HASHIRA_SIZE.width / Math.SQRT2, HASHIRA_SIZE.height, 4), woodMaterial);
  post.userData.hardpoint = "hashira";
  const hashira = new Group();
  post.position.set(0, HASHIRA_SIZE.height / 2, 0);
  post.rotation.set(0, Math.PI / 4, 0);
  hashira.add(post);
  scene.add(ring, bamboo, hashira);

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
  // The rope chosen (to change a cinch or a see-saw) shows in the
  // selected part's color.
  const chosenInk = new MeshStandardMaterial({ color: cssColor("pose-selected"), roughness: 0.6 });
  // A see-through rope (`t`): its own ink (or the chosen one's), faint, the ropes under it showing.
  /** @type {Map<string, MeshStandardMaterial>} */
  const clearInks = new Map();
  /** @param {string} name the CSS color's */
  const clearInk = (name) => {
    let material = clearInks.get(name);
    if (!material) {
      clearInks.set(name, material = new MeshStandardMaterial({
        color: cssColor(name), roughness: 0.8, transparent: true, opacity: SEE_THROUGH, depthWrite: false,
      }));
    }
    return material;
  };
  // The chosen rope's points, to drag or choose: white (the spot where a
  // cinch or an added rope would start is a × over the view, pose-beside-ui.js).
  const handleInk = new MeshStandardMaterial({ color: cssColor("pose-handle"), roughness: 0.5 });

  /** The pose drawn last, so the view can be drawn again at a new size. @type {Pose | null} */
  let shown = null;
  /** Each rope's line in the room, as many points along it, for choosing one with a tap (`clear`: see-through). @type {{ index: number, points: Vector3[], clear: boolean }[]} */
  let ropeLines = [];
  /** The chosen rope's points on the body, where their dots are. @type {{ k: number, point: Vector3 }[]} */
  let handles = [];
  /** Where the spot chosen on a rope is, in the room, while one is. @type {Vector3 | null} */
  let spotAt = null;

  /** Takes the old ropes off, freeing what they held. */
  function clearRopes() {
    ropeLines = [];
    for (const child of [...ropes.children]) {
      ropes.remove(child);
      if (child instanceof Mesh && child.geometry !== sphere) child.geometry.dispose();
    }
  }

  /**
   * @param {Rope} rope
   * @param {Vector3[][]} runs its line in the room, in runs (pose-cinch.js)
   * @param {number} index its place in pose.ropes, or -1 for the one being laid
   * @param {boolean} chosen
   */
  function addRope(rope, runs, index, chosen, dots = [], dotInk = marker, picked = -1) {
    const radius = ROPE_RADIUS[rope.w];
    const material = rope.t ? clearInk(chosen ? "pose-selected" : `ink-${rope.c}`) : chosen ? chosenInk : ink(rope.c);
    for (const [i, points] of runs.entries()) {
      if (points.length < 2) continue;
      const curve = new CatmullRomCurve3(points, false, "centripetal");
      const steps = Math.max(12, points.length * 12);
      const tube = new Mesh(new TubeGeometry(curve, steps, radius, 8, false), material);
      tube.userData.rope = index;
      ropes.add(tube);
      if (index >= 0) ropeLines.push({ index, points: Array.from({ length: steps + 1 }, (_, k) => curve.getPoint(k / steps)), clear: !!rope.t });
      // A knot where one run meets the next, so the turn has no gap.
      if (i > 0) {
        const knot = new Mesh(sphere, material);
        knot.position.copy(points[0]);
        knot.scale.setScalar(radius);
        ropes.add(knot);
      }
    }
    // The rope being laid shows where each tap landed; the rope chosen,
    // its points on the body, to drag or take out.
    // The point chosen (its dot tapped) is bigger.
    for (const [k, point] of dots.entries()) {
      const dot = new Mesh(sphere, dotInk);
      dot.position.copy(point);
      dot.scale.setScalar(radius * (k === picked ? 2.8 : dotInk === marker ? 1.8 : 2.1));
      ropes.add(dot);
    }
  }

  /**
   * Shows a pose (and the rope being laid, the part being posed, the rope
   * chosen, and the parts a move is pushing into each other: orange with
   * `warn`, as collisions are allowed, or red). The spot chosen on a rope
   * (where a cinch or an added rope goes) is only placed (`spotScreen`):
   * the poser marks it with a × over the view.
   * @param {Pose} pose
   * @param {{ laying?: Rope | null, selected?: string | null, rope?: number, clash?: Set<string> | null, warn?: boolean,
   *   spot?: RopePoint | null, point?: number }} [extras] point: the chosen rope's point chosen (its place in the rope)
   */
  function show(pose, { laying = null, selected = null, rope = -1, clash = null, warn = false, spot = null, point = -1 } = {}) {
    shown = pose;
    posed(skeleton, pose);
    fitSkin();
    paint(selected, clash, warn);

    ring.visible = !!pose.ring;
    if (pose.ring) {
      const [x, y, z] = pose.ring;
      hoop.position.set(x, y, z);
      hang(ringHanger, x, y + RING_RADIUS, z);
    }
    ringHanger.visible = ring.visible;
    bamboo.visible = !!pose.bamboo;
    for (const hanging of bambooHangers) hanging.visible = bamboo.visible;
    if (pose.bamboo) {
      const [x, y, z, turn, length, inset] = pose.bamboo;
      bamboo.position.set(x, y, z);
      bamboo.rotation.set(0, turn * Math.PI / 180, 0);
      pole.scale.set(1, length, 1);
      const t = turn * Math.PI / 180, half = length / 2 - inset;
      for (const [i, hanging] of bambooHangers.entries()) {
        const s = i ? 1 : -1;
        hang(hanging, x + s * half * Math.cos(t), y + BAMBOO_RADIUS, z - s * half * Math.sin(t));
      }
    }
    hashira.visible = !!pose.hashira;
    if (pose.hashira) {
      const [x, z, turn] = pose.hashira;
      hashira.position.set(x, 0, z);
      hashira.rotation.set(0, turn * Math.PI / 180, 0);
    }

    clearRopes();
    const bent = bends(skeleton, pose);
    // The body's capsules, once for every rope lying on it (pose-surface.js).
    const skin = skinOf(skeleton);
    // A spot on a rope (a cinch's, or where an added rope starts) is where that rope's drawn.
    const placed = (/** @type {RopePoint} */ p) => (p[0] === ROPE && pose.ropes[p[1]] ? spotPoint(skeleton, pose, p, bent) : ropePoint(skeleton, p, pose));
    handles = [];
    pose.ropes.forEach((r, i) => {
      if (i === rope) handles = r.p.flatMap((p, k) => (onBody(r, k) ? [{ k, point: placed(p) }] : []));
      addRope(r, ropeRuns(skeleton, pose, i, bent, skin), i, i === rope, i === rope ? handles.map((h) => h.point) : [], handleInk,
        i === rope ? handles.findIndex((h) => h.k === point) : -1);
    });
    // The rope being laid, drawn as it will be once finished.
    if (laying?.p.length) {
      const all = { ...pose, ropes: [...pose.ropes, laying] };
      const runs = laying.p.length > 1 && !isCinch(laying) ? ropeRuns(skeleton, all, pose.ropes.length, bent, skin) : [laying.p.map(placed)];
      addRope(laying, runs, -1, false, laying.p.map(placed));
    }
    spotAt = spot && pose.ropes[spot[1]] ? placed(spot) : null;

    // The camera circles a point above the floor, looking at it.
    const [yaw, pitch, distance, height, tx, tz] = pose.camera;
    const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
    camera.position.set(tx + Math.sin(y) * Math.cos(p) * distance, height + Math.sin(p) * distance, tz + Math.cos(y) * Math.cos(p) * distance);
    camera.lookAt(tx, height, tz);
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

  /** Points the raycaster from the camera through a point on the canvas (CSS px). @param {number} x @param {number} y */
  function aim(x, y) {
    const box = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new Vector2((x / box.width) * 2 - 1, -(y / box.height) * 2 + 1), camera);
  }

  /**
   * The line from the camera through a point on the canvas (CSS px), in
   * the room: where dragging a limb (pose-ik.js) finds the finger.
   * @param {number} x
   * @param {number} y
   */
  function ray(x, y) {
    aim(x, y);
    return { origin: raycaster.ray.origin.clone(), direction: raycaster.ray.direction.clone() };
  }

  /**
   * The rope nearest a point on the canvas (CSS px), within a finger's
   * reach on the screen and not hidden behind what's under the point.
   * @param {number} x
   * @param {number} y
   * @param {number} behind how far from the camera what's under the point is (cm), Infinity for nothing
   * @returns {{ kind: "rope", index: number, point: Vector3 } | null}
   */
  function nearestRope(x, y, behind) {
    const box = canvas.getBoundingClientRect();
    /** @param {Vector3} v @returns {[number, number] | null} on the screen, or null if behind the camera */
    const onScreen = (v) => {
      const p = v.clone().project(camera);
      return p.z > 1 ? null : [(p.x + 1) / 2 * box.width, (1 - p.y) / 2 * box.height];
    };
    /** The nearest of these lines within reach. @param {typeof ropeLines} lines */
    const nearest = (lines) => {
      /** @type {{ kind: "rope", index: number, point: Vector3, away: number } | null} */
      let best = null;
      for (const { index, points } of lines) {
        const screen = points.map(onScreen);
        for (let k = 0; k + 1 < points.length; k++) {
          const [a, b] = [screen[k], screen[k + 1]];
          if (!a || !b) continue;
          const away = segmentDistance(x, y, a[0], a[1], b[0], b[1]);
          if (away > ROPE_REACH || (best && away >= best.away)) continue;
          const length = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
          const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / length));
          const point = points[k].clone().lerp(points[k + 1], t);
          if (point.distanceTo(camera.position) > behind + ROPE_DEPTH) continue;
          best = { kind: "rope", index, point, away };
        }
      }
      return best;
    };
    // A solid rope within reach is taken before a see-through one, over it
    // or not, so the ropes under a see-through one can still be chosen; a
    // see-through one is chosen where there's no solid one.
    const best = nearest(ropeLines.filter((l) => !l.clear)) ?? nearest(ropeLines.filter((l) => l.clear));
    return best && { kind: "rope", index: best.index, point: best.point };
  }

  /**
   * The chosen rope's point whose dot is under a point on the canvas (CSS
   * px), within a finger's reach and not behind the body.
   * @param {number} x @param {number} y
   * @returns {number} the point's place in the rope, or -1
   */
  function handleAt(x, y) {
    if (!handles.length) return -1;
    const box = canvas.getBoundingClientRect();
    aim(x, y);
    figure.computeBoundingSphere();
    const [hit] = raycaster.intersectObjects([figure], false);
    let best = -1, nearest = HANDLE_REACH;
    for (const { k, point } of handles) {
      const p = point.clone().project(camera);
      if (p.z > 1) continue;
      const away = Math.hypot((p.x + 1) / 2 * box.width - x, (1 - p.y) / 2 * box.height - y);
      if (away >= nearest || (hit && point.distanceTo(camera.position) > hit.distance + ROPE_DEPTH)) continue;
      [best, nearest] = [k, away];
    }
    return best;
  }

  /**
   * How far out the skin of a part is from a point on its middle line, a
   * given way: for laying a wrap on the skin itself (pose-surface.js).
   * The skin is worked out once, as it's drawn (the same skinning, on the
   * CPU), and only the part's own: the whole trunk's for a part of it, so
   * a wrap goes under an arm hanging beside it, not round it.
   * @param {string} part the part being wrapped
   * @returns {(from: Vector3, outward: Vector3) => number | null} cm to the
   *   outermost skin that way, or null if there's none
   */
  function skinMeasure(part) {
    const trunk = stretchOf(part) === "trunk";
    const mine = parts.names.map((name) => (trunk ? stretchOf(name) === "trunk" : name === part));
    const at = /** @type {Float32Array} */ (place.array);
    /** Each of the part's vertices where it's drawn. @type {Map<number, Vector3>} */
    const drawn = new Map();
    const where = (/** @type {number} */ i) => {
      let v = drawn.get(i);
      if (!v) {
        v = figure.applyBoneTransform(i, new Vector3(at[i * 3], at[i * 3 + 1], at[i * 3 + 2]));
        drawn.set(i, v);
      }
      return v;
    };
    /** @type {[Vector3, Vector3, Vector3][]} */
    const faces = [];
    for (let f = 0; f < body.faces.length; f += 3) {
      const [a, b, c] = [body.faces[f], body.faces[f + 1], body.faces[f + 2]];
      if (mine[parts.of[a]] && mine[parts.of[b]] && mine[parts.of[c]]) faces.push([where(a), where(b), where(c)]);
    }
    return (from, outward) => {
      // Every triangle the line out meets (either side of it): the furthest
      // is the skin a rope lies on. (Möller and Trumbore's test, in plain
      // numbers: there are thousands of triangles.)
      const [ox, oy, oz, dx, dy, dz] = [from.x, from.y, from.z, outward.x, outward.y, outward.z];
      let far = 0;
      for (const [a, b, c] of faces) {
        const [e1x, e1y, e1z, e2x, e2y, e2z] = [b.x - a.x, b.y - a.y, b.z - a.z, c.x - a.x, c.y - a.y, c.z - a.z];
        const [hx, hy, hz] = [dy * e2z - dz * e2y, dz * e2x - dx * e2z, dx * e2y - dy * e2x];
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(det) < 1e-9) continue;
        const [sx, sy, sz] = [ox - a.x, oy - a.y, oz - a.z];
        const u = (sx * hx + sy * hy + sz * hz) / det;
        if (u < 0 || u > 1) continue;
        const [qx, qy, qz] = [sy * e1z - sz * e1y, sz * e1x - sx * e1z, sx * e1y - sy * e1x];
        const v = (dx * qx + dy * qy + dz * qz) / det;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) / det;
        if (t > far && t < SKIN_FAR) far = t;
      }
      return far > 0 ? far : null;
    };
  }

  /**
   * What's under a point on the canvas (in CSS pixels from its corner).
   * @param {number} x
   * @param {number} y
   * @param {{ ropes?: boolean }} [options] ropes: a rope within a finger's
   *   reach comes first (to choose or erase one); otherwise ropes are looked through
   * @returns {Hit | null}
   */
  function pick(x, y, { ropes: withRopes = false } = {}) {
    aim(x, y);
    // Where the skin is now, for the ray to find it.
    figure.computeBoundingSphere();
    /** @type {Object3D[]} */
    const targets = [figure];
    if (ring.visible) targets.push(hoop);
    if (bamboo.visible) targets.push(pole);
    if (hashira.visible) targets.push(post);
    const [hit] = raycaster.intersectObjects(targets, false);
    if (withRopes) {
      const rope = nearestRope(x, y, hit ? hit.distance : Infinity);
      if (rope) return rope;
    }
    if (!hit || !shown) return null;
    // Just off the surface, toward the camera, so the rope lies on it, not in it.
    const onSurface = hit.point.clone().addScaledVector(raycaster.ray.direction, -0.6);
    const hardpoint = hit.object.userData.hardpoint;
    if (hardpoint === "ring") return { kind: "ring" };
    if (hardpoint === "bamboo") return { kind: "bamboo", along: Math.round(toHardpoint(shown, "bamboo", hit.point)[0] * 10) };
    if (hardpoint === "hashira") {
      const [x, y, z] = toHardpoint(shown, "hashira", onSurface);
      return { kind: "hashira", mm: [Math.round(x * 10), Math.round(y * 10), Math.round(z * 10)] };
    }
    const vertex = hit.face ? hit.face.a : 0;
    const bone = parts.names[parts.of[vertex]];
    const part = posedParts.names[posedParts.of[vertex]];
    return { kind: "body", bone, part, mm: toBone(skeleton, bone, onSurface), point: onSurface };
  }

  /** Frees the view (its 3D context and everything drawn with it). */
  function dispose() {
    clearRopes();
    scene.traverse((o) => {
      if (o instanceof Mesh && o.geometry !== sphere && !line.includes(o.geometry)) o.geometry.dispose();
    });
    for (const g of [sphere, ...line]) g.dispose();
    figure.skeleton.dispose();
    for (const m of [skinMaterial, ringMaterial, juteMaterial, bambooMaterial, woodMaterial, marker, chosenInk, ...inks.values(), ...clearInks.values(), floor.material]) {
      m.dispose();
    }
    renderer.dispose();
    renderer.forceContextLoss();
  }

  /**
   * Where a point in the room is on the canvas (CSS px), or null when it's behind the camera.
   * @param {Vector3} v
   * @returns {[number, number] | null}
   */
  function screenAt(v) {
    const box = canvas.getBoundingClientRect();
    const p = v.clone().project(camera);
    return p.z > 1 ? null : [(p.x + 1) / 2 * box.width, (1 - p.y) / 2 * box.height];
  }

  /**
   * How many CSS px a length (cm) across the view looks at a place in the room.
   * @param {Vector3} v @param {number} cm
   */
  function pxAcross(v, cm) {
    const far = Math.max(1, v.distanceTo(camera.position));
    return cm * canvas.getBoundingClientRect().height / (2 * Math.tan(FOV * Math.PI / 360) * far);
  }

  /** The spot chosen on a rope, on the canvas (CSS px), and how wide a medium rope looks there; or null. */
  function spotScreen() {
    const at = spotAt && screenAt(spotAt);
    return at && spotAt ? { x: at[0], y: at[1], size: pxAcross(spotAt, 2 * ROPE_RADIUS[2]) } : null;
  }

  /** The chosen rope's dots on the canvas (CSS px), each with its point's place in the rope. */
  const handleSpots = () => handles.flatMap(({ k, point }) => {
    const at = screenAt(point);
    return at ? [{ k, x: at[0], y: at[1] }] : [];
  });

  return { canvas, show, draw, setSize, pick, handleAt, skinMeasure, ray, screenAt, pxAcross, spotScreen, handleSpots, dispose };
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
