import { describe, it, expect } from "vitest";
import { unstamped, stamp, policyDate, consentFile } from "../../scripts/policy-lib.mjs";

const MD = "# Policy\n\n**Last updated:** October 1, 2026\n\nWords.\n";

describe("the policy's date", () => {
  it("leaves the date out of what counts as a change", () => {
    expect(unstamped(MD)).toBe(unstamped(stamp(MD, "December 25, 2026")));
    expect(unstamped(MD)).not.toBe(unstamped(MD.replace("Words", "Other words")));
  });

  it("stamps a new date, and needs the line to be there", () => {
    expect(stamp(MD, "October 17, 2026")).toContain("**Last updated:** October 17, 2026\n\nWords.");
    expect(() => stamp("# Policy\n", "October 17, 2026")).toThrow();
  });

  it("shows the date in words", () => {
    expect(policyDate(new Date(2026, 9, 17, 12))).toBe("October 17, 2026");
  });

  it("writes the version file", () => {
    const file = consentFile({ version: "2026-10-17T08:00:00Z", hash: "abc", consent: { version: "2026-10-12-draft", summary: null } });
    expect(file).toContain('export const POLICY_VERSION = "2026-10-17T08:00:00Z";');
    expect(file).toContain('export const CONSENT_VERSION = "2026-10-12-draft";');
    expect(file).toContain("export const CONSENT_SUMMARY = null;");
  });
});
