import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import { SECURITY_HEADERS } from "../../src/security-headers.js";
import { ORIGIN, signedInUser } from "../helpers.js";

describe("security headers on API responses", () => {
  /** @type {[string, string, RequestInit, number, boolean][]} what, path, request, status, signed in */
  const cases = [
    ["a successful read", "/api/tags", {}, 200, true],
    ["a bad request", "/api/people?archived=maybe", {}, 400, true],
    ["a request that isn't signed in", "/api/tags", {}, 401, false],
    ["an unknown route", "/api/nope", {}, 404, true],
    ["a search", "/api/ties/search", { method: "POST", body: "{}" }, 200, true],
    ["a write from another site", "/api/ties/search", { method: "POST", body: "{}", headers: { origin: "https://evil.example" } }, 403, true],
  ];

  for (const [what, path, init, status, signedIn] of cases) {
    it(`are on ${what}, which is never cached`, async () => {
      const headers = new Headers(init.headers);
      if (signedIn) headers.set("cookie", (await signedInUser()).cookie);
      if (init.method === "POST" && !headers.has("origin")) headers.set("origin", ORIGIN);
      const res = await SELF.fetch(ORIGIN + path, { ...init, headers });
      await res.arrayBuffer();
      expect(res.status).toBe(status);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name)).toBe(value);
    });
  }
});
