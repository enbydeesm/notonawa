// A share link's QR code, as one SVG path of its dark squares. Pure, so
// it's easy to test. uqr (vendored) only works out which squares are dark;
// share-code.js draws them with DOM methods, never markup from the library.
//
// Medium error correction (a phone screen, a little glare) and the standard
// border of 4 light squares, which scanners need to find the code.

import { encode } from "./vendor/uqr.js";

/**
 * The code's squares as one SVG path, and its size in squares. Pure, so
 * it's easy to test.
 * @param {string} text
 * @returns {{ size: number, path: string }}
 */
export function qrPath(text) {
  const { size, data } = encode(text, { ecc: "M", border: 4 });
  const parts = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y][x]) parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return { size, path: parts.join("") };
}
