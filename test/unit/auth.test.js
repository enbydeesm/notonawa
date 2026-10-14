// Sign-in's pure parts: session rules, the cookie, request guards, parsing,
// and codes. No database needed.
import { describe, it, expect } from "vitest";
import { isActive, needsTouch, isFresh, isoAt, newToken, sha256Hex, lifetimeMs } from "../../src/auth/session.js";
import { readSessionToken, sessionCookie, clearSessionCookie } from "../../src/auth/cookie.js";
import { isAllowedOrigin, allowedInRecovery, rateLimitKey } from "../../src/auth/guard.js";
import {
  parseSignUp, normaliseCode as serverNormalise, parseRecoverySecret, parsePasskeyName, parsePrfCapable,
  parseCredential, challengeOf,
} from "../../src/auth/parse.js";
import { newCode, base32, formatCode, normaliseCode } from "../../public/js/codes.js";
import { newRecoveryCode, readRecoveryCode, loginSecret } from "../../public/js/recovery.js";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

/**
 * @param {Partial<import("../../src/auth/session.js").Session>} changes
 * @returns {import("../../src/auth/session.js").Session}
 */
const session = (changes) => ({
  id: "s", user_id: "u", kind: "full",
  created_at: isoAt(NOW - DAY), last_used_at: isoAt(NOW - MIN), expires_at: isoAt(NOW + DAY),
  ...changes,
});

