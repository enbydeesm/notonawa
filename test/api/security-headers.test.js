import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import { SECURITY_HEADERS } from "../../src/security-headers.js";

/**
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function headersOf(url, init) {
  const res = await SELF.fetch(url, init);
  await res.arrayBuffer();
  return { status: res.status, headers: res.headers };
}

describe("security headers on API responses", () => {
  const cases = [
    ["a successful read", "http://localhost/api/tags", undefined, 200],
    ["a bad request", "http://localhost/api/people?archived=maybe", undefined, 400],
    ["a request that isn't signed in", "https://rope.example.com/api/tags", undefined, 401],
    ["an unknown route", "http://localhost/api/nope", undefined, 404],
    ["a search", "http://localhost/api/ties/search", { method: "POST", body: "{}" }, 200],
  ];

  for (const [what, url, init, status] of cases) {
    it(`are on ${what}, which is never cached`, async () => {
      const res = await headersOf(/** @type {string} */ (url), /** @type {RequestInit | undefined} */ (init));
      expect(res.status).toBe(status);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name)).toBe(value);
    });
  }
});
