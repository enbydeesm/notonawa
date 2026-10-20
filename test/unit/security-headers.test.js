import { describe, it, expect } from "vitest";
import { SECURITY_HEADERS, withSecurityHeaders } from "../../src/security-headers.js";
import staticHeaders from "../../public/_headers?raw";

/**
 * The headers public/_headers gives every static file (its "/*" block), by
 * lower-case name.
 * @param {string} text
 */
function headersForAllFiles(text) {
  /** @type {Record<string, string>} */
  const headers = {};
  let inBlock = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || !line.trim()) continue;
    if (!/^\s/.test(line)) { inBlock = line.trim() === "/*"; continue; }
    if (!inBlock) continue;
    const colon = line.indexOf(":");
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return headers;
}

describe("SECURITY_HEADERS and public/_headers", () => {
  // Each has its own CSP (the API needs no scripts); everything else must
  // match, or the Worker's responses quietly miss a header the pages have.
  it("share every header but the CSP", () => {
    const withoutCsp = (/** @type {Record<string, string>} */ h) =>
      Object.fromEntries(Object.entries(h).filter(([name]) => name !== "content-security-policy"));
    const fromFile = withoutCsp(headersForAllFiles(staticHeaders));
    expect(Object.keys(fromFile).length).toBeGreaterThan(5);
    expect(withoutCsp(SECURITY_HEADERS)).toEqual(fromFile);
  });
});

describe("withSecurityHeaders", () => {
  it("adds every header and keeps the status, body and other headers", async () => {
    const res = withSecurityHeaders(new Response("hi", { status: 418, headers: { "content-type": "text/plain" } }));
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name)).toBe(value);
    expect(res.status).toBe(418);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await res.text()).toBe("hi");
  });

  it("keeps a header the response already has (a page's own CSP)", () => {
    const pageCsp = "default-src 'none'; script-src 'self'";
    const res = withSecurityHeaders(new Response("", { headers: { "Content-Security-Policy": pageCsp } }));
    expect(res.headers.get("content-security-policy")).toBe(pageCsp);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("works on responses whose headers can't be changed", () => {
    const locked = Response.redirect("https://example.com/", 302);
    expect(withSecurityHeaders(locked).headers.get("x-frame-options")).toBe("DENY");
  });
});
