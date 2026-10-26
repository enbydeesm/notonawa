// Reading RELEASES.md and writing what's built from it, for
// scripts/releases.mjs. Pure, so it's easy to test.

/** A release's version: its date and its number that day, e.g. 2026.10.19.001. */
export const VERSION_FORMAT = /^\d{4}\.\d{2}\.\d{2}\.\d{3}$/;

/**
 * A note: its words, or its words and the sub-bullets under it.
 * @typedef {string | { text: string, sub: string[] }} Note
 * @typedef {{ version: string, intro?: string[], notes: Note[] }} Release
 */

/**
 * The releases in RELEASES.md, newest first, as written. Anything before
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
      if (!VERSION_FORMAT.test(version)) {
        throw new Error(`"${version}" isn't a version: write it as YYYY.MM.DD.NNN, e.g. 2026.10.19.001.`);
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
 * @param {Release[]} releases
 */
export function workerFile(releases) {
  return `// Made by scripts/releases.mjs from RELEASES.md. Don't edit it: rebuild.

/** The app's version: the newest release. New accounts have seen its notes. */
export const APP_VERSION = ${JSON.stringify(releases[0].version)};
`;
}
