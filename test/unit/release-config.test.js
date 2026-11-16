// The release switch (phase 7 of encrypting everything): production and dev
// make new accounts format 2 and convert format 1 accounts at their next
// unlock (wrangler.jsonc). The API tests pin both back to format 1 for the
// routes they test (vitest.config.js), so this is where the real values are
// checked.
import { describe, it, expect } from "vitest";
import wrangler from "../../wrangler.jsonc?raw";

// Whole-line comments only: the file has URLs with // in them (as
// scripts/ui/harness.mjs reads it).
const config = JSON.parse(wrangler.replace(/^\s*\/\/.*$/gm, ""));

describe("the release switch", () => {
  it("makes new accounts format 2 and converts format 1 ones at unlock, in production and dev", () => {
    for (const vars of [config.vars, config.env.dev.vars]) {
      expect([vars.NEW_ACCOUNT_FORMAT, vars.CONVERT_ON_UNLOCK]).toEqual(["2", "1"]);
    }
  });
});
