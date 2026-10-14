// Recovery emails: the browser's hashing (public/js/recovery-email.js) and
// the server's check of what it sends (src/account/parse.js).
import { describe, it, expect } from "vitest";
import { readRecoveryEmail, newRecoveryEmailHash, hashRecoveryEmail } from "../../public/js/recovery-email.js";
import { parseRecoveryEmail } from "../../src/account/parse.js";
import { BadInput } from "../../src/http.js";

describe("readRecoveryEmail", () => {
  it("trims and lower-cases an address, so it hashes the same however it's typed", () => {
    expect(readRecoveryEmail("  Sam.Smith@Example.COM ")).toBe("sam.smith@example.com");
  });

  it("refuses what isn't an address", () => {
    for (const typed of ["", "sam", "sam@", "@example.com", "sam@example", "sam smith@example.com", "a@b@c.com", null, 42]) {
      expect(readRecoveryEmail(typed)).toBeNull();
    }
    expect(readRecoveryEmail(`${"a".repeat(250)}@b.co`)).toBeNull();
  });
});

describe("recovery email hashes", () => {
  it("are 32 bytes with a 16-byte salt, and never contain the address", async () => {
    const { email_hash, salt } = await newRecoveryEmailHash("sam@example.com");
    expect(email_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(salt).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(parseRecoveryEmail({ email_hash, salt })).toEqual({ emailHash: email_hash, salt });
  });

  it("match for the same address and salt, and differ with another salt or address", async () => {
    const { email_hash, salt } = await newRecoveryEmailHash("sam@example.com");
    expect(await hashRecoveryEmail("sam@example.com", salt)).toBe(email_hash);
    expect(await hashRecoveryEmail("alex@example.com", salt)).not.toBe(email_hash);
    expect((await newRecoveryEmailHash("sam@example.com")).email_hash).not.toBe(email_hash);
  });
});

describe("parseRecoveryEmail", () => {
  it("refuses the address itself, or a missing or malformed hash or salt", () => {
    const salt = "s".repeat(22);
    for (const body of [{ email: "sam@example.com" }, { email_hash: "sam@example.com", salt }, { email_hash: "h".repeat(43) },
      { email_hash: "h".repeat(42), salt }, { email_hash: "h".repeat(43), salt: "s".repeat(23) }]) {
      expect(() => parseRecoveryEmail(body)).toThrow(BadInput);
    }
  });
});
