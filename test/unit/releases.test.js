import { describe, it, expect } from "vitest";
import { parseReleases, deployed, pageFile, workerFile, versionAt, stampNext, deployTarget, NEXT, VERSION_FORMAT } from "../../scripts/releases-lib.mjs";
import { unseenReleases, MAX_SHOWN } from "../../public/js/release-notes.js";
import { APP_VERSION, RELEASES } from "../../public/js/releases.js";
import { APP_VERSION as WORKER_VERSION } from "../../src/app-version.js";
import releasesMd from "../../RELEASES.md?raw";
import versionFile from "../../VERSION?raw";

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
    expect(pageFile("2026.10.26.002", parseReleases(md))).toContain('"intro": [');
    expect(pageFile("2026.10.20.002", parseReleases(MD))).not.toContain('"intro"');
    // Words after the notes have begun aren't an intro.
    expect(() => parseReleases("## 2026.10.20.001\n\n- x\n\nStray words.\n")).toThrow('"- " bullet');
  });

  it("refuses versions in the wrong form or order, and releases without notes", () => {
    expect(() => parseReleases("## 2026.10.20.01\n\n- x\n")).toThrow("isn't a version");
    expect(() => parseReleases("## Soon\n\n- x\n")).toThrow("isn't a version");
    expect(() => parseReleases("## 2026.10.20.001\n\n- x\n\n## 2026.10.20.002\n\n- y\n")).toThrow("newest first");
    expect(() => parseReleases("## 2026.10.20.001\n\n- x\n\n## 2026.10.20.001\n\n- y\n")).toThrow("each once");
    expect(() => parseReleases("## 2026.10.20.001\n\n")).toThrow("no notes");
    expect(() => parseReleases("## 2026.10.20.001\n\nAn intro, but no notes.\n")).toThrow("no notes");
    expect(() => parseReleases("# Nothing yet\n")).toThrow("at least one release");
  });

  it("builds the page's and the Worker's files with the deploy's version, newer than any release or not", () => {
    const releases = deployed(parseReleases(MD), "2026.10.28.2104");
    expect(pageFile("2026.10.28.2104", releases)).toContain('export const APP_VERSION = "2026.10.28.2104";');
    expect(pageFile("2026.10.28.2104", releases)).toContain('"First."');
    expect(workerFile("2026.10.28.2104")).toContain('export const APP_VERSION = "2026.10.28.2104";');
    expect(workerFile("2026.10.28.2104")).not.toContain("First.");
  });

  it("reads notes under ## Next, above every release, and leaves them out of the app until a deploy names them", () => {
    const md = `## ${NEXT}\n\n- Coming soon.\n\n${MD.slice(MD.indexOf("## "))}`;
    const all = parseReleases(md);
    expect(all.map((r) => r.version)).toEqual([NEXT, "2026.10.20.002", "2026.10.20.001"]);
    expect(deployed(all, "2026.10.28.2104").map((r) => r.version)).toEqual(["2026.10.20.002", "2026.10.20.001"]);
    expect(pageFile("2026.10.28.2104", deployed(all, "2026.10.28.2104"))).not.toContain("Coming soon.");
    expect(() => parseReleases(`${MD}\n## ${NEXT}\n\n- Late.\n`)).toThrow("goes above every release");
    expect(() => parseReleases(`## ${NEXT}\n\n- Only this.\n`)).toThrow("at least one release");
  });

  it("refuses a release newer than the app's version, or a version that isn't one", () => {
    expect(() => deployed(parseReleases(MD), "2026.10.20.001")).toThrow('write "## Next"');
    expect(() => deployed(parseReleases(MD), "soon")).toThrow("isn't a version");
  });

  it("is what the app was built from", () => {
    const version = versionFile.trim();
    expect(RELEASES).toEqual(deployed(parseReleases(releasesMd), version));
    expect([APP_VERSION, WORKER_VERSION]).toEqual([version, version]);
    expect(APP_VERSION).toMatch(VERSION_FORMAT);
  });
});

describe("where a deploy goes", () => {
  it("is production for --prod and dev for --dev", () => {
    expect(deployTarget(["--prod"])).toBe("production");
    expect(deployTarget(["--dev"])).toBe("dev");
  });

  it("is never production by default: npm run deploy --dev reaches the script with nothing, and once deployed to production", () => {
    expect(() => deployTarget([])).toThrow("Say where to deploy");
    expect(() => deployTarget(["--prod", "--dev"])).toThrow("Say where to deploy");
  });

  it("refuses anything else", () => {
    expect(() => deployTarget(["dev"])).toThrow("Unknown: dev");
    expect(() => deployTarget(["--env", "dev"])).toThrow("Unknown: --env dev");
  });
});

describe("a deploy's version", () => {
  it("is the UTC date, hours and minutes, which compare as text in time order", () => {
    expect(versionAt(new Date("2026-10-28T21:04:13Z"))).toBe("2026.10.28.2104");
    expect(versionAt(new Date("2026-01-02T03:05:59.999Z"))).toBe("2026.01.02.0305");
    // Late in California is the next day in UTC.
    expect(versionAt(new Date("2026-10-28T23:30:00-07:00"))).toBe("2026.10.29.0630");
    expect(versionAt(new Date("2026-10-28T21:04:00Z"))).toMatch(VERSION_FORMAT);
    expect(versionAt(new Date("2026-10-28T21:05:00Z")) > versionAt(new Date("2026-10-28T21:04:59Z"))).toBe(true);
    // Newer than every release numbered that day, the last day there were.
    expect("2026.10.28.2104" > "2026.10.28.001").toBe(true);
    expect("2026.10.29.0001" > "2026.10.28.2359").toBe(true);
  });

  it("names the ## Next heading, and only that", () => {
    const md = `# What's new\n\n## ${NEXT}\n\n- Coming soon.\n\n## 2026.10.20.001\n\n- First.\n`;
    expect(stampNext(md, "2026.10.28.2104")).toBe(md.replace(`## ${NEXT}`, "## 2026.10.28.2104"));
    expect(stampNext(MD, "2026.10.28.2104")).toBe(MD);
    // Not a note that mentions it.
    expect(stampNext("## 2026.10.20.001\n\n- ## Next week\n", "2026.10.28.2104")).toBe("## 2026.10.20.001\n\n- ## Next week\n");
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
