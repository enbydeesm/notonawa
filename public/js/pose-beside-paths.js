// The lines of the poser's ‹, › and × marks (pose-beside-ui.js draws them),
// sized to how wide a medium rope looks where they are, but never under
// MIN_MARK so they can still be seen. Pure, so it's tested on its own.

/** The smallest a ‹, › or × is drawn (CSS px), however far off the view is. */
export const MIN_MARK = 7;

/**
 * The lines of a ‹ (side -1) or › (1) and its underline, centred on 0, 0,
 * at most `size` tall and wide, and how thick to draw them.
 * @param {-1 | 1} side @param {number} size
 * @returns {{ paths: string[], width: number }}
 */
export function besidePaths(side, size) {
  const s = Math.max(MIN_MARK, size), width = Math.max(1, s * 0.14);
  // Inside the stroke's half-width, so the whole mark is within s.
  // The arrow over the top 70%, its point halfway down it; the underline at the foot.
  const half = (s - width) / 2, top = -half, bottom = half * 0.4, tip = (top + bottom) / 2;
  const x = -side * (bottom - top) / 4;
  const n = (/** @type {number} */ v) => Number(v.toFixed(2));
  return {
    paths: [`M${n(x)} ${n(top)} ${n(-x)} ${n(tip)} ${n(x)} ${n(bottom)}`, `M${n(-half * 0.6)} ${n(half)}H${n(half * 0.6)}`],
    width: n(width),
  };
}

/**
 * The lines of the × at the spot, centred on 0, 0, at most `size` across.
 * @param {number} size
 * @returns {{ paths: string[], width: number }}
 */
export function crossPaths(size) {
  const s = Math.max(MIN_MARK, size), width = Math.max(1, s * 0.18), a = (s - width) / 2;
  const n = (/** @type {number} */ v) => Number(v.toFixed(2));
  return { paths: [`M${n(-a)} ${n(-a)} ${n(a)} ${n(a)}`, `M${n(a)} ${n(-a)} ${n(-a)} ${n(a)}`], width: n(width) };
}
