// Builds public/privacy.html from PRIVACY.md, so the sign-up page can link
// to the policy. Handles the Markdown PRIVACY.md uses: headings, paragraphs,
// lists, a quote, **bold**, `code` and links.
//
//   node scripts/privacy-html.mjs           rebuild it
//   node scripts/privacy-html.mjs --check   fail if it's out of date (npm run check)

import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = new URL("../PRIVACY.md", import.meta.url);
const TARGET = new URL("../public/privacy.html", import.meta.url);

/** @param {string} text */
const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** GitHub-style heading ids, so the policy's #links work. @param {string} text */
const slug = (text) => text.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s/g, "-");

/** @param {string} text */
function inline(text) {
  return escape(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[(.+?)\]\((.+?)\)/g, (_, label, href) =>
      // Links to the repo's other files mean nothing on the site: keep the words.
      href.startsWith("#") || href.startsWith("http") ? `<a href="${href}">${label}</a>` : label);
}

/** @param {string} markdown */
export function toHtml(markdown) {
  const out = [];
  const blocks = markdown.trim().split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n");
    const heading = lines[0].match(/^(#{1,3}) (.*)$/);
    if (heading && lines.length === 1) {
      const level = heading[1].length;
      out.push(`<h${level} id="${slug(heading[2])}">${inline(heading[2])}</h${level}>`);
    } else if (lines[0].startsWith(">")) {
      const text = lines.map((l) => l.replace(/^>\s?/, "")).join(" ");
      out.push(`<blockquote>${inline(text)}</blockquote>`);
    } else if (lines[0].startsWith("- ")) {
      const items = block.split(/\n(?=- )/).map((item) => item.replace(/^- /, "").replace(/\n\s+/g, " "));
      out.push(`<ul>\n${items.map((i) => `  <li>${inline(i)}</li>`).join("\n")}\n</ul>`);
    } else {
      out.push(`<p>${inline(lines.join(" "))}</p>`);
    }
  }
  return out.join("\n");
}

const page = `<!doctype html>
<!-- Built from PRIVACY.md by scripts/privacy-html.mjs. Edit that, not this. -->
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Privacy policy · NotoNawa</title>
  <link rel="stylesheet" href="/app.css">
  <script src="/js/theme-init.js"></script>
</head>
<body>
  <main class="policy">
${toHtml(readFileSync(SOURCE, "utf8"))}
  </main>
</body>
</html>
`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(TARGET, "utf8");
  } catch {
    // missing
  }
  if (current !== page) {
    console.error("public/privacy.html is out of date with PRIVACY.md. Run: node scripts/privacy-html.mjs");
    process.exit(1);
  }
} else {
  writeFileSync(TARGET, page);
}
