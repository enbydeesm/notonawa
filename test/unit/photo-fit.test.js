// The pure parts of preparing a photo (public/js/photo-fit.js). Drawing
// and encoding (photo-prep.js) need a browser: the UI walkthrough covers them.
import { describe, it, expect } from "vitest";
import { fileProblem, fitWithin, firstUnder, MAX_INPUT_BYTES, FULL_EDGE } from "../../public/js/photo-fit.js";

describe("fileProblem", () => {
  it("takes JPEG, PNG and WebP up to 30 MB, and files of unknown type to try", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", ""]) {
      expect(fileProblem({ type, size: MAX_INPUT_BYTES }), type).toBeNull();
    }
  });
  it("explains HEIC, other types and big files", () => {
    expect(fileProblem({ type: "image/heic", size: 1 })).toMatch("Save it as JPEG");
    expect(fileProblem({ type: "image/heif", size: 1 })).toMatch("Save it as JPEG");
    expect(fileProblem({ type: "image/gif", size: 1 })).toMatch("Only JPEG, PNG and WebP");
    expect(fileProblem({ type: "image/jpeg", size: MAX_INPUT_BYTES + 1 })).toMatch("over 30 MB");
  });
});

describe("fitWithin", () => {
  it("shrinks the longest side to the edge, keeping the shape", () => {
    expect(fitWithin(4032, 3024, FULL_EDGE)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3024, 4032, FULL_EDGE)).toEqual({ width: 1536, height: 2048 });
    expect(fitWithin(8000, 10, 320)).toEqual({ width: 320, height: 1 });
  });
  it("never enlarges", () => {
    expect(fitWithin(640, 480, FULL_EDGE)).toEqual({ width: 640, height: 480 });
  });
});

describe("firstUnder", () => {
  /** @param {Record<number, number>} sizes quality -> bytes */
  const encoder = (sizes) => {
    /** @type {number[]} */
    const tried = [];
    const encode = async (/** @type {number} */ q) => { tried.push(q); return new Blob([new Uint8Array(sizes[q])]); };
    return { tried, encode };
  };

  it("stops at the first quality under the target", async () => {
    const { tried, encode } = encoder({ 0.8: 900, 0.7: 400, 0.6: 300 });
    expect((await firstUnder([0.8, 0.7, 0.6], encode, 500)).size).toBe(400);
    expect(tried).toEqual([0.8, 0.7]);
  });
  it("keeps the best quality when it already fits", async () => {
    const { tried, encode } = encoder({ 0.8: 100, 0.7: 50 });
    expect((await firstUnder([0.8, 0.7], encode, 500)).size).toBe(100);
    expect(tried).toEqual([0.8]);
  });
  it("settles for the last when none fits", async () => {
    const { encode } = encoder({ 0.8: 900, 0.7: 800 });
    expect((await firstUnder([0.8, 0.7], encode, 500)).size).toBe(800);
  });
});
