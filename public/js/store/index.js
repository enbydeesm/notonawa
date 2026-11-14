// The store: every read and write of journal data goes through here, never
// api() directly (a lint rule checks). v1 is today's API (format 1); v2
// works over the sealed cache on the device (format 2, store/v2/), chosen
// by the account's format when each function is called (byFormat), so the
// pages don't change. Areas not yet built for v2 are v1's only.
//
// What its functions take and give is the pages' view of the journal:
// plain text in, opened rows out. Sealing, opening and searching notes for
// a keyword happen inside.

import * as v1Ties from "./v1/ties.js";
import * as v2Ties from "./v2/ties.js";
import * as v1Stats from "./v1/stats.js";
import * as v2Stats from "./v2/stats.js";
import * as v1Resources from "./v1/resources.js";
import * as v2Resources from "./v2/resources.js";
import { accountFormat } from "./v2/journal.js";

/**
 * A store function that's v1's or v2's by the account's format, read when
 * it's called (the format is known once the journal is unlocked).
 * @template {(...args: any[]) => any} F
 * @param {F} v1
 * @param {F} v2
 * @returns {F}
 */
function byFormat(v1, v2) {
  return /** @type {F} */ ((...args) => (accountFormat() === 2 ? v2 : v1)(...args));
}

export const findTies = byFormat(v1Ties.findTies, v2Ties.findTies);
export const getTie = byFormat(v1Ties.getTie, v2Ties.getTie);
export const saveTie = byFormat(v1Ties.saveTie, v2Ties.saveTie);
export const deleteTie = byFormat(v1Ties.deleteTie, v2Ties.deleteTie);
export const recentOnTies = byFormat(v1Ties.recentOnTies, v2Ties.recentOnTies);
export const statsTies = byFormat(v1Stats.statsTies, v2Stats.statsTies);
export const listItems = byFormat(v1Resources.listItems, v2Resources.listItems);
export const saveItem = byFormat(v1Resources.saveItem, v2Resources.saveItem);
export const archiveItem = byFormat(v1Resources.archiveItem, v2Resources.archiveItem);
export const restoreItem = byFormat(v1Resources.restoreItem, v2Resources.restoreItem);
export const deleteItem = byFormat(v1Resources.deleteItem, v2Resources.deleteItem);
export const deletePlan = byFormat(v1Resources.deletePlan, v2Resources.deletePlan);
export { mapLinkCoords } from "./maps.js";
import * as v1Workshops from "./v1/workshops.js";
import * as v2Workshops from "./v2/workshops.js";

export const listWorkshops = byFormat(v1Workshops.listWorkshops, v2Workshops.listWorkshops);
export const getWorkshop = byFormat(v1Workshops.getWorkshop, v2Workshops.getWorkshop);
export const saveWorkshop = byFormat(v1Workshops.saveWorkshop, v2Workshops.saveWorkshop);
export const deleteWorkshop = byFormat(v1Workshops.deleteWorkshop, v2Workshops.deleteWorkshop);
export const linkToWorkshop = byFormat(v1Workshops.linkToWorkshop, v2Workshops.linkToWorkshop);
export { uploadPhoto, uploadSealed, listMedia, setMediaCaption, deleteMedia } from "./v1/media.js";
export {
  listDrawings, addDrawing, updateDrawing, deleteDrawing, listPoses, addPose, updatePose, deletePose,
} from "./v1/drawings.js";
export { setVisualOrder } from "./v1/visuals.js";
export {
  listPosePresets, addPosePresets, renamePosePreset, setPosePresetData, deletePosePreset,
} from "./v1/presets.js";
import * as v1Tags from "./v1/tags.js";
import * as v2Tags from "./v2/tags.js";

export const listTags = byFormat(v1Tags.listTags, v2Tags.listTags);
export const deleteTag = byFormat(v1Tags.deleteTag, v2Tags.deleteTag);
export { getSettings, saveSettings } from "./v1/settings.js";
export { exportSealed, importItems, importTies, importWorkshops } from "./v1/data.js";
export {
  listConnections, acceptConnection, setConnectionPerson, markConnectionAnswered, deleteConnection,
} from "./v1/connections.js";
