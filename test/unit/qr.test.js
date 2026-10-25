// A share link's QR code (public/js/qr.js, with the vendored uqr).
import { describe, it, expect } from "vitest";
import { encode } from "../../public/js/vendor/uqr.js";
import { qrPath } from "../../public/js/qr.js";

const LINK = `https://notonawa.app/open#AbCdEfGhIjKlMnOpQrStUv.${"x".repeat(43)}`;

/** @param {string} text */
async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("the QR encoder", () => {
  it("draws a share link the same as when it was checked (version 6, medium correction)", async () => {
    // Pinned: a changed copy of uqr that draws something else fails here.
    const { version, size, data } = encode(LINK, { ecc: "M", border: 4 });
    expect([version, size]).toEqual([6, 49]);
    const rows = data.map((row) => row.map((dark) => (dark ? "1" : "0")).join("")).join("\n");
    expect(await sha256(rows)).toBe("e1edd9099a7032c6b8d965813b3e4faad5fa6b153f52de7bc63b8a2b42f3577f");
  });

  it("has the three finder squares inside a 4-square light border", () => {
    const { size, data } = encode(LINK, { ecc: "M", border: 4 });
    const at = (/** @type {number} */ x, /** @type {number} */ y) => data[y][x];
    for (let i = 0; i < size; i++) expect([at(i, 0), at(i, 3), at(0, i), at(3, i)]).toEqual([false, false, false, false]);
    // Each finder: a dark ring 7 wide, a light ring, a dark 3×3 centre.
    for (const [x, y] of [[4, 4], [size - 11, 4], [4, size - 11]]) {
      expect([at(x, y), at(x + 6, y), at(x, y + 6), at(x + 6, y + 6)]).toEqual([true, true, true, true]);
      expect([at(x + 1, y + 1), at(x + 5, y + 5)]).toEqual([false, false]);
      expect(at(x + 3, y + 3)).toBe(true);
    }
  });
});

describe("qrPath", () => {
  it("is one square per dark module, and nothing else", () => {
    const { size, data } = encode(LINK, { ecc: "M", border: 4 });
    const { size: drawn, path } = qrPath(LINK);
    expect(drawn).toBe(size);
    expect(path).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
    expect(path.split("M").length - 1).toBe(data.flat().filter(Boolean).length);
  });
});
