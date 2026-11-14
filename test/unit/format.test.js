// The format gate (src/format.js): which routes each format may use.
import { describe, it, expect } from "vitest";
import { formatRefusal, routeFormat, newAccountFormat } from "../../src/format.js";

const V1 = /** @type {const} */ ({ format: 1, converting: false });
const CONVERTING = /** @type {const} */ ({ format: 1, converting: true });
const V2 = /** @type {const} */ ({ format: 2, converting: false });

describe("routeFormat", () => {
  it("knows the format 1 journal, format 2's routes, and the rest", () => {
    for (const path of [
      "/api/ties/search", "/api/ties/abc", "/api/ties/recent/people", "/api/workshops", "/api/plans", "/api/people/abc/restore",
      "/api/locations", "/api/tags", "/api/stats/ties", "/api/data/import/ties", "/api/media/abc/thumb",
      "/api/drawings", "/api/poses/abc", "/api/pose-presets", "/api/visuals/order", "/api/encryption/seal", "/api/connections/abc/person",
    ]) expect(routeFormat(path), path).toBe("v1");
    for (const path of ["/api/sync", "/api/records", "/api/files/abc/full", "/api/identity"]) expect(routeFormat(path), path).toBe("v2");
    expect(routeFormat("/api/mailboxes/messages")).toBe("v2-only");
    for (const path of ["/api/locations/coords", "/api/account", "/api/account/settings", "/api/keys", "/api/shares/open", "/api/convert/start",
      "/api/notices", "/api/consent", "/api/feedback", "/api/tiesx", "/api/datax"]) {
      expect(routeFormat(path), path).toBeNull();
    }
  });
});

describe("formatRefusal", () => {
  it("lets format 1 use its journal, and not format 2's routes", () => {
    expect(formatRefusal(V1, "POST", "/api/ties")).toBeNull();
    expect(formatRefusal(V1, "GET", "/api/sync")).toMatchObject({ status: 410, reload: true });
    expect(formatRefusal(V1, "GET", "/api/mailboxes/messages")).toMatchObject({ status: 410 });
  });

  it("lets format 2 use its routes, and none of the format 1 journal", () => {
    expect(formatRefusal(V2, "POST", "/api/records")).toBeNull();
    expect(formatRefusal(V2, "GET", "/api/mailboxes/messages")).toBeNull();
    expect(formatRefusal(V2, "GET", "/api/data/import/items")).toMatchObject({ status: 410 });
    // The export is either's: a format 2 account's gives its account part.
    expect(formatRefusal(V2, "GET", "/api/data/export")).toBeNull();
    expect(formatRefusal(V2, "GET", "/api/ties/abc")).toMatchObject({ status: 410 });
  });

  it("while converting: format 2's routes, reads of the format 1 journal, and no changes to it", () => {
    for (const [method, path] of [["GET", "/api/data/export"], ["GET", "/api/media/abc/full"], ["POST", "/api/ties/search"],
      ["POST", "/api/stats/ties"], ["POST", "/api/records"], ["PUT", "/api/files/abc"], ["PUT", "/api/identity"]]) {
      expect(formatRefusal(CONVERTING, method, path), `${method} ${path}`).toBeNull();
    }
    for (const [method, path] of [["POST", "/api/ties"], ["PUT", "/api/ties/abc"], ["DELETE", "/api/people/abc"],
      ["POST", "/api/data/import/items"], ["POST", "/api/encryption/seal"], ["PUT", "/api/visuals/order"]]) {
      expect(formatRefusal(CONVERTING, method, path), `${method} ${path}`).toMatchObject({ status: 409, reload: true });
    }
    expect(formatRefusal(CONVERTING, "GET", "/api/mailboxes/messages")).toMatchObject({ status: 410 });
  });

  it("leaves the routes that aren't either's alone", () => {
    for (const account of [V1, CONVERTING, V2]) {
      expect(formatRefusal(account, "POST", "/api/locations/coords")).toBeNull();
      expect(formatRefusal(account, "PUT", "/api/account/settings")).toBeNull();
      expect(formatRefusal(account, "POST", "/api/shares")).toBeNull();
    }
  });
});

describe("newAccountFormat", () => {
  it("is 2 only when set to 2", () => {
    expect(newAccountFormat("2")).toBe(2);
    for (const value of ["1", undefined, "", "3"]) expect(newAccountFormat(value)).toBe(1);
  });
});
