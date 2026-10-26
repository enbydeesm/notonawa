import { describe, it, expect } from "vitest";
import { parseReleases, pageFile, workerFile, VERSION_FORMAT } from "../../scripts/releases-lib.mjs";
import { unseenReleases, MAX_SHOWN } from "../../public/js/release-notes.js";
import { APP_VERSION, RELEASES } from "../../public/js/releases.js";
import { APP_VERSION as WORKER_VERSION } from "../../src/app-version.js";
import releasesMd from "../../RELEASES.md?raw";

const MD = `# What's new

Intro words, not a release.

## 2026.10.20.002

- Second release that day.
- A note that goes on
  over two lines.

## 2026.10.20.001

- First.
`;

describe("RELEASES.md", () => {
  it("reads each release's version and notes, newest first", () => {
    expect(parseReleases(MD)).toEqual([
      { version: "2026.10.20.002", notes: ["Second release that day.", "A note that goes on over two lines."] },
      { version: "2026.10.20.001", notes: ["First."] },
    ]);
  });

  it("reads an intro before the notes, in paragraphs, and sub-bullets under a note", () => {
    const md = `## 2026.10.26.002
Lots of updates!
On two lines.

A second paragraph.
- A note.
- Tap a rope to choose it.
  - A see-saw.
  - A cinch that goes on
    over two lines.
- Last.
`;
    expect(parseReleases(md)).toEqual([{
      version: "2026.10.26.002", intro: ["Lots of updates! On two lines.", "A second paragraph."],
      notes: ["A note.", { text: "Tap a rope to choose it.", sub: ["A see-saw.", "A cinch that goes on over two lines."] }, "Last."],
    }]);
    expect(pageFile(parseReleases(md))).toContain('"intro": [');
    expect(pageFile(parseReleases(MD))).not.toContain('"intro"');
    // Words after the notes have begun aren't an intro.
    expect(() => parseReleases("## 2026.10.20.001\n\n- x\n\nStray words.\n")).toThrow('"- " bullet');
  });

  it("refuses versions in the wrong form or order, and releases without notes", () => {
    expect(() => parseReleases("## 2026.10.20.01\n\n- x\n")).toThrow("YYYY.MM.DD.NNN");
    expect(() => parseReleases("## 2026.10.20.001\n\n- x\n\n## 2026.10.20.002\n\n- y\n")).toThrow("newest first");
    expect(() => parseReleases("## 2026.10.20.001\n\n- x\n\n## 2026.10.20.001\n\n- y\n")).toThrow("each once");
    expect(() => parseReleases("## 2026.10.20.001\n\n")).toThrow("no notes");
    expect(() => parseReleases("## 2026.10.20.001\n\nAn intro, but no notes.\n")).toThrow("no notes");
    expect(() => parseReleases("# Nothing yet\n")).toThrow("at least one release");
  });

  it("builds the page's and the Worker's files from it, with the newest as the version", () => {
    const releases = parseReleases(MD);
    expect(pageFile(releases)).toContain('export const APP_VERSION = "2026.10.20.002";');
    expect(pageFile(releases)).toContain('"First."');
    expect(workerFile(releases)).toContain('export const APP_VERSION = "2026.10.20.002";');
    expect(workerFile(releases)).not.toContain("First.");
  });

  it("is what the app was built from", () => {
    const releases = parseReleases(releasesMd);
    expect(RELEASES).toEqual(releases);
    expect([APP_VERSION, WORKER_VERSION]).toEqual([releases[0].version, releases[0].version]);
    expect(APP_VERSION).toMatch(VERSION_FORMAT);
  });
});

describe("unseenReleases", () => {
  const releases = [{ version: "2026.11.02.001" }, { version: "2026.10.20.002" }, { version: "2026.10.20.001" }, { version: "2026.10.19.001" }];

  it("lists the releases newer than the one last seen, newest first, in one go", () => {
    expect(unseenReleases(releases, "2026.10.20.001").map((r) => r.version)).toEqual(["2026.11.02.001", "2026.10.20.002"]);
    expect(unseenReleases(releases, "2026.11.02.001")).toEqual([]);
  });

  it("lists them all for an account that's never seen any, up to a limit", () => {
    expect(unseenReleases(releases, null)).toHaveLength(4);
    const many = Array.from({ length: 30 }, (_, i) => ({ version: `2026.10.${String(30 - i).padStart(2, "0")}.001` }));
    expect(unseenReleases(many, null)).toEqual(many.slice(0, MAX_SHOWN));
  });
});
