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

/**
 * Each block of public/_headers: its path, then its lines as written.
 * @param {string} text
 */
function blocks(text) {
  /** @type {Record<string, string[]>} */
  const found = {};
  let path = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || !line.trim()) continue;
    if (!/^\s/.test(line)) found[path = line.trim()] = [];
    else found[path].push(line.trim());
  }
  return found;
}

describe("public/_headers caching", () => {
  // Two values for one header are joined with a comma, so each block must
  // take off the "/*" block's no-store ("! Cache-Control") before its own.
  it("replaces no-store for the code, styles, images and the poser's body only", () => {
    const { "/*": _all, ...rest } = blocks(staticHeaders);
    expect(rest).toEqual({
      "/js/*": ["! Cache-Control", "Cache-Control: no-cache"],
      "/app.css": ["! Cache-Control", "Cache-Control: no-cache"],
      "/img/*": ["! Cache-Control", "Cache-Control: max-age=604800"],
      "/figure/*": ["! Cache-Control", "Cache-Control: max-age=604800"],
    });
  });

  it("keeps the page itself no-store (and out of the back/forward cache)", () => {
    expect(headersForAllFiles(staticHeaders)["cache-control"]).toBe("no-store");
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
