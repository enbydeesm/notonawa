// Web Push encryption and VAPID (src/push/webpush.js).
import { describe, it, expect } from "vitest";
import { encryptPayload, vapidAuthorization, pushRequest, newVapidKeys, fromBase64url, toBase64url, MAX_PAYLOAD } from "../../src/push/webpush.js";

// RFC 8291, appendix A: its example's keys, salt and message, and the body it gives.
const RFC = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  serverPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  serverPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

describe("encryptPayload", () => {
  it("gives RFC 8291's example body from its keys and salt", async () => {
    const body = await encryptPayload(fromBase64url(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, {
      salt: fromBase64url(RFC.salt), serverPublic: fromBase64url(RFC.serverPublic), serverPrivate: fromBase64url(RFC.serverPrivate),
    });
    expect(toBase64url(body)).toBe(RFC.body);
  });
});

describe("encryptPayload, unfixed", () => {
  it("uses a new salt and key pair each time, with the record size and key id in its header", async () => {
    const device = { p256dh: RFC.uaPublic, auth: RFC.auth };
    const a = await encryptPayload(new TextEncoder().encode("hi"), device);
    const b = await encryptPayload(new TextEncoder().encode("hi"), device);
    expect(toBase64url(a.subarray(0, 16))).not.toBe(toBase64url(b.subarray(0, 16)));
    expect(new DataView(a.buffer).getUint32(16)).toBe(4096);
    expect(a[20]).toBe(65);
    expect(a.length).toBe(21 + 65 + 2 + 1 + 16);
  });

  it("refuses a payload too long for one push", async () => {
    await expect(encryptPayload(new Uint8Array(MAX_PAYLOAD + 1), { p256dh: RFC.uaPublic, auth: RFC.auth })).rejects.toThrow("too long");
    expect((await encryptPayload(new Uint8Array(MAX_PAYLOAD), { p256dh: RFC.uaPublic, auth: RFC.auth })).length).toBe(4096);
  });
});

describe("VAPID", () => {
  it("signs a JWT for the push service's origin that our public key verifies", async () => {
    const keys = await newVapidKeys();
    expect(fromBase64url(keys.publicKey)).toHaveLength(65);
    expect(fromBase64url(keys.privateKey)).toHaveLength(32);
    const now = Date.parse("2026-11-17T00:00:00Z");
    const header = await vapidAuthorization({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", ...keys, subject: "mailto:contact@notonawa.app", now });
    const [, jwt, k] = /** @type {RegExpMatchArray} */ (header.match(/^vapid t=([^,]+), k=(.+)$/));
    expect(k).toBe(keys.publicKey);
    const [head, claims, signature] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromBase64url(head)))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(new TextDecoder().decode(fromBase64url(claims))))
      .toEqual({ aud: "https://fcm.googleapis.com", exp: now / 1000 + 12 * 3600, sub: "mailto:contact@notonawa.app" });
    const pub = await crypto.subtle.importKey("raw", fromBase64url(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, fromBase64url(signature),
      new TextEncoder().encode(`${head}.${claims}`))).toBe(true);
  });

  it("builds the request with its headers", async () => {
    const keys = await newVapidKeys();
    const { url, init } = await pushRequest({ endpoint: "https://web.push.apple.com/x", p256dh: RFC.uaPublic, auth: RFC.auth },
      { title: "T" }, { topic: "connections", ttl: 86400, subject: "mailto:contact@notonawa.app", ...keys });
    expect(url).toBe("https://web.push.apple.com/x");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "content-encoding": "aes128gcm", ttl: "86400", topic: "connections", urgency: "normal" });
    expect(/** @type {any} */ (init.headers).authorization).toMatch(/^vapid t=.+, k=/);
  });
});
