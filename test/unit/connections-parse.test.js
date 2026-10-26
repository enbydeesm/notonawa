// Parsing connection requests (src/connections/parse.js).
import { describe, it, expect } from "vitest";
import { parseAccept, parseConnectionId, parseOfferToken, parseAboutChoice, newOfferToken } from "../../src/connections/parse.js";
import { parseNewShare } from "../../src/shares/parse.js";
import { BadInput } from "../../src/http.js";
import { sealed } from "../sealed.js";

describe("offer tokens", () => {
  it("are 32 random bytes, base64url, and nothing else is taken", () => {
    const token = newOfferToken();
    expect(parseOfferToken(token)).toBe(token);
    expect(newOfferToken()).not.toBe(token);
    for (const bad of [undefined, 42, "", token.slice(1), `${token}=`, token.replace(/.$/, "+")]) {
      expect(() => parseOfferToken(bad)).toThrow(BadInput);
    }
  });
});

describe("accepting", () => {
  it("takes the offer, a person and a sealed label", () => {
    const offer = newOfferToken();
    expect(parseAccept({ offer, person_id: " p1 ", label: sealed("Alex") })).toEqual({ offer, personId: "p1", label: sealed("Alex") });
    expect(parseAccept({ offer, person_id: "p1" })).toMatchObject({ label: null });
  });

  it("refuses a label that isn't sealed, or no person", () => {
    const offer = newOfferToken();
    expect(() => parseAccept({ offer, person_id: "p1", label: "Alex" })).toThrow("wasn't encrypted");
    expect(() => parseAccept({ offer, person_id: "" })).toThrow("Choose who");
    expect(() => parseAccept({ offer, person_id: 5 })).toThrow("Choose who");
  });
});

describe("connection ids", () => {
  it("are UUIDs", () => {
    const id = crypto.randomUUID();
    expect(parseConnectionId(id)).toBe(id);
    expect(() => parseConnectionId("../people")).toThrow(BadInput);
    expect(() => parseConnectionId(id.toUpperCase())).toThrow(BadInput);
  });
});

describe("removing", () => {
  it("needs the About choice said", () => {
    expect(parseAboutChoice("remove")).toBe(true);
    expect(parseAboutChoice("keep")).toBe(false);
    expect(() => parseAboutChoice(null)).toThrow(BadInput);
    expect(() => parseAboutChoice("yes")).toThrow(BadInput);
  });
});

describe("a share's connect", () => {
  const share = { id: "AAAAAAAAAAAAAAAAAAAAAA", link_key: sealed("key"), expires: "1d", snapshot: "A".repeat(40) };

  it("is off unless asked for, and only on a profile invite", () => {
    expect(parseNewShare({ ...share, kind: "profile" }).connect).toBe(0);
    expect(parseNewShare({ ...share, kind: "profile", connect: true }).connect).toBe(1);
    expect(() => parseNewShare({ ...share, kind: "tie", connect: true })).toThrow("Only a profile invite");
  });
});
