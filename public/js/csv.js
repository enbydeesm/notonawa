// Reading CSV files (RFC 4180), as saved by spreadsheets. Pure, so it's easy
// to test. Hand-written rather than a package: it's small, and the page loads
// nothing from other sites.

/**
 * Splits CSV text into rows of cells. Handles quoted cells (with commas,
 * line breaks and "" for a quote inside), Windows line endings and a
 * leading byte-order mark. The separator is a comma, or a semicolon or tab
 * if the first line has those and no commas (spreadsheets in some
 * languages save with semicolons).
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  if (text.startsWith("﻿")) text = text.slice(1);
  const separator = guessSeparator(text);
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (c === '"') quoted = false;
      else cell += c;
      i++;
      continue;
    }
    if (c === '"' && cell === "") {
      quoted = true;
    } else if (c === separator) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else {
      cell += c;
    }
    i++;
  }
  if (quoted) throw new Error("The file has a quote (\") that's never closed.");
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** @param {string} text */
function guessSeparator(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  if (firstLine.includes(",")) return ",";
  if (firstLine.includes(";")) return ";";
  if (firstLine.includes("\t")) return "\t";
  return ",";
}
