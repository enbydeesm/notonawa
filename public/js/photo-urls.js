// Decrypted photos are shown from blob: URLs, which keep the decrypted
// image in the browser's memory until revoked. Every one is made here, so
// all of them can be revoked when the journal locks, and the images
// showing them are emptied.

import { onWipe } from "./vault.js";

/** @type {Set<string>} */
const urls = new Set();

/**
 * A blob: URL for a decrypted image, revoked on lock (or by revoke()).
 * @param {ArrayBuffer} bytes
 * @param {string} type
 */
export function photoUrl(bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  urls.add(url);
  return url;
}

/** @param {string} url */
export function revoke(url) {
  if (!urls.delete(url)) return;
  URL.revokeObjectURL(url);
}

/** Revokes them all, and empties every image that showed one. */
export function revokeAll() {
  for (const img of document.querySelectorAll("img")) {
    if (urls.has(img.src)) img.removeAttribute("src");
  }
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
}

onWipe(revokeAll);
