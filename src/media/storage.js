// The photo files in R2 (the PHOTOS bucket). Each photo is one object,
// keyed "<owner id>/<photo id>": the sealed thumbnail, then the sealed full
// size. We can't read them; the browser decrypts. Shares' files are in the
// same folders, under "<owner id>/shares/" (shares/parse.js), and format v3
// files under "<owner id>/files/" (files/storage.js).

import { keysWithRows } from "./db.js";
import { shareOfKey } from "../shares/parse.js";
import { sharesWithRows } from "../shares/db.js";
import { isFileKey } from "../files/storage.js";
import { fileKeysWithRows } from "../files/db.js";

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
 * Deletes every photo and share file a user has (deleting the account, or
 * starting a new key).
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
 * The daily clean-up's part for photos, shares and format v3 files: deletes ones with no
 * row, which can be left if a delete or an upload stopped half-way (rows
 * and files can't change in one transaction). Files newer than a day are
 * left alone, in case their upload is still finishing.
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
    const shareFiles = old.flatMap((key) => {
      const share = shareOfKey(key);
      return share ? [{ key, ...share }] : [];
    });
    const files = old.filter(isFileKey);
    const photos = old.filter((key) => !shareOfKey(key) && !isFileKey(key));
    const kept = await keysWithRows(db, photos);
    const keptShares = await sharesWithRows(db, shareFiles);
    const keptFiles = await fileKeysWithRows(db, files);
    const orphans = [
      ...photos.filter((key) => !kept.has(key)),
      ...files.filter((key) => !keptFiles.has(key)),
      ...shareFiles.filter((s) => !keptShares.has(`${s.ownerId}/${s.shareId}`)).map((s) => s.key),
    ];
    if (orphans.length > 0) await bucket.delete(orphans);
    deleted += orphans.length;
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return deleted;
}
