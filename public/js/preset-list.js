// What a poser picker lists (preset-picker.js): the built-in presets first,
// in their own order, then my saved ones in alphabetical order, both cut
// down to the ones whose name has what's typed in the search box. Pure.

import { normaliseKeyword } from "./search-match.js";

/**
 * @template B, M
 * @param {{ builtIn: readonly B[], builtInName: (item: B) => string, mine: readonly M[], mineName: (item: M) => string }} lists
 *   each list, and what each of its items is listed as
 * @param {string} [query] the search box's text
 * @returns {{ builtIn: B[], mine: M[] }}
 */
export function presetList({ builtIn, builtInName, mine, mineName }, query = "") {
  const keyword = normaliseKeyword(query);
  const has = (/** @type {string} */ name) => keyword === null || name.toLocaleLowerCase().includes(keyword);
  return {
    builtIn: builtIn.filter((item) => has(builtInName(item))),
    mine: mine.filter((item) => has(mineName(item)))
      .sort((a, b) => mineName(a).localeCompare(mineName(b), undefined, { sensitivity: "base", numeric: true })),
  };
}
