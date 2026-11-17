// Signing in on a new device: the server's parsing (src/link/parse.js).
import { describe, it, expect } from "vitest";
import { parseNewLink, parsePoll, parseApproval, linkId, ENDED } from "../../src/link/parse.js";
import { BadInput } from "../../src/http.js";

const ID = "0b6e7a52-5e0c-4f8e-9d55-0d1b8c1d2e3f";
const b64 = (/** @type {number} */ n) => "A".repeat(n);

describe("link request parsing", () => {
  it("takes a public key of X-Wing's length only", () => {
    expect(parseNewLink({ public_key: b64(1622) })).toBe(b64(1622));
    for (const bad of [undefined, 1, b64(1621), b64(1623), b64(1621) + "+"]) {
      expect(() => parseNewLink({ public_key: bad })).toThrow(BadInput);
    }
  });

  it("takes a poll with a request id and a token", () => {
    expect(parsePoll({ id: ID, poll: b64(43) })).toEqual({ id: ID, poll: b64(43) });
    expect(() => parsePoll({ id: "x", poll: b64(43) })).toThrow(ENDED);
    expect(() => parsePoll({ id: ID, poll: b64(42) })).toThrow(ENDED);
  });

  it("takes a sealed key of its length only", () => {
    expect(parseApproval({ sealed_key: b64(1558) })).toBe(b64(1558));
    expect(() => parseApproval({ sealed_key: b64(1557) })).toThrow(BadInput);
    expect(() => parseApproval({})).toThrow(BadInput);
  });

  it("reads request ids in paths", () => {
    expect(linkId(ID)).toBe(ID);
    expect(linkId("approve")).toBeNull();
  });
});
