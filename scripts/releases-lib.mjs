// Reading RELEASES.md and writing what's built from it, for
// scripts/releases.mjs, and the version a deploy stamps, for
// scripts/deploy.mjs. Pure, so it's easy to test.

/**
 * A version: the date and time (UTC) of the deploy, e.g. 2026.10.28.2104
 * for 21:04. Older ones end in a release's number that day instead
 * (2026.10.19.001). They compare as text, newest last; the two kinds only
 * share one day, Oct 28 2026, whose first deploy as a time was after 00:10.
 */
export const VERSION_FORMAT = /^\d{4}\.\d{2}\.\d{2}\.(\d{3}|\d{4})$/;

/** The heading for notes not deployed yet: a deploy gives it its version. */
export const NEXT = "Next";

/**
 * The version for a deploy at a moment: its UTC date, hours and minutes.
 * @param {Date} date
 */
export function versionAt(date) {
  const two = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}.${two(date.getUTCMonth() + 1)}.${two(date.getUTCDate())}.${two(date.getUTCHours())}${two(date.getUTCMinutes())}`;
}

/**
 * Where scripts/deploy.mjs deploys: exactly one of --prod or --dev, as
 * npm run deploy:prod and deploy:dev give it. There's no default:
 * `npm run deploy --dev`, without "--", gives --dev to npm, which drops it
 * without a trace, and the script once deployed that to production.
 * @param {string[]} args the script's (process.argv after the first two)
 * @returns {"dev" | "production"}
 */
export function deployTarget(args) {
  const usage = "Deploy with npm run deploy:prod or npm run deploy:dev.";
  const unknown = args.filter((a) => a !== "--dev" && a !== "--prod");
  if (unknown.length) throw new Error(`Unknown: ${unknown.join(" ")}. ${usage}`);
  const dev = args.includes("--dev");
  if (dev === args.includes("--prod")) throw new Error(`Say where to deploy. ${usage}`);
  return dev ? "dev" : "production";
}

/**
 * RELEASES.md with its "## Next" heading (if any) named the version being
 * deployed, so its notes are that release's.
 * @param {string} markdown
 * @param {string} version
 */
export function stampNext(markdown, version) {
  return markdown.replace(new RegExp(`^## ${NEXT}[ \\t]*$`, "m"), `## ${version}`);
}

/**
 * A note: its words, or its words and the sub-bullets under it.
 * @typedef {string | { text: string, sub: string[] }} Note
 * @typedef {{ version: string, intro?: string[], notes: Note[] }} Release
 */

/**
 * The releases in RELEASES.md, newest first, as written, "## Next" (notes
 * not deployed yet) included, first if it's there. Anything before
 * the first `## ` heading is the file's own introduction. Under a heading,
 * lines before the first bullet are its intro (a blank line between
 * paragraphs); then each note is a `- ` bullet, a `- ` indented under one
 * is a sub-bullet of it, and other lines indented under either continue it.
 * @param {string} markdown
 * @returns {Release[]}
 */
export function parseReleases(markdown) {
  /** @type {Release[]} */
  const releases = [];
  // The intro's paragraph being written (a blank line ends it).
  let paragraph = false;
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^## (.*)$/);
    if (heading) {
      const version = heading[1].trim();
      if (version === NEXT) {
        if (releases.length) throw new Error(`"## ${NEXT}" goes above every release.`);
      } else if (!VERSION_FORMAT.test(version)) {
        throw new Error(`"${version}" isn't a version: write "## ${NEXT}" for notes not deployed yet (a deploy names it).`);
      }
      releases.push({ version, notes: [] });
      paragraph = false;
      continue;
    }
    const release = releases[releases.length - 1];
    if (!release) continue;
    if (line.trim() === "") {
      paragraph = false;
      continue;
    }
    const notes = release.notes;
    const last = notes[notes.length - 1];
    const sub = line.match(/^\s+- (.*)$/);
    if (line.startsWith("- ")) {
      notes.push(line.slice(2).trim());
    } else if (sub && last !== undefined) {
      const note = typeof last === "string" ? { text: last, sub: [] } : last;
      note.sub.push(sub[1].trim());
      notes[notes.length - 1] = note;
    } else if (/^\s/.test(line) && last !== undefined) {
      const words = line.trim();
      if (typeof last === "string") notes[notes.length - 1] = `${last} ${words}`;
      else if (last.sub.length) last.sub[last.sub.length - 1] += ` ${words}`;
      else last.text += ` ${words}`;
    } else if (!notes.length) {
      const intro = release.intro ??= [];
      if (paragraph) intro[intro.length - 1] += ` ${line.trim()}`;
      else intro.push(line.trim());
      paragraph = true;
    } else {
      throw new Error(`Under ${release.version}, write each note as a "- " bullet (words before the first one are its intro): "${line.trim()}"`);
    }
  }
  if (!releases.some((r) => r.version !== NEXT)) throw new Error("RELEASES.md needs at least one release.");
  releases.forEach((release, i) => {
    if (!release.notes.length) throw new Error(`${release.version} has no notes.`);
    // Versions compare as text (the page relies on it), so newest first
    // means each is later than the one below it.
    const older = releases[i + 1];
    if (release.version !== NEXT && older && older.version >= release.version) {
      throw new Error(`List releases newest first, each once: ${release.version} is above ${older.version}.`);
    }
  });
  return releases;
}

/**
 * The releases already deployed (not "## Next"), checked against the app's
 * version: a release can't be newer than the deploy it went out in.
 * @param {Release[]} releases from parseReleases
 * @param {string} version the app's (VERSION)
 * @returns {Release[]}
 */
export function deployed(releases, version) {
  if (!VERSION_FORMAT.test(version)) throw new Error(`VERSION holds "${version}", which isn't a version.`);
  const out = releases.filter((r) => r.version !== NEXT);
  if (out[0].version > version) {
    throw new Error(`${out[0].version} in RELEASES.md is newer than the app's version, ${version}: write "## ${NEXT}" until it's deployed.`);
  }
  return out;
}

/**
 * public/js/releases.js: the version and every deployed release's notes,
 * for the page.
 * @param {string} version the app's (VERSION)
 * @param {Release[]} releases from deployed()
 */
export function pageFile(version, releases) {
  return `// Made by scripts/releases.mjs from VERSION and RELEASES.md. Don't edit it: rebuild.

/** The app's version: when it was deployed (scripts/deploy.mjs). */
export const APP_VERSION = ${JSON.stringify(version)};

/**
 * Newest first. A note is its words, or its words and sub-bullets; intro
 * is the paragraphs before a release's notes, if it has any.
 * @type {{ version: string, intro?: string[], notes: (string | { text: string, sub: string[] })[] }[]}
 */
export const RELEASES = ${JSON.stringify(releases.map(({ version, intro, notes }) => (intro ? { version, intro, notes } : { version, notes })), null, 2)};
`;
}

/**
 * src/app-version.js: the version, for the Worker (new accounts start on it).
 * @param {string} version the app's (VERSION)
 */
export function workerFile(version) {
  return `// Made by scripts/releases.mjs from VERSION. Don't edit it: rebuild.

/** The app's version: when it was deployed. New accounts have seen every release's notes up to it. */
export const APP_VERSION = ${JSON.stringify(version)};
`;
}
