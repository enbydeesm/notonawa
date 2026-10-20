// Reading WELCOME.md and writing what's built from it, for
// scripts/welcome.mjs. Pure, so it's easy to test.
//
// Handles the Markdown WELCOME.md uses: a heading, paragraphs, a "* " or
// "- " list, **bold** and *italics*. Email addresses become mailto: links.
// The page draws it with h() (public/js/welcome.js), never as HTML.

/**
 * @typedef {{ text: string, bold?: true, italic?: true, email?: true }} Span
 * @typedef {{ kind: "heading" | "paragraph", spans: Span[] } | { kind: "list", items: Span[][] }} Block
 */

const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;

/**
 * A line's text as spans: plain, bold, italic, or an email address.
 * @param {string} text
 * @returns {Span[]}
 */
export function parseInline(text) {
  /** @type {Span[]} */
  const spans = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) spans.push({ text: text.slice(at, m.index) });
    if (m[1] !== undefined) spans.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) spans.push({ text: m[2], italic: true });
    else spans.push({ text: m[3], email: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) spans.push({ text: text.slice(at) });
  return spans;
}

/**
 * WELCOME.md as blocks, in order. A blank line ends a paragraph or list;
 * lines indented under a list item continue it.
 * @param {string} markdown
 * @returns {Block[]}
 */
export function parseWelcome(markdown) {
  /** @type {Block[]} */
  const blocks = [];
  /** @type {string[]} */
  let paragraph = [];
  /** @type {string[] | null} */
  let list = null;

  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", spans: parseInline(paragraph.join(" ")) });
    if (list) blocks.push({ kind: "list", items: list.map(parseInline) });
    paragraph = [];
    list = null;
  };

  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    const heading = line.match(/^#{1,6} (.*)$/);
    const item = line.match(/^[*-] (.*)$/);
    if (line === "") {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ kind: "heading", spans: parseInline(heading[1].trim()) });
    } else if (item) {
      if (paragraph.length) flush();
      (list ??= []).push(item[1].trim());
    } else if (list && /^\s/.test(raw)) {
      list[list.length - 1] += ` ${line}`;
    } else {
      if (list) flush();
      paragraph.push(line);
    }
  }
  flush();
  if (!blocks.length) throw new Error("WELCOME.md is empty.");
  return blocks;
}

/**
 * public/js/welcome-text.js: the welcome, for the page.
 * @param {Block[]} blocks
 */
export function pageFile(blocks) {
  return `// Made by scripts/welcome.mjs from WELCOME.md. Don't edit it: rebuild.

/**
 * @typedef {{ text: string, bold?: true, italic?: true, email?: true }} Span
 * @typedef {{ kind: "heading" | "paragraph", spans: Span[] } | { kind: "list", items: Span[][] }} Block
 */

/** @type {Block[]} */
export const WELCOME = ${JSON.stringify(blocks, null, 2)};
`;
}
