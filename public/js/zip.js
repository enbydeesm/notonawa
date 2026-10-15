// Zip files for exports with photos: notonawa.json and a photos/
// folder. Written "stored" (not compressed): photos are already compressed,
// and the JSON is small next to them. Read either way, as someone may unzip
// and zip an export again (deflated entries are inflated with the
// browser's own DecompressionStream). No Zip64: an account's photos are
// kept well under its 4 GB limit.
//
// Pure apart from DecompressionStream, so it's easy to test.

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
// Bit 11: names are UTF-8.
const UTF8_FLAG = 0x0800;
const MAX_SIZE = 0xffffffff;

/** @type {Uint32Array | null} */
let crcTable = null;

/**
 * The CRC-32 that zip files use.
 * @param {Uint8Array} bytes
 */
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A date in the zip format's DOS time and date (local time, 2-second steps).
 * @param {Date} date
 */
function dosTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * The parts of a zip holding these files, stored, in this order (for new
 * Blob(parts)).
 * @param {{ name: string, data: Uint8Array<ArrayBuffer> }[]} files
 * @param {Date} [modified]
 * @returns {Uint8Array<ArrayBuffer>[]}
 */
export function makeZip(files, modified = new Date()) {
  const { time, date } = dosTime(modified);
  /** @type {Uint8Array<ArrayBuffer>[]} */
  const parts = [];
  /** @type {Uint8Array<ArrayBuffer>[]} */
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = /** @type {Uint8Array<ArrayBuffer>} */ (new TextEncoder().encode(file.name));
    const crc = crc32(file.data);
    const size = file.data.length;
    if (size > MAX_SIZE || offset > MAX_SIZE) throw new Error("That's too much for one zip file.");

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOCAL_HEADER, true);
    local.setUint16(4, 20, true); // version needed: 2.0
    local.setUint16(6, UTF8_FLAG, true);
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, file.data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, CENTRAL_HEADER, true);
    entry.setUint16(4, 20, true); // made by: 2.0
    entry.setUint16(6, 20, true);
    entry.setUint16(8, UTF8_FLAG, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, date, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, size, true);
    entry.setUint32(24, size, true);
    entry.setUint16(28, name.length, true);
    // Extra, comment, disk, internal and external attributes: all 0.
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);

    offset += 30 + name.length + size;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, END_OF_CENTRAL, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return [...parts, ...central, new Uint8Array(end.buffer)];
}

/**
 * Whether these bytes start like a zip file.
 * @param {Uint8Array} bytes
 */
export function looksLikeZip(bytes) {
  return bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === LOCAL_HEADER;
}

/**
 * The files in a zip, by name (folders left out). Throws an Error with a
 * message to show if it isn't a zip it can read.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Map<string, Uint8Array<ArrayBuffer>>>}
 */
export async function readZip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const bad = () => new Error("This zip file can't be read.");

  // The end record is in the last 22 bytes, plus up to 64 KB of comment.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL) { end = i; break; }
  }
  if (end < 0) throw bad();
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (count === 0xffff || at === MAX_SIZE) throw new Error("This zip file is too big to read here.");

  /** @type {Map<string, Uint8Array<ArrayBuffer>>} */
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL_HEADER) throw bad();
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;

    if (localAt + 30 > bytes.length || view.getUint32(localAt, true) !== LOCAL_HEADER) throw bad();
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    if (dataAt + packed > bytes.length) throw bad();
    const raw = bytes.slice(dataAt, dataAt + packed);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = await inflate(raw);
    else throw new Error("This zip file is compressed in a way that can't be read here.");
    if (data.length !== size || crc32(data) !== crc) throw new Error(`"${name}" in the zip file is damaged.`);
    files.set(name, data);
  }
  return files;
}

/**
 * @param {Uint8Array<ArrayBuffer>} raw deflated
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
async function inflate(raw) {
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
