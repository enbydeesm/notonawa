// Shares' sealed files in R2 (the PHOTOS bucket), in their owner's folder:
// "<owner id>/shares/<share id>/snapshot" (parse.js). We can't open them;
// the link's key does, in the browser.

import { sharePrefix, snapshotKey } from "./parse.js";

/**
 * @param {R2Bucket} bucket
 * @param {string} ownerId
 * @param {string} shareId
 * @param {Uint8Array} snapshot sealed
 */
export async function putSnapshot(bucket, ownerId, shareId, snapshot) {
  await bucket.put(snapshotKey(ownerId, shareId), snapshot, {
    httpMetadata: { contentType: "application/octet-stream" },
  });
}

/**
 * @param {R2Bucket} bucket
 * @param {string} ownerId
 * @param {string} shareId
 * @returns {Promise<ArrayBuffer | null>} null if it's gone
 */
export async function getSnapshot(bucket, ownerId, shareId) {
  const object = await bucket.get(snapshotKey(ownerId, shareId));
  return object ? object.arrayBuffer() : null;
}

/**
 * Deletes all of some shares' files (revoked, used up or ended).
 * @param {R2Bucket} bucket
 * @param {{ owner_id: string, id: string }[]} shares
 */
export async function deleteShareFiles(bucket, shares) {
  for (const share of shares) {
    // Each round deletes what it listed, so listing again finds what's left.
    for (;;) {
      const listed = await bucket.list({ prefix: sharePrefix(share.owner_id, share.id), limit: 1000 });
      if (listed.objects.length === 0) break;
      await bucket.delete(listed.objects.map((o) => o.key));
      if (!listed.truncated) break;
    }
  }
}
