// Reads VERSION and RELEASES.md and makes the two built files' text, for
// scripts/releases.mjs (writing or checking them) and scripts/deploy.mjs
// (writing them for the version it deploys).

import { readFileSync } from "node:fs";
import { parseReleases, deployed, pageFile, workerFile } from "./releases-lib.mjs";

export const VERSION_FILE = new URL("../VERSION", import.meta.url);
export const RELEASES_FILE = new URL("../RELEASES.md", import.meta.url);

/**
 * The version, the deployed releases and the built files' text.
 * @returns {{ version: string, releases: import("./releases-lib.mjs").Release[], page: string, worker: string }}
 */
export function buildReleases() {
  const version = readFileSync(VERSION_FILE, "utf8").trim();
  const releases = deployed(parseReleases(readFileSync(RELEASES_FILE, "utf8")), version);
  return { version, releases, page: pageFile(version, releases), worker: workerFile(version) };
}
