// Shares' sealed files in R2 (the PHOTOS bucket), in their owner's folder:
// "<owner id>/shares/<share id>/snapshot" and, for its photos and videos,
// "<owner id>/shares/<share id>/<file id>" (parse.js). We can't open them;
// the link's key does, in the browser.

import { sharePrefix, snapshotKey, fileKey } from "./parse.js";

/** @typedef {import("./parse.js").ShareFile} ShareFile */

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

/**
 * Stores one of a share's photos or videos, streamed straight into R2 and
 * checked to be exactly the size the browser said. Its kind and where its
 * thumbnail ends are kept with it, for fetching a part and for counting
 * videos.
 * @param {R2Bucket} bucket
 * @param {string} ownerId
 * @param {string} shareId
 * @param {ShareFile} file
 * @param {ReadableStream} body
 */
export async function putFile(bucket, ownerId, shareId, file, body) {
  await bucket.put(fileKey(ownerId, shareId, file.id), body.pipeThrough(new FixedLengthStream(file.bytes)), {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { kind: file.kind, thumb_bytes: String(file.thumbBytes) },
  });
}

/**
 * A share's photos and videos stored so far (not its snapshot).
 * @param {R2Bucket} bucket
 * @param {string} ownerId
 * @param {string} shareId
 * @returns {Promise<{ id: string, kind: string }[]>}
 */
export async function listFiles(bucket, ownerId, shareId) {
  const prefix = sharePrefix(ownerId, shareId);
  // A share has at most 30 files and its snapshot: one page of a listing.
  const listed = await bucket.list({ prefix, limit: 1000, include: ["customMetadata"] });
  return listed.objects
    .filter((o) => o.key !== snapshotKey(ownerId, shareId))
    .map((o) => ({ id: o.key.slice(prefix.length), kind: o.customMetadata?.kind ?? "photo" }));
}

/**
 * One part of a share's photo or video: its sealed thumbnail or full size.
 * @param {R2Bucket} bucket
 * @param {string} ownerId
 * @param {string} shareId
 * @param {string} fileId
 * @param {"thumb" | "full"} part
 * @returns {Promise<{ body: ReadableStream, length: number } | null>} null if it isn't there
 */
export async function getFilePart(bucket, ownerId, shareId, fileId, part) {
  const key = fileKey(ownerId, shareId, fileId);
  const head = await bucket.head(key);
  const thumbBytes = Number(head?.customMetadata?.thumb_bytes);
  if (!head || !Number.isInteger(thumbBytes) || thumbBytes <= 0 || thumbBytes >= head.size) return null;
  const range = part === "thumb" ? { offset: 0, length: thumbBytes } : { offset: thumbBytes, length: head.size - thumbBytes };
  const object = await bucket.get(key, { range });
  return object ? { body: object.body, length: range.length } : null;
}

/**
 * Deletes one of a share's files (an upload whose row couldn't count it).
 * @param {R2Bucket} bucket
 * @param {string} ownerId
 * @param {string} shareId
 * @param {string} fileId
 */
export async function deleteFile(bucket, ownerId, shareId, fileId) {
  await bucket.delete(fileKey(ownerId, shareId, fileId));
}
