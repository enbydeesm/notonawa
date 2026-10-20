// Builds the welcome dialog's text (public/js/welcome-text.js) from
// WELCOME.md.
//
//   node scripts/welcome.mjs           rebuild it
//   node scripts/welcome.mjs --check   fail if it's out of date (npm run check)

import { readFileSync, writeFileSync } from "node:fs";
import { parseWelcome, pageFile } from "./welcome-lib.mjs";

const SOURCE = new URL("../WELCOME.md", import.meta.url);
const TARGET = new URL("../public/js/welcome-text.js", import.meta.url);

const text = pageFile(parseWelcome(readFileSync(SOURCE, "utf8")));

/** @param {URL} file */
const read = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

if (process.argv.includes("--check")) {
  if (read(TARGET) !== text) {
    console.error("public/js/welcome-text.js is out of date with WELCOME.md. Run: node scripts/welcome.mjs");
    process.exit(1);
  }
} else {
  writeFileSync(TARGET, text);
  console.log("Rebuilt public/js/welcome-text.js.");
}
