// Deciding which ties (and workshops) in an import are already in the
// journal. Pure, so it's easy to test.
//
// The server finds my ties that are the same as a file's tie in everything
// but the notes (date, title, type, location, duration, rating, people,
// plans and tags): the candidates. It can't compare notes, which are
// encrypted, so the page opens the candidates' notes and compares them
// here. A tie with any candidate whose notes are the same is a duplicate.
// Workshops are the same, comparing their description and notes.

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
 * @param {Record<string, unknown>[]} fileTies the batch, notes in plain text
 * @param {({ i: number, notes: string | null } & Record<string, unknown>)[]} candidates from the server, notes opened
 * @returns {number[]}
 */
export function duplicatePositions(fileTies, candidates) {
  return [...duplicateMatches(fileTies, candidates).keys()].sort((a, b) => a - b);
}

/**
 * The file's ties that duplicate one of mine: position (in the batch) to
 * my tie's id (the first that matches), where a skipped tie's photos go.
 * @param {Record<string, unknown>[]} fileTies the batch, notes in plain text
 * @param {({ i: number, id?: string } & Record<string, unknown>)[]} candidates from the server, notes opened
 * @param {string[]} [fields] the encrypted fields to compare (a workshop's: description and notes)
 * @returns {Map<number, string>}
 */
export function duplicateMatches(fileTies, candidates, fields = ["notes"]) {
  /** @type {Map<number, string>} */
  const found = new Map();
  for (const candidate of candidates) {
    const { i, id } = candidate;
    const mine = fileTies[i];
    if (found.has(i) || !mine) continue;
    if (fields.every((field) => sameForm(mine[field]) === sameForm(candidate[field]))) found.set(i, id ?? "");
  }
  return found;
}
