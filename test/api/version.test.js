import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import { APP_VERSION } from "../../src/app-version.js";
import { ORIGIN } from "../helpers.js";

describe("GET /api/version", () => {
  it("says the server's version, without signing in, and isn't cached", async () => {
    const res = await SELF.fetch(ORIGIN + "/api/version");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ version: APP_VERSION });
  });

  it("is only a read", async () => {
    const res = await SELF.fetch(ORIGIN + "/api/version", { method: "POST", headers: { origin: ORIGIN } });
    await res.arrayBuffer();
    expect(res.status).toBe(401);
  });
});
