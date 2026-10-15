// Encrypted text fields (public/js/crypto/fields.js), and the server's check
// of their format (src/parse.js encryptedText), which must agree.
import { describe, it, expect } from "vitest";
import {
  sealText, openText, sealRecord, openRecord, isSealed, ENCRYPTED, CantOpen, MAX_SEALED_LENGTH,
} from "../../public/js/crypto/fields.js";
import { newDataKey } from "../../public/js/crypto/keys.js";
import { encryptedText, MAX_ENCRYPTED_LENGTH } from "../../src/parse.js";
import { ENCRYPTED_COLUMNS } from "../../src/encryption/config.js";
import { BadInput } from "../../src/http.js";

const USER = "user-1";
const where = { userId: USER, table: "ties", field: "notes" };

describe("sealed fields", () => {
  it("open to the trimmed text; empty text is null", async () => {
    const key = await newDataKey();
    const sealed = await sealText(key, where, "  Went well, ö and 🙂  ");
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain("Went");
    expect(await openText(key, where, sealed)).toBe("Went well, ö and 🙂");
    expect(await sealText(key, where, "   ")).toBeNull();
    expect(await sealText(key, where, null)).toBeNull();
    // The same text sealed twice looks different.
    expect(await sealText(key, where, "x")).not.toBe(await sealText(key, where, "x"));
  });

  it("don't open for another user, table or field, or with another key", async () => {
    const key = await newDataKey();
    const sealed = await sealText(key, where, "secret");
    for (const other of [{ ...where, userId: "user-2" }, { ...where, table: "people" }, { ...where, table: "plans", field: "description" }]) {
      await expect(openText(key, other, sealed)).rejects.toThrow(CantOpen);
    }
    await expect(openText(await newDataKey(), where, sealed)).rejects.toThrow(CantOpen);
  });

  it("pass plain text from before encryption through as it is", async () => {
    expect(await openText(await newDataKey(), where, "old plain notes")).toBe("old plain notes");
  });

  it("seal and open whole records, only their kind's fields", async () => {
    const key = await newDataKey();
    const plan = { id: "p1", title: "TK", description: "Steps", notes: null };
    const sealed = await sealRecord(key, USER, "plan", plan);
    expect(sealed.title).toBe("TK");
    expect(isSealed(sealed.description)).toBe(true);
    expect(sealed.notes).toBeNull();
    expect(await openRecord(key, USER, "plan", sealed)).toEqual(plan);
    // Already sealed: kept, not sealed twice.
    expect((await sealRecord(key, USER, "plan", sealed)).description).toBe(sealed.description);
  });

  it("mark a field that won't open, rather than failing the record", async () => {
    const key = await newDataKey();
    const sealed = await sealRecord(await newDataKey(), USER, "person", { id: "x", name: "Sam", notes: "hi" });
    expect(await openRecord(key, USER, "person", sealed)).toEqual({ id: "x", name: "Sam", notes: null, unreadable: ["notes"] });
  });
});

describe("the server's check of sealed fields", () => {
  it("accepts what the browser seals, and nothing empty", async () => {
    const key = await newDataKey();
    const sealed = /** @type {string} */ (await sealText(key, where, "notes"));
    expect(encryptedText(sealed)).toBe(sealed);
    expect(encryptedText(null)).toBeNull();
    expect(encryptedText("")).toBeNull();
    expect(MAX_ENCRYPTED_LENGTH).toBe(MAX_SEALED_LENGTH);
  });

  it("refuses plain text, or anything else that isn't sealed", () => {
    for (const value of ["Went well", "e1.short.x", "e2.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA", 42, `e1.${"A".repeat(16)}.${"A".repeat(MAX_ENCRYPTED_LENGTH)}`]) {
      expect(() => encryptedText(value)).toThrow(BadInput);
    }
  });

  it("lists the same tables and fields as the browser", () => {
    const browser = Object.fromEntries(Object.values(ENCRYPTED).map((k) => [k.table, [...k.fields]]));
    expect(ENCRYPTED_COLUMNS).toEqual(browser);
  });
});
