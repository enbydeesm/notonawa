import { describe, it, expect } from "vitest";
import { parseWelcome, parseInline, pageFile } from "../../scripts/welcome-lib.mjs";
import { WELCOME } from "../../public/js/welcome-text.js";
import welcomeMd from "../../WELCOME.md?raw";

describe("WELCOME.md", () => {
  it("reads bold, italics and email addresses in a line", () => {
    expect(parseInline("**Ties** are *yours*. Email me@example.app.")).toEqual([
      { text: "Ties", bold: true }, { text: " are " }, { text: "yours", italic: true },
      { text: ". Email " }, { text: "me@example.app", email: true }, { text: "." },
    ]);
    expect(parseInline("Plain")).toEqual([{ text: "Plain" }]);
  });

  it("reads a heading, paragraphs and a list, joining lines that carry on", () => {
    const md = "### Hello \n\nFirst line\nsecond line\n* One\n  more\n- Two\n\nLast";
    expect(parseWelcome(md)).toEqual([
      { kind: "heading", spans: [{ text: "Hello" }] },
      { kind: "paragraph", spans: [{ text: "First line second line" }] },
      { kind: "list", items: [[{ text: "One more" }], [{ text: "Two" }]] },
      { kind: "paragraph", spans: [{ text: "Last" }] },
    ]);
    expect(() => parseWelcome("\n\n")).toThrow("empty");
  });

  it("is what the app was built from", () => {
    expect(WELCOME).toEqual(parseWelcome(welcomeMd));
    expect(pageFile(WELCOME)).toContain("export const WELCOME");
  });
});
