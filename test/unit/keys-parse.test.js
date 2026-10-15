// The shape of wrapped keys as the browser sends them (src/keys/parse.js),
// checked against what public/js/crypto/keys.js really makes.
import { describe, it, expect } from "vitest";
import { parseWrap, parseOptionalWrap } from "../../src/keys/parse.js";
import { newDataKey, wrapDataKey } from "../../public/js/crypto/keys.js";
import { BadInput } from "../../src/http.js";

const real = async (/** @type {"passkey" | "recovery"} */ kind) =>
  wrapDataKey(await newDataKey(), { userId: "u", kind, secret: /** @type {Uint8Array<ArrayBuffer>} */ (crypto.getRandomValues(new Uint8Array(32))) });

describe("parseWrap", () => {
  it("accepts a wrap the browser made, keeping only what's stored", async () => {
    const wrap = await real("passkey");
    const { kind: _kind, ...stored } = wrap;
    expect(parseWrap(wrap, "passkey")).toEqual(stored);
    expect(parseWrap({ ...(await real("recovery")), extra: "dropped" }, "recovery")).not.toHaveProperty("extra");
  });

  it("refuses the wrong kind, a missing or malformed part, or another version", async () => {
    const wrap = await real("passkey");
    for (const bad of [{ ...wrap, kind: "recovery" }, { ...wrap, id: "not-a-uuid" }, { ...wrap, salt: "x" }, { ...wrap, iv: wrap.salt },
      { ...wrap, wrapped: wrap.wrapped.slice(1) }, { ...wrap, version: 2 }, null, "wrap"]) {
      expect(() => parseWrap(bad, "passkey")).toThrow(BadInput);
    }
  });

  it("lets an optional wrap be left out", async () => {
    expect(parseOptionalWrap(undefined, "passkey")).toBeNull();
    expect(parseOptionalWrap(null, "passkey")).toBeNull();
    expect(parseOptionalWrap(await real("passkey"), "passkey")).not.toBeNull();
  });
});
