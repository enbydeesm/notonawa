import { describe, it, expect } from "vitest";
import { needsConsent, allowedWithoutConsent } from "../../src/consent/parse.js";

describe("needsConsent", () => {
  it("asks anyone who agreed to an older version, or none", () => {
    expect(needsConsent("2026-10-17T08:00:00Z", "2026-10-17T08:00:00Z")).toBe(false);
    expect(needsConsent("2026-11-01T00:00:00Z", "2026-10-17T08:00:00Z")).toBe(false);
    expect(needsConsent("2026-10-17T07:59:59Z", "2026-10-17T08:00:00Z")).toBe(true);
    expect(needsConsent(null, "2026-10-12-draft")).toBe(true);
  });

  it("orders the first, named draft before the dated versions", () => {
    expect(needsConsent("2026-10-12-draft", "2026-10-12-draft")).toBe(false);
    expect(needsConsent("2026-10-12-draft", "2026-10-17T08:00:00Z")).toBe(true);
    expect(needsConsent("2026-10-17T08:00:00Z", "2026-10-12-draft")).toBe(false);
  });
});

describe("allowedWithoutConsent", () => {
  it("allows reading, agreeing, the account, keys and notices", () => {
    expect(allowedWithoutConsent("GET", "/api/ties/123")).toBe(true);
    expect(allowedWithoutConsent("POST", "/api/consent")).toBe(true);
    expect(allowedWithoutConsent("DELETE", "/api/account")).toBe(true);
    expect(allowedWithoutConsent("PUT", "/api/keys/passkeys/abc")).toBe(true);
    expect(allowedWithoutConsent("POST", "/api/encryption/seal")).toBe(true);
    expect(allowedWithoutConsent("POST", "/api/notices/n1/dismiss")).toBe(true);
  });

  it("blocks anything that adds to or changes the journal", () => {
    expect(allowedWithoutConsent("POST", "/api/ties")).toBe(false);
    expect(allowedWithoutConsent("PUT", "/api/people/1")).toBe(false);
    expect(allowedWithoutConsent("POST", "/api/data/import/items")).toBe(false);
    expect(allowedWithoutConsent("POST", "/api/accounts-lookalike")).toBe(false);
  });
});
