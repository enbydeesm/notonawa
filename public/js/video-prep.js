// Preparing a video before it's sealed and uploaded: the clip is decoded
// and re-encoded on the device (mediabunny, over the browser's WebCodecs),
// which writes a new MP4 with none of the original's metadata (GPS
// location, dates, the phone's model) and shrinks it to 480p.
//
// Nothing is copied over from the original: every frame and sound sample
// is encoded again (copy: false), its metadata tags are replaced with none
// (tags: {}), and the names its tracks were given (some cameras put their
// model there) are dropped. Rotation is drawn into the frames. The
// thumbnail is a frame from a second in, drawn on a canvas as JPEG.
//
// The file is read in pieces as it's needed, never all at once, so a long
// 4K original is fine; only the 480p result is held in memory.
//
// A browser that can't encode the picture (H.264) can't prepare videos at
// all. One that can't encode the sound (AAC) asks first (withoutSound):
// the clip can go up silent, or not at all.

import {
  Input, ALL_FORMATS, BlobSource, Output, Mp4OutputFormat, BufferTarget, Conversion, CanvasSink, Quality,
  canEncodeVideo, canEncodeAudio,
} from "./vendor/mediabunny.js";
import {
  AUDIO_BITRATE, MAX_FPS, MAX_OUTPUT_BYTES, THUMB_EDGE, THUMB_QUALITY, TOO_BIG, VIDEO_BITRATE,
  durationProblem, videoProblem, videoSize,
} from "./video-fit.js";
import { fitWithin } from "./photo-fit.js";

/**
 * A prepared video: re-encoded as MP4 without the original's metadata, and
 * its thumbnail.
 * @typedef {{ kind: "video", full: ArrayBuffer, thumb: ArrayBuffer, mime: "video/mp4", seconds: number }} PreparedVideo
 */

const CANT = "This browser can't prepare videos. Try the latest Chrome or Safari.";
const CANT_READ = "That video couldn't be read. Save it as MP4 and try again.";

/** A video left out because it would have had no sound, and that wasn't wanted. */
export class SilentRefused extends Error {
  constructor() {
    super("Not added, as this browser could only upload it without its sound.");
    this.name = "SilentRefused";
  }
}

/**
 * @param {File} file
 * @param {{
 *   onProgress?: (fraction: number) => void,
 *   withoutSound?: () => Promise<boolean>,
 * }} [options] onProgress: from 0 to 1 as it's encoded; withoutSound: asked
 *   when the sound can't be encoded, whether to go on without it (if not
 *   given, it doesn't)
 * @returns {Promise<PreparedVideo>}
 * @throws {Error} with a message to show if the file can't be used
 *   (SilentRefused if it was left out for its sound)
 */
export async function prepareVideo(file, { onProgress = () => {}, withoutSound = async () => false } = {}) {
  const problem = videoProblem(file);
  if (problem) throw new Error(problem);
  if (typeof VideoEncoder === "undefined") throw new Error(CANT);
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryVideoTrack().catch(() => null);
    if (!track || !(await track.canDecode())) throw new Error(CANT_READ);
    const seconds = await input.computeDuration();
    const tooLong = durationProblem(seconds);
    if (tooLong) throw new Error(tooLong);

    const shown = { width: await track.getDisplayWidth(), height: await track.getDisplayHeight() };
    const size = videoSize(shown.width, shown.height);
    if (!(await canEncodeVideo("avc", { ...size, bitrate: VIDEO_BITRATE }))) throw new Error(CANT);
    const sound = await input.getPrimaryAudioTrack();
    const silent = async () => {
      if (!(await withoutSound())) throw new SilentRefused();
      return false;
    };
    // Checked for this clip's own sound (its channels and sample rate).
    let keepSound = !!sound && ((await canEncodeAudio("aac", {
      numberOfChannels: await sound.getNumberOfChannels(), sampleRate: await sound.getSampleRate(), bitrate: AUDIO_BITRATE,
    })) || (await silent()));

    const thumb = await thumbnail(track, shown, (await track.getFirstTimestamp()) + Math.min(1, seconds / 2));
    // Fewer frames a second only if the clip has more (slow-motion clips
    // can have 240); a 24 fps clip stays at 24.
    const rate = (await track.computePacketStats(120).catch(() => null))?.averagePacketRate ?? MAX_FPS;

    /** @param {boolean} withSound */
    const convert = async (withSound) => {
      const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
      const conversion = await Conversion.init({
        input, output,
        tracks: "primary",
        copy: false,
        tags: {},
        showWarnings: false,
        video: (t) => {
          forgetName(t);
          return {
            ...size, fit: "fill", codec: "avc", quality: new Quality({ bitrate: VIDEO_BITRATE }),
            frameRate: rate > MAX_FPS + 1 ? MAX_FPS : undefined, allowTransformationMetadata: false,
          };
        },
        audio: (t) => {
          forgetName(t);
          return withSound ? { codec: "aac", quality: new Quality({ bitrate: AUDIO_BITRATE }) } : { discard: true };
        },
      });
      return { output, conversion };
    };
    let { output, conversion } = await convert(keepSound);
    // The conversion leaves out a track it can't encode rather than
    // failing. Without the picture there's no video; without the sound,
    // ask (if the check above didn't already), then start again without it.
    if (keepSound && conversion.discardedTracks.some((d) => d.track === sound)) {
      keepSound = await silent();
      ({ output, conversion } = await convert(false));
    }
    if (!conversion.isValid || conversion.discardedTracks.some((d) => d.track === track)) throw new Error(CANT);
    conversion.onProgress = (fraction) => onProgress(Math.min(1, fraction));
    await conversion.execute();
    const full = output.target.buffer;
    if (!full) throw new Error(CANT);
    if (full.byteLength > MAX_OUTPUT_BYTES) throw new Error(TOO_BIG);
    return { kind: "video", full, thumb, mime: "video/mp4", seconds };
  } finally {
    input.dispose();
  }
}

/**
 * The conversion copies each track's name; some cameras put their model
 * there. It's read from the same track object these options are given, so
 * this hides it for the copy.
 * @param {import("./vendor/mediabunny.js").InputTrack} track
 */
function forgetName(track) {
  track.getName = async () => null;
}

/**
 * A frame as a JPEG, THUMB_EDGE on its longest side.
 * @param {import("./vendor/mediabunny.js").InputVideoTrack} track
 * @param {{ width: number, height: number }} shown
 * @param {number} at seconds
 * @returns {Promise<ArrayBuffer>}
 */
async function thumbnail(track, shown, at) {
  const size = fitWithin(shown.width, shown.height, THUMB_EDGE);
  const sink = new CanvasSink(track, { ...size, fit: "fill" });
  const frame = (await sink.getCanvas(at)) ?? (await sink.getCanvas(await track.getFirstTimestamp()));
  if (!frame) throw new Error(CANT_READ);
  const { canvas } = frame;
  const blob = "convertToBlob" in canvas
    ? await canvas.convertToBlob({ type: "image/jpeg", quality: THUMB_QUALITY })
    : await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(CANT_READ))), "image/jpeg", THUMB_QUALITY);
    });
  return /** @type {Blob} */ (blob).arrayBuffer();
}
