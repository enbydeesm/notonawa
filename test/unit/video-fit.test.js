// The pure parts of preparing a video (public/js/video-fit.js). The
// re-encoding (video-prep.js) needs a browser: the UI walkthrough covers it.
import { describe, it, expect } from "vitest";
import {
  isVideo, videoProblem, durationProblem, videoSize, clock, MAX_INPUT_BYTES, MAX_SECONDS, MAX_OUTPUT_BYTES,
  VIDEO_BITRATE, AUDIO_BITRATE, TOO_BIG,
} from "../../public/js/video-fit.js";
import { MAX_VIDEO_BYTES } from "../../src/media/parse.js";

describe("isVideo", () => {
  it("goes by the type, or the name when there's none", () => {
    expect(isVideo({ type: "video/quicktime", name: "a.jpg" })).toBe(true);
    expect(isVideo({ type: "image/jpeg", name: "a.mov" })).toBe(false);
    expect(isVideo({ type: "", name: "IMG_0001.MOV" })).toBe(true);
    expect(isVideo({ type: "", name: "clip.mp4" })).toBe(true);
    expect(isVideo({ type: "", name: "photo.jpg" })).toBe(false);
  });
});

describe("videoProblem", () => {
  it("takes MP4 and MOV up to 4 GB, and files of unknown type to try", () => {
    for (const type of ["video/mp4", "video/quicktime", ""]) {
      expect(videoProblem({ type, size: MAX_INPUT_BYTES }), type).toBeNull();
    }
  });
  it("explains other types and huge files", () => {
    expect(videoProblem({ type: "video/webm", size: 1 })).toMatch("Only MP4 and MOV");
    expect(videoProblem({ type: "video/mp4", size: MAX_INPUT_BYTES + 1 })).toMatch("over 4 GB");
  });
});

describe("durationProblem", () => {
  it("takes clips up to 3 minutes", () => {
    expect(durationProblem(1)).toBeNull();
    expect(durationProblem(MAX_SECONDS)).toBeNull();
    // A clip timed at 3:00 can come out a fraction over.
    expect(durationProblem(MAX_SECONDS + 0.4)).toBeNull();
  });
  it("refuses longer ones, saying how long, and ones that can't be timed", () => {
    expect(durationProblem(MAX_SECONDS + 1)).toBe("That video is 3:01 long. Trim it to under 3 minutes and try again.");
    expect(durationProblem(0)).toMatch("couldn't be read");
    expect(durationProblem(NaN)).toMatch("couldn't be read");
    expect(durationProblem(Infinity)).toMatch("couldn't be read");
  });
});

describe("videoSize", () => {
  it("brings the shorter side down to 480, keeping the shape, either way up", () => {
    expect(videoSize(1920, 1080)).toEqual({ width: 854, height: 480 });
    expect(videoSize(1080, 1920)).toEqual({ width: 480, height: 854 });
    expect(videoSize(3840, 2160)).toEqual({ width: 854, height: 480 });
    expect(videoSize(1440, 1440)).toEqual({ width: 480, height: 480 });
  });
  it("never enlarges, and keeps both sides even", () => {
    expect(videoSize(640, 360)).toEqual({ width: 640, height: 360 });
    expect(videoSize(321, 241)).toEqual({ width: 322, height: 242 });
    expect(videoSize(1, 1)).toEqual({ width: 2, height: 2 });
  });
});

describe("clock", () => {
  it("shows minutes and seconds", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(65.4)).toBe("1:05");
    expect(clock(180)).toBe("3:00");
  });
});

describe("the limits fit together", () => {
  it("a full-length clip at these bitrates fits what's uploaded, which fits what the server stores", () => {
    const fullLength = ((VIDEO_BITRATE + AUDIO_BITRATE) / 8) * MAX_SECONDS;
    expect(fullLength).toBeLessThan(MAX_OUTPUT_BYTES * 0.8);
    expect(MAX_OUTPUT_BYTES).toBeLessThan(MAX_VIDEO_BYTES);
  });
});

describe("TOO_BIG", () => {
  it("says how to make a clip small enough", () => {
    expect(TOO_BIG).toContain("too big to store");
    expect(TOO_BIG).toContain("cropping or shortening it, or lowering its quality");
  });
});
