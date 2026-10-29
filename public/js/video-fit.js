// Preparing a video: the pure parts (which files, how long, what size and
// bitrate), kept apart from the re-encoding in video-prep.js so they can be
// tested without a browser.
//
// Every clip is re-encoded on the device: that writes a new file with none
// of the original's metadata (GPS location, dates, the phone's model) and
// shrinks it a lot. 480p at about 1.3 Mbps is about 10 MB a minute.

/** The file types the picker offers for videos (iPhones save MOV). */
export const VIDEO_ACCEPT = "video/mp4,video/quicktime";
/** The longest clip, in seconds. */
export const MAX_SECONDS = 3 * 60;
/** The biggest file taken in (it's read in pieces, never all at once). */
export const MAX_INPUT_BYTES = 4 * 1024 * 1024 * 1024;
/** The shorter side, in pixels: 480p. */
export const SHORT_EDGE = 480;
/** The video's bitrate, in bits a second. */
export const VIDEO_BITRATE = 1_200_000;
/** The sound's. */
export const AUDIO_BITRATE = 96_000;
/** The most frames a second kept. */
export const MAX_FPS = 30;
/** The thumbnail's longest side, as a photo's. */
export const THUMB_EDGE = 320;
/** The thumbnail's JPEG quality. Always JPEG, which every browser's canvas makes. */
export const THUMB_QUALITY = 0.7;
/**
 * The biggest prepared clip uploaded, a little under the server's 40 MB
 * (MAX_VIDEO_BYTES in src/media/parse.js) to leave room for sealing.
 */
export const MAX_OUTPUT_BYTES = 39 * 1024 * 1024;
/** What to say when a clip is still over MAX_OUTPUT_BYTES once shrunk, and how to fix it. */
export const TOO_BIG = "That video is too big to store, even after shrinking it. " +
  "Try cropping or shortening it, or lowering its quality, then add it again.";

/**
 * Whether a chosen file is a video (by its type, or its name when the
 * browser gives no type).
 * @param {{ type: string, name: string }} file
 */
export function isVideo({ type, name }) {
  if (type) return type.startsWith("video/");
  return /\.(mp4|m4v|mov)$/i.test(name);
}

/**
 * Why a chosen video can't be added, or null if it can be tried.
 * @param {{ type: string, size: number }} file
 * @returns {string | null}
 */
export function videoProblem({ type, size }) {
  if (type && !VIDEO_ACCEPT.split(",").includes(type)) return "Only MP4 and MOV videos can be added.";
  if (size > MAX_INPUT_BYTES) return "That video is over 4 GB.";
  return null;
}

/**
 * Why a clip this long can't be added, or null if it can.
 * @param {number} seconds
 * @returns {string | null}
 */
export function durationProblem(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "That video couldn't be read. Save it as MP4 and try again.";
  if (seconds > MAX_SECONDS + 0.5) return `That video is ${clock(seconds)} long. Trim it to under 3 minutes and try again.`;
  return null;
}

/**
 * The size to encode at: the shorter side at most SHORT_EDGE, keeping the
 * shape, never enlarged, both sides even (as H.264 needs).
 * @param {number} width as shown (after any rotation)
 * @param {number} height
 * @returns {{ width: number, height: number }}
 */
export function videoSize(width, height) {
  const scale = Math.min(1, SHORT_EDGE / Math.min(width, height));
  const even = (/** @type {number} */ n) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/**
 * A length as m:ss.
 * @param {number} seconds
 */
export function clock(seconds) {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
