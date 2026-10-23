import { describe, it, expect } from "vitest";
import { targetFlags, targetName } from "../../scripts/d1-target.mjs";

describe("targetFlags", () => {
  it("is the local database by default", () => {
    expect(targetFlags([])).toEqual(["--local"]);
    expect(targetFlags(["--local", "--days", "3"])).toEqual(["--local"]);
  });

  it("is a throwaway local copy with --persist-to", () => {
    expect(targetFlags(["--persist-to", "/tmp/copy"])).toEqual(["--local", "--persist-to", "/tmp/copy"]);
  });

  it("is the real database with --remote", () => {
    expect(targetFlags(["--remote"])).toEqual(["--remote"]);
    expect(targetFlags(["Hello", "--remote", "--warning"])).toEqual(["--remote"]);
  });

  it("is the dev environment's database with --dev", () => {
    expect(targetFlags(["--dev"])).toEqual(["--remote", "--env", "dev"]);
    expect(targetFlags(["--list", "--dev"])).toEqual(["--remote", "--env", "dev"]);
  });

  it("refuses --dev with --remote or --persist-to", () => {
    expect(() => targetFlags(["--dev", "--remote"])).toThrow("--dev or --remote");
    expect(() => targetFlags(["--remote", "--dev"])).toThrow("--dev or --remote");
    expect(() => targetFlags(["--dev", "--persist-to", "/tmp/copy"])).toThrow("--dev or --persist-to");
  });
});

describe("targetName", () => {
  it("names each target", () => {
    expect(targetName(targetFlags([]))).toBe("local");
    expect(targetName(targetFlags(["--persist-to", "/tmp/copy"]))).toBe("local");
    expect(targetName(targetFlags(["--remote"]))).toBe("remote");
    expect(targetName(targetFlags(["--dev"]))).toBe("dev");
  });
});
