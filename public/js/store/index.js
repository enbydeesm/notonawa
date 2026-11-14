// The store: every read and write of journal data goes through here, never
// api() directly (a unit test checks). Today it's v1, the API as it is; the
// encrypted version, v2, over a sealed cache on the device, comes in beside
// it later, chosen by the account's format, so the pages don't change.
//
// What its functions take and give is the pages' view of the journal:
// plain text in, opened rows out. Sealing, opening and searching notes for
// a keyword happen inside.

export { findTies, getTie, saveTie, deleteTie, recentOnTies } from "./v1/ties.js";
export {
  listItems, saveItem, archiveItem, restoreItem, deleteItem, deletePlan, mapLinkCoords,
} from "./v1/resources.js";
export { listWorkshops, getWorkshop, saveWorkshop, deleteWorkshop, linkToWorkshop } from "./v1/workshops.js";
export { uploadPhoto, uploadSealed, listMedia, setMediaCaption, deleteMedia } from "./v1/media.js";
export {
  listDrawings, addDrawing, updateDrawing, deleteDrawing, listPoses, addPose, updatePose, deletePose,
} from "./v1/drawings.js";
export { setVisualOrder } from "./v1/visuals.js";
export {
  listPosePresets, addPosePresets, renamePosePreset, setPosePresetData, deletePosePreset,
} from "./v1/presets.js";
