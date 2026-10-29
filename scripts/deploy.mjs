// Deploys the app with a new version: the date and time now (UTC), e.g.
// 2026.10.28.2104. Every deploy gets one, release notes or not, so a page
// left open over it (an installed app, often) sees the server is newer and
// reloads (version-check.js).
//
//   npm run deploy:prod        production: VERSION, RELEASES.md ("## Next"
//                              named the version) and the built files are
//                              changed; commit them afterwards
//   npm run deploy:dev         dev.notonawa.app: the same files are stamped
//                              for the deploy, then put back as they were
//
// Plain npm run deploy refuses: it says to use one of them.
//
// It refuses a version that isn't newer than the one being served (a second
// deploy in the same minute): open pages wouldn't reload into it.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { deployTarget, stampNext, versionAt } from "./releases-lib.mjs";
import { buildReleases, RELEASES_FILE, VERSION_FILE } from "./releases-build.mjs";

const PAGE_FILE = new URL("../public/js/releases.js", import.meta.url);
const WORKER_FILE = new URL("../src/app-version.js", import.meta.url);

/** @type {boolean} */
let dev;
try {
  dev = deployTarget(process.argv.slice(2)) === "dev";
} catch (err) {
  console.error(/** @type {Error} */ (err).message);
  process.exit(1);
}
// The ORIGIN of each in wrangler.jsonc.
const origin = dev ? "https://dev.notonawa.app" : "https://notonawa.app";
const version = versionAt(new Date());

/** The version being served now, or null if it can't be asked. */
async function liveVersion() {
  try {
    const res = await fetch(`${origin}/api/version`);
    return res.ok ? /** @type {{ version: string }} */ (await res.json()).version : null;
  } catch {
    return null;
  }
}

const live = await liveVersion();
const local = readFileSync(VERSION_FILE, "utf8").trim();
for (const [where, other] of [[origin, live], ["VERSION", dev ? null : local]]) {
  if (other !== null && version <= other) {
    console.error(`${where} is already on ${other}, not older than ${version}. Wait a minute and deploy again.`);
    process.exit(1);
  }
}
if (live === null) console.warn(`Couldn't ask ${origin} for its version; deploying anyway.`);

// The files as they were, to put back after a dev deploy or a failed one.
const files = [VERSION_FILE, RELEASES_FILE, PAGE_FILE, WORKER_FILE];
const before = files.map((file) => readFileSync(file, "utf8"));
const restore = () => files.forEach((file, i) => writeFileSync(file, before[i]));

writeFileSync(VERSION_FILE, `${version}\n`);
writeFileSync(RELEASES_FILE, stampNext(before[1], version));
try {
  const { page, worker } = buildReleases();
  writeFileSync(PAGE_FILE, page);
  writeFileSync(WORKER_FILE, worker);
} catch (err) {
  restore();
  console.error(`RELEASES.md: ${/** @type {Error} */ (err).message}`);
  process.exit(1);
}

console.log(`Deploying ${version} to ${origin}…`);
const args = ["wrangler", "deploy", "--tag", version, ...(dev ? ["--env", "dev"] : [])];
const { status } = spawnSync("npx", args, { stdio: "inherit" });

if (status !== 0 || dev) restore();
if (status !== 0) {
  console.error("The deploy failed; the files are as they were.");
  process.exit(status ?? 1);
}
console.log(dev
  ? `Deployed ${version} to dev. The files are as they were.`
  : `Deployed ${version}. Commit VERSION, RELEASES.md, public/js/releases.js and src/app-version.js.`);
