// The poser opened on its own, from the nav's button: there's no tie, plan
// or workshop yet, so Save pose and Add to visuals ask where to put it
// ("Add pose to…", add-to-picker.js). On one already there, it's saved at
// once and the poser stays open, to carry on or add more. A new one's form
// opens with the pose waiting in its Visuals until it's saved
// (new-entry-start.js): ties and workshops over the poser, plans on the
// Plans view (their form lives there), which closes the poser.

import { navigate } from "./navigate.js";
import { openTieForm } from "./tie-form.js";
import { openWorkshopForm } from "./workshop-form.js";
import { savePose } from "./poses-ui.js";
import { preparePhoto } from "./photo-prep.js";
import { uploadPhoto } from "./photo-upload.js";
import { handPlanOver } from "./new-entry-start.js";
import { chooseAddTarget, rememberTarget, forgetTarget } from "./add-to-picker.js";
import { itemOf, kindName } from "./add-to-choices.js";
import { TIE_SAVED, PLAN_SAVED, WORKSHOP_SAVED } from "./nav.js";

/** @typedef {import("./pose-format.js").Pose} Pose */
/** @typedef {import("./add-to-choices.js").Target} Target */
/** @typedef {import("./add-to-choices.js").TargetKind} TargetKind */
/** @typedef {{ pose: Pose } | { picture: Blob }} Placing */
/** @typedef {{ text: string, saved: boolean }} Placed */

/** The event each kind's view reloads on. */
const SAVED_EVENTS = /** @type {const} */ ({ tie: TIE_SAVED, plan: PLAN_SAVED, workshop: WORKSHOP_SAVED });

/** Opens the poser on its own. */
export async function openStandalonePoser() {
  const { editPose } = await import("./pose-editor.js");
  await editPose(null, { standalone: true, place });
}

/**
 * Save pose or Add to visuals, in the poser on its own: asks where, then
 * saves it there or opens a new one's form with it.
 * @param {Placing} placing
 * @param {() => void} [busy] called once one there already is chosen, while it's saved
 * @returns {Promise<Placed | null>} what to say in the poser (saved: the
 *   pose is kept somewhere now), or null if cancelled
 */
export async function place(placing, busy) {
  const isPose = "pose" in placing;
  const choice = await chooseAddTarget({ what: isPose ? "pose" : "picture" });
  if (!choice) return null;

  if ("target" in choice) {
    const target = choice.target;
    busy?.();
    try {
      await saveOn(target, placing);
    } catch (err) {
      // Most likely deleted since: not offered first again.
      forgetTarget(target);
      throw err;
    }
    rememberTarget(target);
    document.dispatchEvent(new CustomEvent(SAVED_EVENTS[target.kind]));
    const noun = isPose ? "Pose" : "Picture";
    return { text: `${noun} added to ${kindName(target.kind).toLowerCase()} “${target.title}”.`, saved: true };
  }

  const kind = choice.create;
  /** @type {string | null} */
  let newId = null;
  /** @type {import("./new-entry-start.js").EntryStart} */
  const start = {
    title: choice.title,
    ...(isPose ? { pose: placing.pose } : { picture: placing.picture }),
    onSaved: (id, title) => {
      newId = id;
      rememberTarget({ kind, id, title: title || `Untitled ${kind}`, meta: "", recent: new Date().toISOString() });
    },
  };
  if (kind === "plan") {
    // Its form is on the Plans view: going there closes the poser.
    handPlanOver(start);
    navigate("/plans");
    return null;
  }
  const opened = kind === "tie" ? openTieForm(null, { start }) : openWorkshopForm(null, { start });
  await opened;
  if (!newId) return { text: `The new ${kind} wasn't saved, so neither was the ${isPose ? "pose" : "picture"}.`, saved: false };
  document.dispatchEvent(new CustomEvent(SAVED_EVENTS[kind]));
  return { text: `Saved on the new ${kind}.`, saved: true };
}

/**
 * Saves the pose, or its picture as a photo, on a tie, plan or workshop.
 * @param {Target} target
 * @param {Placing} placing
 */
async function saveOn(target, placing) {
  const item = itemOf(target);
  if ("pose" in placing) {
    await savePose(item, { data: placing.pose, caption: null });
    return;
  }
  const prepared = await preparePhoto(new File([placing.picture], "Pose.png", { type: "image/png" }));
  await uploadPhoto({ item, prepared });
}
