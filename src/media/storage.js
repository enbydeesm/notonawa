// The photo files in R2 (the PHOTOS bucket). Each photo is one object,
// keyed "<owner id>/<photo id>": the sealed thumbnail, then the sealed full
// size. We can't read them; the browser decrypts.

import { keysWithRows } from "./db.js";

// R2 deletes and lists up to 1000 keys at a time.
const BATCH = 1000;
// Objects this new may still be getting their row (an upload in progress),
// so the clean-up leaves them alone.
const SWEEP_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * @param {string} ownerId
 * @param {string} id
 */
export const objectKey = (ownerId, id) => `${ownerId}/${id}`;

/**
 * Deletes some of a user's photo files.
 * @param {R2Bucket} bucket
 * @param {string} ownerId
 * @param {string[]} ids
 */
export async function deleteObjects(bucket, ownerId, ids) {
  for (let i = 0; i < ids.length; i += BATCH) {
    await bucket.delete(ids.slice(i, i + BATCH).map((id) => objectKey(ownerId, id)));
  }
}

/**
 * Deletes every photo file a user has (deleting the account, or starting a
 * new key).
 * @param {R2Bucket} bucket
 * @param {string} ownerId
 */
export async function deleteAllObjects(bucket, ownerId) {
  // Each round deletes what it listed, so listing again from the start
  // finds what's left.
  for (;;) {
    const listed = await bucket.list({ prefix: `${ownerId}/`, limit: BATCH });
    if (listed.objects.length === 0) return;
    await bucket.delete(listed.objects.map((o) => o.key));
    if (!listed.truncated) return;
  }
}

/**
 * The daily clean-up's part for photos: deletes files with no row, which
 * can be left if a delete or an upload stopped half-way (rows and files
 * can't change in one transaction). Files newer than a day are left alone,
 * in case their upload is still finishing.
 * @param {D1Database} db
 * @param {R2Bucket} bucket
 * @param {number} [now]
 * @returns {Promise<number>} how many were deleted
 */
export async function sweepOrphans(db, bucket, now = Date.now()) {
  let deleted = 0;
  /** @type {string | undefined} */
  let cursor;
  do {
    const listed = await bucket.list({ limit: BATCH, cursor });
    const old = listed.objects.filter((o) => now - o.uploaded.getTime() > SWEEP_GRACE_MS).map((o) => o.key);
    const kept = await keysWithRows(db, old);
    const orphans = old.filter((key) => !kept.has(key));
    if (orphans.length > 0) await bucket.delete(orphans);
    deleted += orphans.length;
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return deleted;
}
