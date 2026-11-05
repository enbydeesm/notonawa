// The poser's help text (pure: no DOM), so it can be tested on its own:
// the short line over the 3D view, which changes with the tab and the
// pencil, and the help under the Rope tab's tools, which follows what's
// being laid or chosen.

/** @typedef {"pose" | "rope" | "scene"} Tab */

/**
 * The line at the bottom left of the 3D view.
 * @param {{ tab: Tab, drawing: boolean, laying: boolean, chosen: boolean }} state
 *   drawing: the pencil's on; laying: a rope, cinch or added rope is being laid;
 *   chosen: a rope's chosen (the Rope tab)
 * @returns {string}
 */
export function viewHint({ tab, drawing, laying, chosen }) {
  if (drawing) return "Draw with a finger";
  if (tab === "pose") return "Drag head for height · tap for whole body";
  if (tab === "rope" && laying) return "Keep tapping to add points";
  if (tab === "rope" && chosen) return "Tap anywhere else to let it go";
  return "Drag to turn · 2 fingers to pan · pinch to zoom";
}

/**
 * The Rope tab's help, under its tools or the chosen rope's settings.
 * @param {{
 *   erasing: boolean,
 *   layingKind: "rope" | "cinch" | "added",
 *   points: number,
 *   chosen: "none" | "rope" | "cinch",
 *   sliding: boolean,
 *   hardpoint: "ring" | "bamboo" | "hashira" | null,
 * }} state points: how many points the rope being laid has (0 when nothing is)
 * @returns {string}
 */
export function ropeHint({ erasing, layingKind, points, chosen, sliding, hardpoint }) {
  const count = `${points} ${points === 1 ? "point" : "points"}`;
  if (erasing) return "Tap a rope to take it out.";
  if (layingKind === "cinch") return `Cinch: ${count}. Tap uplines, ropes or the body to tie it through, then Finish.`;
  if (layingKind === "added") return `Added rope: ${count}. Keep tapping, then Finish.`;
  if (points) return `Rope: ${count}. Keep tapping, then Finish.`;
  if (chosen === "cinch") return "Shorten the cinch to pull the upline aside. Tap Cinch again when you're done.";
  if (chosen === "rope" && sliding) return "Tap Slide again when it's in place.";
  if (chosen === "rope") return "Cinch and Add rope start from the dot.";
  if (hardpoint === "hashira") return "Tap the body to lay a rope. Tap the hashira to tie to it, or a rope to choose it.";
  if (hardpoint) return `Tap the body to lay a rope. Tap the ${hardpoint} for an upline, or a rope to choose it.`;
  // No hardpoint: the chip beside the thickness says + Hardpoint.
  return "Tap the body to lay a rope, point by point.";
}

/**
 * What to say once a hardpoint's taken away or swapped, when rope points
 * went with it (there's no question first: Undo brings them back).
 * @param {string} hardpoint the one taken away
 * @param {number} lost rope points that were on it
 * @returns {string} empty when none went
 */
export function hardpointLostNote(hardpoint, lost) {
  if (lost <= 0) return "";
  return `${lost} rope ${lost === 1 ? "point" : "points"} on the ${hardpoint} went with it. Undo brings ${lost === 1 ? "it" : "them"} back.`;
}
