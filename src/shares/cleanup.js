// The daily clean-up's part for shares (run by the cron trigger, index.js):
// deletes shares that have expired, and any an open stopped deleting half-way
// after their last use, with their files.

import { deleteEndedShares } from "./db.js";
import { deleteShareFiles } from "./storage.js";

/**
 * @param {D1Database} db
 * @param {R2Bucket} bucket
 * @returns {Promise<number>} how many were deleted
 */
export async function cleanUpShares(db, bucket) {
  const ended = await deleteEndedShares(db);
  await deleteShareFiles(bucket, ended);
  return ended.length;
}
