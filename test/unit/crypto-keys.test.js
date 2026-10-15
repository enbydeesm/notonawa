// The data key and its wraps (public/js/crypto/keys.js), run in the Workers
// runtime's WebCrypto.
import { describe, it, expect } from "vitest";
import {
  newDataKey, wrapDataKey, unwrapDataKey, recoveryKeyMaterial, prfSalt, WrongSecret, fromBase64url,
} from "../../public/js/crypto/keys.js";
import { loginSecret, newRecoveryCode, readRecoveryCode } from "../../public/js/recovery.js";

const USER = "user-1";
const prf = () => /** @type {Uint8Array<ArrayBuffer>} */ (crypto.getRandomValues(new Uint8Array(32)));
const code = () => recoveryKeyMaterial(/** @type {string} */ (readRecoveryCode(newRecoveryCode())));

/**
 * Encrypts with one key and decrypts with the other, to show they're the same key.
 * @param {CryptoKey} a
 * @param {CryptoKey} b
 */
async function sameKey(a, b) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, a, new TextEncoder().encode("hello"));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, b, sealed)) === "hello";
}

describe("wraps", () => {
  it("unwrap to the same key, with a passkey's PRF output or the recovery code", async () => {
    const key = await newDataKey();
    for (const [kind, secret] of /** @type {const} */ ([["passkey", prf()], ["recovery", code()]])) {
      const wrap = await wrapDataKey(key, { userId: USER, kind, secret });
      expect(wrap).toMatchObject({ kind, version: 1 });
      expect(fromBase64url(wrap.wrapped)).toHaveLength(48);
      expect(await sameKey(key, await unwrapDataKey(wrap, { userId: USER, secret }))).toBe(true);
    }
  });

  it("give a key that can't be exported, unless asked for to wrap it again", async () => {
    const secret = prf();
    const wrap = await wrapDataKey(await newDataKey(), { userId: USER, kind: "passkey", secret });
    const key = await unwrapDataKey(wrap, { userId: USER, secret });
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
    expect((await unwrapDataKey(wrap, { userId: USER, secret }, { extractable: true })).extractable).toBe(true);
  });

  it("don't unwrap with the wrong secret, for another user, or when passed off as another wrap", async () => {
    const secret = prf();
    const wrap = await wrapDataKey(await newDataKey(), { userId: USER, kind: "passkey", secret });
    const fails = (/** @type {any} */ w, /** @type {any} */ s, user = USER) => expect(unwrapDataKey(w, { userId: user, secret: s })).rejects.toThrow(WrongSecret);
    await fails(wrap, prf());
    await fails(wrap, secret, "user-2");
    await fails({ ...wrap, id: crypto.randomUUID() }, secret);
    await fails({ ...wrap, kind: "recovery" }, secret);
    await fails({ ...wrap, version: 2 }, secret);
  });

  it("use different keys for the recovery code's login secret and its wrapping key", async () => {
    const typed = /** @type {string} */ (readRecoveryCode(newRecoveryCode()));
    const wrap = await wrapDataKey(await newDataKey(), { userId: USER, kind: "recovery", secret: recoveryKeyMaterial(typed) });
    // The login secret, which the server knows a hash of, doesn't unwrap it.
    const login = fromBase64url(await loginSecret(typed));
    await expect(unwrapDataKey(wrap, { userId: USER, secret: login })).rejects.toThrow(WrongSecret);
  });

  it("use a fixed 32-byte PRF salt", async () => {
    expect(await prfSalt()).toEqual(await prfSalt());
    expect(await prfSalt()).toHaveLength(32);
  });
});
