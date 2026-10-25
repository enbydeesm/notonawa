import { describe, it, expect } from "vitest";
import {
  EXPIRY_CHOICES, DEFAULT_EXPIRY, maxUsesFor, shareWarning, endsText, usesText, shareLink,
} from "../../public/js/share-options.js";
import { EXPIRY } from "../../src/shares/parse.js";
import { readShareFragment } from "../../public/js/crypto/share.js";

describe("the share's choices", () => {
  it("offers exactly the expiries the server takes, a day by default", () => {
    expect(EXPIRY_CHOICES.map((c) => c.value)).toEqual(Object.keys(EXPIRY));
    expect(DEFAULT_EXPIRY).toBe("1d");
  });

  it("is one use for one person, any number for anyone", () => {
    expect([maxUsesFor("one"), maxUsesFor("any")]).toEqual([1, null]);
  });

  it("warns only about a code anyone can use for good", () => {
    expect(shareWarning("never", "any")).toMatch("Anyone who ever sees this code");
    expect([shareWarning("never", "one"), shareWarning("30d", "any"), shareWarning("1d", "one")]).toEqual([null, null, null]);
  });
});

describe("Shared by me's words", () => {
  const NOW = Date.parse("2026-10-24T12:00:00Z");
  it("says when a share ends", () => {
    expect(endsText(null, NOW)).toBe("until you revoke it");
    expect(endsText("2026-10-24T12:01:00Z", NOW)).toBe("ends in 1 minute");
    expect(endsText("2026-10-24T15:00:00Z", NOW)).toBe("ends in 3 hours");
    expect(endsText("2026-10-31T12:00:00Z", NOW)).toBe("ends in 7 days");
  });

  it("says how much it's been used", () => {
    expect([usesText(0, 1), usesText(0, null)]).toEqual(["not opened yet", "not opened yet"]);
    expect(usesText(2, 5)).toBe("opened 2 of 5 times");
    expect([usesText(1, null), usesText(3, null)]).toEqual(["opened once", "opened 3 times"]);
  });
});

describe("shareLink", () => {
  it("puts the id and key after #, where the page reads them back", () => {
    const id = "AbCdEfGhIjKlMnOpQrStUv";
    const key = "A".repeat(43);
    const link = shareLink("https://notonawa.app", id, key);
    expect(link).toBe(`https://notonawa.app/open#${id}.${key}`);
    expect(readShareFragment(new URL(link).hash)?.id).toBe(id);
  });
});
