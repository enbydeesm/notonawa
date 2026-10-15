// Deciding which ties in an import are already in the journal. Pure, so
// it's easy to test.
//
// The server finds my ties that are the same as a file's tie in everything
// but the notes (date, title, type, location, duration, rating, people,
// plans and tags): the candidates. It can't compare notes, which are
// encrypted, so the page opens the candidates' notes and compares them
// here. A tie with any candidate whose notes are the same is a duplicate.

/**
 * Notes as they're stored: trimmed, and empty as null (as sealing does).
 * @param {unknown} notes
 */
function sameForm(notes) {
  if (notes === null || notes === undefined) return null;
  const text = String(notes).trim();
  return text === "" ? null : text;
}

/**
 * Positions (in the batch) of the file's ties that duplicate one of mine.
 * @param {{ notes?: unknown }[]} fileTies the batch, notes in plain text
 * @param {{ i: number, notes: string | null }[]} candidates from the server, notes opened
 * @returns {number[]}
 */
export function duplicatePositions(fileTies, candidates) {
  const found = new Set();
  for (const { i, notes } of candidates) {
    if (fileTies[i] && sameForm(fileTies[i].notes) === sameForm(notes)) found.add(i);
  }
  return [...found].sort((a, b) => a - b);
}
