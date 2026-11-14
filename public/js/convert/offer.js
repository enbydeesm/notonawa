// When a format 1 account converts (phase 5): at unlock, where the server
// says to (CONVERT_ON_UNLOCK), or once a conversion has started, on any
// device, whatever it says (it can't go back, and the format 1 journal no
// longer takes changes). Pure.

/**
 * How far a conversion has got (store/convert.js reports it).
 * @typedef {"reading" | "photos" | "entries" | "checking" | "finishing"} Stage
 * @typedef {{ stage: Stage, done: number, total: number }} Progress
 */

/**
 * @param {{ format?: number, converting?: boolean, convert?: boolean } | null} keys GET /api/keys
 */
export function conversionWanted(keys) {
  return !!keys && keys.format !== 2 && (!!keys.converting || !!keys.convert);
}

/**
 * What the conversion's progress says.
 * @param {Progress} p
 */
export function progressText({ stage, done, total }) {
  if (stage === "reading") return "Reading your journal…";
  if (stage === "photos") return `Photos and videos: ${done} of ${total}`;
  if (stage === "entries") return `Entries: ${done} of ${total}`;
  if (stage === "checking") return "Checking everything was saved…";
  return "Finishing…";
}
