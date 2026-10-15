// Zip files for exports with photos (public/js/zip.js).
import { describe, it, expect } from "vitest";
import { crc32, makeZip, readZip, looksLikeZip } from "../../public/js/zip.js";

const text = (/** @type {string} */ s) => /** @type {Uint8Array<ArrayBuffer>} */ (new TextEncoder().encode(s));

/** @param {Uint8Array<ArrayBuffer>[]} parts */
async function joined(parts) {
  return new Blob(parts).arrayBuffer();
}

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("makeZip and readZip", () => {
  it("round-trip files, with UTF-8 names and binary data", async () => {
    const photo = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
    const buffer = await joined(makeZip([
      { name: "notonawa.json", data: text('{"a":"ö"}') },
      { name: "photos/ö-1.webp", data: photo },
      { name: "empty.txt", data: new Uint8Array() },
    ], new Date(2026, 9, 14, 21, 30, 10)));
    expect(looksLikeZip(new Uint8Array(buffer))).toBe(true);
    const files = await readZip(buffer);
    expect([...files.keys()]).toEqual(["notonawa.json", "photos/ö-1.webp", "empty.txt"]);
    expect(new TextDecoder().decode(files.get("notonawa.json"))).toBe('{"a":"ö"}');
    expect(files.get("photos/ö-1.webp")).toEqual(photo);
    expect(files.get("empty.txt")?.length).toBe(0);
  });

  it("read deflated entries too (an export zipped again)", async () => {
    const original = text("rope ".repeat(1000));
    const deflated = new Uint8Array(await new Response(
      new Blob([original]).stream().pipeThrough(new CompressionStream("deflate-raw"))
    ).arrayBuffer());
    // A stored zip, then switched to "deflated" with the compressed data.
    const [local, name] = makeZip([{ name: "a.txt", data: original }]);
    const header = new DataView(local.buffer.slice(0));
    header.setUint16(8, 8, true);
    header.setUint32(18, deflated.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(10, 8, true);
    central.setUint32(16, crc32(original), true);
    central.setUint32(20, deflated.length, true);
    central.setUint32(24, original.length, true);
    central.setUint16(28, name.length, true);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, 1, true);
    end.setUint16(10, 1, true);
    end.setUint32(12, 46 + name.length, true);
    end.setUint32(16, 30 + name.length + deflated.length, true);
    const buffer = await joined([new Uint8Array(header.buffer), name, deflated, new Uint8Array(central.buffer), name, new Uint8Array(end.buffer)]);
    expect((await readZip(buffer)).get("a.txt")).toEqual(original);
  });

  it("refuse damaged files and things that aren't zips", async () => {
    const parts = makeZip([{ name: "a.txt", data: text("hello") }]);
    const bytes = new Uint8Array(await joined(parts));
    expect(looksLikeZip(text("{}"))).toBe(false);
    await expect(readZip(text("not a zip").buffer)).rejects.toThrow("can't be read");
    // One byte of the data changed: the CRC no longer matches.
    const damaged = bytes.slice();
    damaged[30 + "a.txt".length] ^= 0xff;
    await expect(readZip(damaged.buffer)).rejects.toThrow('"a.txt" in the zip file is damaged');
  });
});
