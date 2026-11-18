// Builds public/privacy.html from PRIVACY.md, so the sign-up page can link
// to the policy. Handles the Markdown PRIVACY.md uses: headings, paragraphs,
// lists, a quote, **bold**, `code` and links.
//
//   node scripts/privacy-html.mjs           rebuild it
//   node scripts/privacy-html.mjs --require-consent "What changed, in a sentence or two"
//                                           rebuild it, and ask everyone who agreed to
//                                           an earlier version to agree to this one
//   node scripts/privacy-html.mjs --check   fail if it's out of date (npm run check)
//
// When PRIVACY.md's wording has changed since the last build, the build
// stamps today's date on its "Last updated" line and gives the policy a new
// version (the time of the build). Both are written to src/policy-version.js,
// which the Worker reads: new accounts agree to that version. Wording
// changes alone don't ask anyone to agree again; --require-consent does
// (src/consent/). Tell people about other changes with a notice first
// (scripts/notice.mjs).

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { policyDate, consentFile, unstamped, stamp } from "./policy-lib.mjs";

const SOURCE = new URL("../PRIVACY.md", import.meta.url);
const TARGET = new URL("../public/privacy.html", import.meta.url);
const VERSION_FILE = new URL("../src/policy-version.js", import.meta.url);

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

/** @param {string} markdown */
const pageFor = (markdown) => `<!doctype html>
<!-- Built from PRIVACY.md by scripts/privacy-html.mjs. Edit that, not this. -->
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Privacy policy · NotoNawa</title>
  <link rel="stylesheet" href="/app.css">
  <link rel="icon" type="image/png" href="/img/favicon-v3.png">
  <link rel="apple-touch-icon" href="/img/apple-touch-icon-v3.png">
  <script src="/js/theme-init.js"></script>
</head>
<body>
  <main class="policy">
${toHtml(markdown)}
  </main>
</body>
</html>
`;

const current = await import(VERSION_FILE.href).catch(() => null);
const markdown = readFileSync(SOURCE, "utf8");
// The wording, without the date: what the version follows.
const hash = createHash("sha256").update(unstamped(markdown)).digest("hex");
const args = process.argv.slice(2);

if (args.includes("--check")) {
  let built = "";
  try {
    built = readFileSync(TARGET, "utf8");
  } catch {
    // missing
  }
  if (!current || current.POLICY_HASH !== hash || built !== pageFor(markdown)) {
    console.error("public/privacy.html or src/policy-version.js is out of date with PRIVACY.md. Run: node scripts/privacy-html.mjs");
    process.exit(1);
  }
} else {
  const at = args.indexOf("--require-consent");
  const summary = at === -1 ? null : args[at + 1]?.trim();
  if (at !== -1 && !summary) {
    console.error('Say what changed: --require-consent "…"');
    process.exit(1);
  }
  const changed = !current || current.POLICY_HASH !== hash;
  const now = new Date();
  const version = changed ? now.toISOString().replace(/\.\d{3}Z$/, "Z") : current.POLICY_VERSION;
  const stamped = changed ? stamp(markdown, policyDate(now)) : markdown;
  const consent = summary
    ? { version, summary }
    : { version: current?.CONSENT_VERSION ?? version, summary: current?.CONSENT_SUMMARY ?? null };
  writeFileSync(SOURCE, stamped);
  writeFileSync(TARGET, pageFor(stamped));
  writeFileSync(VERSION_FILE, consentFile({ version, hash, consent }));
  console.log(changed ? `The policy changed: version ${version}.` : "The policy's wording hasn't changed.");
  if (summary) console.log("Everyone who agreed to an earlier version will be asked to agree to this one.");
}
