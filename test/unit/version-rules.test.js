import { describe, it, expect } from "vitest";
import { shouldReload } from "../../public/js/version-rules.js";

describe("shouldReload", () => {
  const page = "2026.10.26.001";

  it("reloads when the server is on a newer version", () => {
    expect(shouldReload({ page, server: "2026.10.26.002", sharePending: false })).toBe(true);
    expect(shouldReload({ page, server: "2026.11.01.001", sharePending: false })).toBe(true);
  });

  it("doesn't reload on the same version, or an older one (no reloading again and again)", () => {
    expect(shouldReload({ page, server: page, sharePending: false })).toBe(false);
    expect(shouldReload({ page, server: "2026.10.25.003", sharePending: false })).toBe(false);
  });

  it("doesn't reload while a share link is waiting to be opened", () => {
    expect(shouldReload({ page, server: "2026.10.27.001", sharePending: true })).toBe(false);
  });

  it("doesn't reload on an answer that isn't a version", () => {
    for (const server of [undefined, null, 20261027, {}]) expect(shouldReload({ page, server, sharePending: false })).toBe(false);
  });
});
