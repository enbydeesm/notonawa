import { describe, it, expect } from "vitest";
import {
  parseMediaId, parseItem, parseUpload, limitProblem, parseCaption,
  MAX_OBJECT_BYTES, MAX_VIDEO_BYTES, MAX_PER_ITEM, MAX_VIDEOS_PER_ITEM, MAX_ACCOUNT_BYTES,
} from "../../src/media/parse.js";
import { BadInput } from "../../src/http.js";
import { sealed } from "../sealed.js";

const ID = "0b6e1f2c-3d4a-4b5c-8d6e-7f8091a2b3c4";

/** @param {Record<string, string>} params */
const query = (params) => new URLSearchParams(params);
const GOOD = { tie_id: "t1", kind: "photo", mime: "image/jpeg", thumb_bytes: "100" };

describe("parseMediaId", () => {
  it("accepts a random UUID, as the browser makes", () => {
    expect(parseMediaId(ID)).toBe(ID);
  });
  it("refuses anything else", () => {
    for (const bad of ["", "order", ID.toUpperCase(), `${ID}x`, "../x", 5, null]) {
      expect(() => parseMediaId(bad), String(bad)).toThrow(BadInput);
    }
  });
});

describe("parseItem", () => {
  it("takes a tie or a plan", () => {
    expect(parseItem({ tie_id: "t1" })).toEqual({ column: "tie_id", table: "ties", id: "t1" });
    expect(parseItem({ plan_id: "p1" })).toEqual({ column: "plan_id", table: "plans", id: "p1" });
    expect(parseItem({ workshop_id: "w1" })).toEqual({ column: "workshop_id", table: "workshops", id: "w1" });
  });
  it("needs exactly one, with an id-shaped value", () => {
    expect(() => parseItem({})).toThrow("tie_id, plan_id or workshop_id");
    expect(() => parseItem({ tie_id: "t1", plan_id: "p1" })).toThrow("tie_id, plan_id or workshop_id");
    expect(() => parseItem({ plan_id: "p1", workshop_id: "w1" })).toThrow("tie_id, plan_id or workshop_id");
    expect(() => parseItem({ tie_id: "a b" })).toThrow(BadInput);
    expect(() => parseItem({ plan_id: 7 })).toThrow(BadInput);
  });
});

describe("parseUpload", () => {
  it("reads the item, kind, type and sizes", () => {
    expect(parseUpload(ID, query(GOOD), "5000")).toEqual({
      id: ID, item: { column: "tie_id", table: "ties", id: "t1" },
      kind: "photo", mime: "image/jpeg", thumbBytes: 100, bytes: 5000,
    });
  });
  it("takes photos as JPEG or WebP, and videos as MP4", () => {
    expect(parseUpload(ID, query({ ...GOOD, kind: "video", mime: "video/mp4" }), "5000")).toMatchObject({ kind: "video", mime: "video/mp4" });
    expect(() => parseUpload(ID, query({ ...GOOD, kind: "audio" }), "5000")).toThrow("Only photos and videos");
    expect(() => parseUpload(ID, query({ ...GOOD, mime: "image/png" }), "5000")).toThrow("JPEG and WebP");
    expect(() => parseUpload(ID, query({ ...GOOD, mime: "video/mp4" }), "5000")).toThrow("JPEG and WebP");
    expect(() => parseUpload(ID, query({ ...GOOD, kind: "video" }), "5000")).toThrow("Only MP4");
    expect(() => parseUpload(ID, query({ ...GOOD, kind: "video", mime: "video/quicktime" }), "5000")).toThrow("Only MP4");
  });
  it("needs a size, no bigger than 10 MB", () => {
    expect(() => parseUpload(ID, query(GOOD), null)).toThrow("size wasn't sent");
    expect(() => parseUpload(ID, query(GOOD), "0")).toThrow(BadInput);
    expect(parseUpload(ID, query(GOOD), String(MAX_OBJECT_BYTES)).bytes).toBe(MAX_OBJECT_BYTES);
    expect(() => parseUpload(ID, query(GOOD), String(MAX_OBJECT_BYTES + 1))).toThrow("That photo is too big");
  });
  it("lets a video be up to 40 MB", () => {
    const video = query({ ...GOOD, kind: "video", mime: "video/mp4" });
    expect(parseUpload(ID, video, String(MAX_VIDEO_BYTES)).bytes).toBe(MAX_VIDEO_BYTES);
    expect(() => parseUpload(ID, video, String(MAX_VIDEO_BYTES + 1))).toThrow("That video is too big");
    expect(() => parseUpload(ID, video, String(MAX_VIDEO_BYTES + 1))).toThrow("cropping or shortening it, or lowering its quality");
  });
  it("needs the thumbnail to end inside the object", () => {
    for (const thumb of ["0", "5000", "6000", "1.5", ""]) {
      expect(() => parseUpload(ID, query({ ...GOOD, thumb_bytes: thumb }), "5000"), thumb).toThrow("thumbnail");
    }
  });
});

describe("limitProblem", () => {
  const photo = { kind: /** @type {const} */ ("photo"), bytes: 10 };
  const video = { kind: /** @type {const} */ ("video"), bytes: 10 };
  it("allows up to 30 photos and videos an item and 1 GB an account", () => {
    expect(limitProblem({ count: MAX_PER_ITEM - 1, videoCount: 0, accountBytes: MAX_ACCOUNT_BYTES - 10 }, photo)).toBeNull();
    expect(limitProblem({ count: MAX_PER_ITEM, videoCount: 0, accountBytes: 0 }, photo)).toMatch("at most 30");
    expect(limitProblem({ count: MAX_PER_ITEM, videoCount: 0, accountBytes: 0 }, video)).toMatch("at most 30");
    expect(limitProblem({ count: 0, videoCount: 0, accountBytes: MAX_ACCOUNT_BYTES - 10 }, { ...video, bytes: 11 })).toMatch("1 GB");
  });
  it("allows 5 of them to be videos, still taking photos after that", () => {
    expect(limitProblem({ count: 4, videoCount: MAX_VIDEOS_PER_ITEM - 1, accountBytes: 0 }, video)).toBeNull();
    expect(limitProblem({ count: 5, videoCount: MAX_VIDEOS_PER_ITEM, accountBytes: 0 }, video)).toMatch("at most 5 videos");
    expect(limitProblem({ count: 5, videoCount: MAX_VIDEOS_PER_ITEM, accountBytes: 0 }, photo)).toBeNull();
  });
});

describe("parseCaption", () => {
  it("takes a sealed caption, or empty", () => {
    expect(parseCaption(sealed("Front"))).toBe(sealed("Front"));
    expect(parseCaption("")).toBeNull();
    expect(parseCaption(null)).toBeNull();
  });
  it("refuses plain text and over-long captions", () => {
    expect(() => parseCaption("Front view")).toThrow("caption");
    expect(() => parseCaption(sealed("x".repeat(2000)))).toThrow("too long");
  });
});

