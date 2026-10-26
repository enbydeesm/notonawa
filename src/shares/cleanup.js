// The daily clean-up's part for shares (run by the cron trigger, index.js):
// deletes shares that have expired, and any an open stopped deleting half-way
// after their last use, with their files, and offers to connect that
// nobody accepted.

import { deleteEndedShares } from "./db.js";
import { deleteShareFiles } from "./storage.js";
import { deleteExpiredOffers } from "../connections/db.js";

/**
 * @param {D1Database} db
 * @param {R2Bucket} bucket
 * @returns {Promise<number>} how many shares were deleted
 */
export async function cleanUpShares(db, bucket) {
  const ended = await deleteEndedShares(db);
  await deleteShareFiles(bucket, ended);
  await deleteExpiredOffers(db);
  return ended.length;
}
