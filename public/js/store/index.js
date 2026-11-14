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
import * as v1Media from "./v1/media.js";
import * as v1Drawings from "./v1/drawings.js";
import * as v1Visuals from "./v1/visuals.js";
import * as v1Presets from "./v1/presets.js";
import * as v2Visuals from "./v2/visuals.js";
import * as v2Presets from "./v2/presets.js";

export const uploadPhoto = byFormat(v1Media.uploadPhoto, v2Visuals.uploadPhoto);
export const uploadSealed = byFormat(v1Media.uploadSealed, v2Visuals.uploadSealed);
export const listMedia = byFormat(v1Media.listMedia, v2Visuals.listMedia);
export const setMediaCaption = byFormat(v1Media.setMediaCaption, v2Visuals.setMediaCaption);
export const deleteMedia = byFormat(v1Media.deleteMedia, v2Visuals.deleteMedia);
export const openMediaPart = byFormat(v1Media.openMediaPart, v2Visuals.openMediaPart);
export const copyMediaTo = byFormat(v1Media.copyMediaTo, v2Visuals.copyMediaTo);
export const shareFileObject = byFormat(v1Media.shareFileObject, v2Visuals.shareFileObject);
export const adoptSharedMedia = byFormat(v1Media.adoptSharedMedia, v2Visuals.adoptSharedMedia);
export const listDrawings = byFormat(v1Drawings.listDrawings, v2Visuals.listDrawings);
export const addDrawing = byFormat(v1Drawings.addDrawing, v2Visuals.addDrawing);
export const updateDrawing = byFormat(v1Drawings.updateDrawing, v2Visuals.updateDrawing);
export const deleteDrawing = byFormat(v1Drawings.deleteDrawing, v2Visuals.deleteDrawing);
export const listPoses = byFormat(v1Drawings.listPoses, v2Visuals.listPoses);
export const addPose = byFormat(v1Drawings.addPose, v2Visuals.addPose);
export const updatePose = byFormat(v1Drawings.updatePose, v2Visuals.updatePose);
export const deletePose = byFormat(v1Drawings.deletePose, v2Visuals.deletePose);
export const setVisualOrder = byFormat(v1Visuals.setVisualOrder, v2Visuals.setVisualOrder);
export const listPosePresets = byFormat(v1Presets.listPosePresets, v2Presets.listPosePresets);
export const addPosePresets = byFormat(v1Presets.addPosePresets, v2Presets.addPosePresets);
export const renamePosePreset = byFormat(v1Presets.renamePosePreset, v2Presets.renamePosePreset);
export const setPosePresetData = byFormat(v1Presets.setPosePresetData, v2Presets.setPosePresetData);
export const deletePosePreset = byFormat(v1Presets.deletePosePreset, v2Presets.deletePosePreset);
import * as v1Tags from "./v1/tags.js";
import * as v2Tags from "./v2/tags.js";

export const listTags = byFormat(v1Tags.listTags, v2Tags.listTags);
export const deleteTag = byFormat(v1Tags.deleteTag, v2Tags.deleteTag);
import * as v1Settings from "./v1/settings.js";
import * as v2Settings from "./v2/settings.js";

export const getSettings = byFormat(v1Settings.getSettings, v2Settings.getSettings);
export const saveSettings = byFormat(v1Settings.saveSettings, v2Settings.saveSettings);
import * as v1Data from "./v1/data.js";
import * as v2Data from "./v2/data.js";

export const exportJournal = byFormat(v1Data.exportJournal, v2Data.exportJournal);
export const exportSealed = byFormat(v1Data.exportSealed, v2Data.exportSealed);
export const sealImport = byFormat(v1Data.sealImport, v2Data.sealImport);
export const importItems = byFormat(v1Data.importItems, v2Data.importItems);
export const importTies = byFormat(v1Data.importTies, v2Data.importTies);
export const importWorkshops = byFormat(v1Data.importWorkshops, v2Data.importWorkshops);
import * as v1Connections from "./v1/connections.js";
import * as v2Connections from "./v2/connections.js";

export const listConnections = byFormat(v1Connections.listConnections, v2Connections.listConnections);
export const acceptConnection = byFormat(v1Connections.acceptConnection, v2Connections.acceptConnection);
export const setConnectionPerson = byFormat(v1Connections.setConnectionPerson, v2Connections.setConnectionPerson);
export const markConnectionAnswered = byFormat(v1Connections.markConnectionAnswered, v2Connections.markConnectionAnswered);
export const deleteConnection = byFormat(v1Connections.deleteConnection, v2Connections.deleteConnection);

/** Whether the account can connect to others (format 2's contacts come later). */
export function canConnect() {
  return accountFormat() !== 2;
}
