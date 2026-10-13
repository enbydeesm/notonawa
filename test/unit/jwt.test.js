import { describe, it, expect, beforeAll } from "vitest";
import {
  verifyAccessJwt, normaliseTeamDomain, createAccessKeyStore,
} from "../../src/auth/jwt.js";

const TEAM = "https://team.cloudflareaccess.com";
const AUD = "AUD1";
const settings = { teamDomain: TEAM, aud: AUD };
const algorithm = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };

/** @type {CryptoKeyPair} */ let keys;
/** @type {CryptoKeyPair} */ let otherKeys;

beforeAll(async () => {
  keys = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]));
  otherKeys = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]));
});

/** @param {string | Uint8Array} data */
function b64url(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * @param {Record<string, unknown>} payload
 * @param {CryptoKey} [privateKey]
 */
async function sign(payload, privateKey = keys.privateKey) {
  const header = b64url(JSON.stringify({ alg: "RS256", kid: "k1" }));
  const body = b64url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(new Uint8Array(signature))}`;
}

const NOW = 1_800_000_000;
const good = { email: "me@example.com", iss: TEAM, aud: [AUD], exp: NOW + 600 };
/** @type {import("../../src/auth/jwt.js").KeyLookup} */
const getKey = async (_team, kid) => (kid === "k1" ? keys.publicKey : null);
/** @param {string} token */
const verify = (token) => verifyAccessJwt(token, settings, getKey, NOW);

describe("verifyAccessJwt", () => {
  it("returns the email from a valid token", async () => {
    expect(await verify(await sign(good))).toBe("me@example.com");
  });

  it("accepts a single-string audience", async () => {
    expect(await verify(await sign({ ...good, aud: AUD }))).toBe("me@example.com");
  });

  it("rejects an expired token", async () => {
    expect(await verify(await sign({ ...good, exp: NOW - 10 }))).toBeNull();
  });

  it("rejects a token for another application", async () => {
    expect(await verify(await sign({ ...good, aud: ["SOMEONE-ELSE"] }))).toBeNull();
  });

  it("rejects a token from another Access team", async () => {
    expect(await verify(await sign({ ...good, iss: "https://evil.cloudflareaccess.com" }))).toBeNull();
  });

  it("rejects a token signed with a different key", async () => {
    expect(await verify(await sign(good, otherKeys.privateKey))).toBeNull();
  });

  it("rejects a token whose payload was changed after signing", async () => {
    const [header, , signature] = (await sign(good)).split(".");
    const tampered = `${header}.${b64url(JSON.stringify({ ...good, email: "attacker@example.com" }))}.${signature}`;
    expect(await verify(tampered)).toBeNull();
  });

  it("rejects malformed tokens and unknown keys", async () => {
    expect(await verify("a.b.c")).toBeNull();
    expect(await verify("not-a-jwt")).toBeNull();
    const unknownKid = (await sign(good)).replace(/^[^.]+/, b64url(JSON.stringify({ alg: "RS256", kid: "k2" })));
    expect(await verify(unknownKid)).toBeNull();
  });

  it("rejects tokens using a different algorithm", async () => {
    const [, body, signature] = (await sign(good)).split(".");
    const none = `${b64url(JSON.stringify({ alg: "none", kid: "k1" }))}.${body}.${signature}`;
    expect(await verify(none)).toBeNull();
  });

  it("rejects a token without an email", async () => {
    expect(await verify(await sign({ ...good, email: undefined }))).toBeNull();
  });
});

describe("normaliseTeamDomain", () => {
  it("adds https:// and drops trailing slashes", () => {
    expect(normaliseTeamDomain("team.cloudflareaccess.com/")).toBe(TEAM);
    expect(normaliseTeamDomain(" https://team.cloudflareaccess.com ")).toBe(TEAM);
  });
  it("returns null when unset", () => {
    expect(normaliseTeamDomain("")).toBeNull();
    expect(normaliseTeamDomain(undefined)).toBeNull();
  });
});

describe("createAccessKeyStore", () => {
  it("fetches Access's keys once and caches them", async () => {
    const jwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "k1" };
    /** @type {string[]} */
    const fetched = [];
    /** @type {any} */
    const fakeFetch = async (/** @type {string} */ url) => {
      fetched.push(url);
      return new Response(JSON.stringify({ keys: [jwk] }));
    };
    const getKeyFromStore = createAccessKeyStore(fakeFetch);

    expect(await getKeyFromStore(TEAM, "k1")).not.toBeNull();
    expect(await getKeyFromStore(TEAM, "k1")).not.toBeNull();
    expect(fetched).toEqual([`${TEAM}/cdn-cgi/access/certs`]);

    // A token verified with the fetched key works end to end.
    expect(await verifyAccessJwt(await sign(good), settings, getKeyFromStore, NOW)).toBe("me@example.com");
  });

  it("returns null when the keys can't be fetched", async () => {
    /** @type {any} */
    const failingFetch = async () => new Response("nope", { status: 500 });
    expect(await createAccessKeyStore(failingFetch)(TEAM, "k1")).toBeNull();
  });
});
