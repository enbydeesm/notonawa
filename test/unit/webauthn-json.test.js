// Passkey JSON <-> binary conversions for older browsers (public/js/webauthn-json.js).
import { describe, it, expect } from "vitest";
import {
  fromBase64url, toBase64url, creationOptionsFromJSON, requestOptionsFromJSON,
  registrationToJSON, authenticationToJSON, withoutPrfResults,
} from "../../public/js/webauthn-json.js";

const bytes = (/** @type {number[]} */ ...b) => Uint8Array.from(b);

describe("base64url", () => {
  it("round-trips any bytes, without padding or + and /", () => {
    const data = bytes(251, 255, 191, 0, 1);
    expect(toBase64url(data)).toBe("-_-_AAE");
    expect([...fromBase64url("-_-_AAE")]).toEqual([...data]);
    expect(toBase64url(data.buffer)).toBe("-_-_AAE");
    expect(toBase64url(new Uint8Array(data.buffer, 1, 2))).toBe("_78");
  });
});

describe("options from the server", () => {
  it("turn ids and challenges into bytes for create()", () => {
    const options = creationOptionsFromJSON({
      challenge: "AAE", rp: { name: "Rope Journal" }, user: { id: "AgM", name: "x" },
      excludeCredentials: [{ id: "BAU", transports: ["internal"] }],
    });
    expect([...options.challenge]).toEqual([0, 1]);
    expect([...options.user.id]).toEqual([2, 3]);
    expect(options.excludeCredentials[0]).toMatchObject({ type: "public-key", transports: ["internal"] });
    expect([...options.excludeCredentials[0].id]).toEqual([4, 5]);
    expect(options.rp).toEqual({ name: "Rope Journal" });
  });

  it("turn the challenge into bytes for get(), with no passkey list", () => {
    const options = requestOptionsFromJSON({ challenge: "AAE", userVerification: "required" });
    expect([...options.challenge]).toEqual([0, 1]);
    expect(options.allowCredentials).toEqual([]);
    expect(options.userVerification).toBe("required");
  });
});

describe("answers for the server", () => {
  const common = { id: "id1", rawId: bytes(1).buffer, type: "public-key", authenticatorAttachment: "platform", getClientExtensionResults: () => ({ prf: { enabled: true } }) };

  it("encode a new passkey", () => {
    expect(registrationToJSON({
      ...common,
      response: { clientDataJSON: bytes(2).buffer, attestationObject: bytes(3).buffer, getTransports: () => ["internal", "hybrid"] },
    })).toEqual({
      id: "id1", rawId: "AQ", type: "public-key", authenticatorAttachment: "platform",
      clientExtensionResults: { prf: { enabled: true } },
      response: { clientDataJSON: "Ag", attestationObject: "Aw", transports: ["internal", "hybrid"] },
    });
  });

  it("encode a sign-in, with or without a user handle", () => {
    const response = { clientDataJSON: bytes(2).buffer, authenticatorData: bytes(3).buffer, signature: bytes(4).buffer, userHandle: bytes(5).buffer };
    expect(authenticationToJSON({ ...common, response }).response)
      .toEqual({ clientDataJSON: "Ag", authenticatorData: "Aw", signature: "BA", userHandle: "BQ" });
    expect(authenticationToJSON({ ...common, response: { ...response, userHandle: null } }).response.userHandle).toBeUndefined();
  });
});

describe("withoutPrfResults", () => {
  it("takes the PRF output out of an answer, keeping whether it was given and the rest", () => {
    const answer = {
      id: "id1", response: { clientDataJSON: "Ag" },
      clientExtensionResults: { credProps: { rk: true }, prf: { enabled: true, results: { first: "c2VjcmV0" } } },
    };
    const sent = withoutPrfResults(answer);
    expect(sent).toEqual({ id: "id1", response: { clientDataJSON: "Ag" }, clientExtensionResults: { credProps: { rk: true }, prf: { enabled: true } } });
    expect(JSON.stringify(sent)).not.toContain("c2VjcmV0");
    // The original isn't changed (the caller still needs the output).
    expect(answer.clientExtensionResults.prf.results.first).toBe("c2VjcmV0");
  });

  it("leaves an answer without PRF as it is", () => {
    const answer = { id: "id1", clientExtensionResults: {} };
    expect(withoutPrfResults(answer)).toBe(answer);
  });
});
