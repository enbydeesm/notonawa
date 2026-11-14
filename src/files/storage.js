// Format v3 files in R2 (the PHOTOS bucket), keyed "<owner id>/files/<file
// id>": the sealed thumbnail, then the sealed full size. Nothing in the key
// or the row says which item a file is on; its key is in its item's record.

// R2 deletes up to 1000 keys at a time.
const BATCH = 1000;

/**
 * @param {string} ownerId
 * @param {string} id
 */
export const fileObjectKey = (ownerId, id) => `${ownerId}/files/${id}`;

/**
 * Deletes some of a user's files' objects (their rows are gone already).
 * @param {R2Bucket} bucket
 * @param {string} ownerId
 * @param {string[]} ids
 */
export async function deleteFileObjects(bucket, ownerId, ids) {
  for (let i = 0; i < ids.length; i += BATCH) {
    await bucket.delete(ids.slice(i, i + BATCH).map((id) => fileObjectKey(ownerId, id)));
  }
}
