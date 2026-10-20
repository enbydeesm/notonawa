// Reading RELEASES.md and writing what's built from it, for
// scripts/releases.mjs. Pure, so it's easy to test.

/** A release's version: its date and its number that day, e.g. 2026.10.19.001. */
export const VERSION_FORMAT = /^\d{4}\.\d{2}\.\d{2}\.\d{3}$/;

/** @typedef {{ version: string, notes: string[] }} Release */

/**
 * The releases in RELEASES.md, newest first, as written. Anything before
 * the first `## ` heading is the file's own introduction. Each note is a
 * `- ` bullet; lines indented under one continue it.
 * @param {string} markdown
 * @returns {Release[]}
 */
export function parseReleases(markdown) {
  /** @type {Release[]} */
  const releases = [];
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^## (.*)$/);
    if (heading) {
      const version = heading[1].trim();
      if (!VERSION_FORMAT.test(version)) {
        throw new Error(`"${version}" isn't a version: write it as YYYY.MM.DD.NNN, e.g. 2026.10.19.001.`);
      }
      releases.push({ version, notes: [] });
      continue;
    }
    const release = releases[releases.length - 1];
    if (!release || line.trim() === "") continue;
    if (line.startsWith("- ")) release.notes.push(line.slice(2).trim());
    else if (/^\s/.test(line) && release.notes.length) {
      release.notes[release.notes.length - 1] += ` ${line.trim()}`;
    } else {
      throw new Error(`Under ${release.version}, write each note as a "- " bullet: "${line.trim()}"`);
    }
  }
  if (!releases.length) throw new Error("RELEASES.md needs at least one release.");
  releases.forEach((release, i) => {
    if (!release.notes.length) throw new Error(`${release.version} has no notes.`);
    // Versions compare as text (the page relies on it), so newest first
    // means each is later than the one below it.
    const older = releases[i + 1];
    if (older && older.version >= release.version) {
      throw new Error(`List releases newest first, each once: ${release.version} is above ${older.version}.`);
    }
  });
  return releases;
}

/**
 * public/js/releases.js: the version and every release's notes, for the page.
 * @param {Release[]} releases
 */
export function pageFile(releases) {
  return `// Made by scripts/releases.mjs from RELEASES.md. Don't edit it: rebuild.

/** The app's version: the newest release. */
export const APP_VERSION = ${JSON.stringify(releases[0].version)};

/** @type {{ version: string, notes: string[] }[]} newest first */
export const RELEASES = ${JSON.stringify(releases, null, 2)};
`;
}

/**
 * src/app-version.js: the version, for the Worker (new accounts start on it).
 * @param {Release[]} releases
 */
export function workerFile(releases) {
  return `// Made by scripts/releases.mjs from RELEASES.md. Don't edit it: rebuild.

/** The app's version: the newest release. New accounts have seen its notes. */
export const APP_VERSION = ${JSON.stringify(releases[0].version)};
`;
}