describe("session rules", () => {
  it("end at their expiry time", () => {
    expect(isActive(session({}), NOW)).toBe(true);
    expect(isActive(session({ expires_at: isoAt(NOW) }), NOW)).toBe(false);
  });

  it("end after 7 days unused (not recovery sessions, which are short anyway)", () => {
    expect(isActive(session({ last_used_at: isoAt(NOW - 6 * DAY) }), NOW)).toBe(true);
    expect(isActive(session({ last_used_at: isoAt(NOW - 7 * DAY) }), NOW)).toBe(false);
    expect(isActive(session({ kind: "recovery", last_used_at: isoAt(NOW - 8 * DAY) }), NOW)).toBe(true);
  });

  it("note use at most once an hour", () => {
    expect(needsTouch(session({ last_used_at: isoAt(NOW - 59 * MIN) }), NOW)).toBe(false);
    expect(needsTouch(session({ last_used_at: isoAt(NOW - 60 * MIN) }), NOW)).toBe(true);
  });

  it("count as fresh for 10 minutes after signing in; recovery sessions always", () => {
    expect(isFresh(session({ created_at: isoAt(NOW - 9 * MIN) }), NOW)).toBe(true);
    expect(isFresh(session({ created_at: isoAt(NOW - 10 * MIN) }), NOW)).toBe(false);
    expect(isFresh(session({ kind: "recovery", created_at: isoAt(NOW - 14 * MIN) }), NOW)).toBe(true);
  });

  it("last 30 days, or 15 minutes from a recovery code", () => {
    expect(lifetimeMs("full")).toBe(30 * DAY);
    expect(lifetimeMs("recovery")).toBe(15 * MIN);
  });

  it("write times like the database does", () => {
    expect(isoAt(Date.parse("2026-10-12T21:51:00.123Z"))).toBe("2026-10-12T21:51:00Z");
  });

  it("use random 256-bit tokens, stored only as a hash", async () => {
    const [a, b] = [newToken(), newToken()];
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(a).not.toBe(b);
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("the session cookie", () => {
  /** @param {string} cookie */
  const withCookie = (cookie) => new Request("http://localhost/", { headers: { cookie } });

  it("is read from among other cookies", () => {
    expect(readSessionToken(withCookie("a=1; __Host-session=tok123; b=2"))).toBe("tok123");
    expect(readSessionToken(withCookie("session=tok123"))).toBeNull();
    expect(readSessionToken(withCookie("__Host-session="))).toBeNull();
    expect(readSessionToken(new Request("http://localhost/"))).toBeNull();
  });

  it("is locked down, and cleared by expiring it", () => {
    expect(sessionCookie("t", 60)).toBe("__Host-session=t; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=60");
    expect(clearSessionCookie()).toMatch(/^__Host-session=; .*Max-Age=0$/);
  });
});

describe("request guards", () => {
  const ORIGIN = "https://rope.example.com";
  /** @param {string} method @param {Record<string, string>} [headers] */
  const req = (method, headers = {}) => new Request(`${ORIGIN}/api/x`, { method, headers });

  it("allow reads from anywhere, but writes only from the app", () => {
    expect(isAllowedOrigin(req("GET"), ORIGIN)).toBe(true);
    expect(isAllowedOrigin(req("POST", { origin: ORIGIN }), ORIGIN)).toBe(true);
    expect(isAllowedOrigin(req("POST", { origin: "https://evil.example" }), ORIGIN)).toBe(false);
    expect(isAllowedOrigin(req("DELETE"), ORIGIN)).toBe(false);
    expect(isAllowedOrigin(req("PUT", { origin: "null" }), ORIGIN)).toBe(false);
  });

  it("let a recovery session only see the account", () => {
    expect(allowedInRecovery("GET", "/api/account")).toBe(true);
    expect(allowedInRecovery("PUT", "/api/account/recovery-code")).toBe(false);
    expect(allowedInRecovery("PUT", "/api/account/recovery-email")).toBe(false);
    expect(allowedInRecovery("GET", "/api/tags")).toBe(false);
  });

  it("count attempts by IP address", () => {
    expect(rateLimitKey(req("POST", { "cf-connecting-ip": "192.0.2.1" }))).toBe("192.0.2.1");
    expect(rateLimitKey(req("POST"))).toBe("unknown");
  });
});

describe("parsing sign-in requests", () => {
  it("needs 18+ and consent, as true, and a 16-character invite", () => {
    expect(parseSignUp({ adult: true, consent: true, invite: "abcd-efgh-jkmn-pqrs" })).toEqual({ invite: "ABCDEFGHJKMNPQRS" });
    expect(() => parseSignUp({ adult: "yes", consent: true, invite: "ABCDEFGHJKMNPQRS" })).toThrow(/18 or older/);
    expect(() => parseSignUp({ adult: true, consent: 1, invite: "ABCDEFGHJKMNPQRS" })).toThrow(/privacy policy/);
    expect(() => parseSignUp({ adult: true, consent: true, invite: "ABCD" })).toThrow(/doesn't look right/);
  });

  it("only takes a 32-byte base64url recovery secret", () => {
    const secret = "A".repeat(43);
    expect(parseRecoverySecret(secret)).toBe(secret);
    for (const bad of ["A".repeat(42), "A".repeat(44), "+".repeat(43), 5, null]) {
      expect(() => parseRecoverySecret(bad)).toThrow("That recovery code didn't work.");
    }
  });

  it("names passkeys, with a default and a limit", () => {
    expect(parsePasskeyName("  My phone ")).toBe("My phone");
    expect(parsePasskeyName("")).toBe("Passkey");
    expect(() => parsePasskeyName("x".repeat(61))).toThrow(/60 characters/);
  });

  it("records whether a passkey can make encryption keys, or that we don't know", () => {
    expect([parsePrfCapable(true), parsePrfCapable(false), parsePrfCapable(undefined), parsePrfCapable("yes")]).toEqual([1, 0, null, null]);
  });

  it("finds the challenge a passkey signed", () => {
    const clientDataJSON = btoa(JSON.stringify({ type: "webauthn.get", challenge: "abc_-123" })).replace(/=+$/, "");
    const credential = parseCredential({ id: "x", response: { clientDataJSON } });
    expect(challengeOf(credential)).toBe("abc_-123");
    expect(() => parseCredential({ id: "x" })).toThrow(/Couldn't read/);
    expect(() => challengeOf({ response: { clientDataJSON: "not json" } })).toThrow(/Couldn't read/);
  });
});

describe("codes", () => {
  it("are Crockford base32 in groups of 4", () => {
    expect(base32(Uint8Array.of(0, 0, 0, 0, 0))).toBe("00000000");
    expect(base32(Uint8Array.of(255, 255, 255, 255, 255))).toBe("ZZZZZZZZ");
    expect(base32(new TextEncoder().encode("hello"))).toBe("D1JPRV3F");
    expect(formatCode("ABCDEFGHJK")).toBe("ABCD-EFGH-JK");
    expect(newCode(10)).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  });

  it("are read forgivingly, the same way by the pages and the Worker", () => {
    for (const typed of ["abcd-efgh", " ABCD EFGH ", "o0il1", "abcd-u", "", "ab!", 42]) {
      expect(serverNormalise(typed)).toBe(normaliseCode(typed));
    }
    expect(normaliseCode("o0il-1")).toBe("00111");
    expect(normaliseCode("abcu")).toBeNull();
  });

  it("make 32-character recovery codes, read only at full length", () => {
    const code = newRecoveryCode();
    expect(code).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    expect(readRecoveryCode(code.toLowerCase())).toBe(code.replace(/-/g, ""));
    expect(readRecoveryCode(code.slice(0, -1))).toBeNull();
  });

  it("turn a recovery code into a fixed login secret that doesn't contain it", async () => {
    const code = /** @type {string} */ (readRecoveryCode(newRecoveryCode()));
    const secret = await loginSecret(code);
    expect(secret).toMatch(/^[\w-]{43}$/);
    expect(await loginSecret(code)).toBe(secret);
    expect(await loginSecret(code.replace(/^./, (c) => (c === "0" ? "1" : "0")))).not.toBe(secret);
    expect(secret).not.toContain(code.slice(0, 8));
  });
});
