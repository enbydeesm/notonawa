// A person's scene names and social handles ("Social & Scene Names" on the
// People form). Stored as one encrypted field (people.aliases): a JSON list
// of { platform, alias }, opened on the device. Pure, so it's easy to test.

/**
 * @typedef {"scene" | "fetlife" | "instagram" | "x" | "bluesky" | "other"} Platform
 * @typedef {{ platform: Platform, alias: string }} Alias
 */

/**
 * The platforms, in the form's order. short: how the "aka" line names it
 * (a scene name, or "other", is just the name).
 * @type {{ value: Platform, label: string, short: string | null }[]}
 */
export const PLATFORMS = [
  { value: "scene", label: "Scene name", short: null },
  { value: "fetlife", label: "FetLife", short: "fetlife" },
  { value: "instagram", label: "Instagram", short: "instagram" },
  { value: "x", label: "X/Twitter", short: "x" },
  { value: "bluesky", label: "Bluesky", short: "bluesky" },
  { value: "other", label: "Other", short: null },
];

const KNOWN = new Set(PLATFORMS.map((p) => p.value));

/**
 * The aliases in a list, tidied: each has a known platform (else "other")
 * and some text. Anything else is dropped.
 * @param {unknown} list
 * @returns {Alias[]}
 */
export function tidyAliases(list) {
  if (!Array.isArray(list)) return [];
  /** @type {Alias[]} */
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const alias = typeof entry.alias === "string" ? entry.alias.trim().replace(/\s+/g, " ") : "";
    if (!alias) continue;
    const platform = KNOWN.has(entry.platform) ? entry.platform : "other";
    out.push({ platform: /** @type {Platform} */ (platform), alias });
  }
  return out;
}

/**
 * The aliases in an opened people.aliases field. Text that isn't a list of
 * them (damaged, or typed in by hand) reads as none.
 * @param {unknown} text
 * @returns {Alias[]}
 */
export function readAliases(text) {
  if (typeof text !== "string" || text === "") return [];
  try {
    return tidyAliases(JSON.parse(text));
  } catch {
    return [];
  }
}

/**
 * What's saved (before it's sealed): JSON text, or null when there are none.
 * @param {unknown} list
 * @returns {string | null}
 */
export function aliasesText(list) {
  const aliases = tidyAliases(list);
  return aliases.length ? JSON.stringify(aliases) : null;
}

/**
 * Scene names first, then the rest in the order they were entered.
 * @param {Alias[]} aliases
 * @returns {Alias[]}
 */
export function sceneFirst(aliases) {
  return [...aliases.filter((a) => a.platform === "scene"), ...aliases.filter((a) => a.platform !== "scene")];
}

/**
 * The People card's "aka" line, e.g. "aka therawkitty · fetlife: rawkitty",
 * or null when there are none.
 * @param {Alias[]} aliases
 * @returns {string | null}
 */
export function akaText(aliases) {
  if (!aliases.length) return null;
  const named = sceneFirst(aliases).map(({ platform, alias }) => {
    const short = PLATFORMS.find((p) => p.value === platform)?.short;
    return short ? `${short}: ${alias}` : alias;
  });
  return `aka ${named.join(" · ")}`;
}

/**
 * Whether a person matches what's typed in a search (their name or any
 * alias, ignoring capitals), and how to show them:
 * - an alias matches: "Name (that alias)";
 * - otherwise (the name matches, or nothing's typed): "Name (first scene
 *   name)", or just the name if they have no scene name.
 * @param {string} name
 * @param {Alias[]} aliases
 * @param {string} query
 * @returns {{ matches: boolean, label: string }}
 */
export function personMatch(name, aliases, query) {
  const wanted = query.trim().toLocaleLowerCase();
  if (wanted) {
    const hit = sceneFirst(aliases).find((a) => a.alias.toLocaleLowerCase().includes(wanted));
    if (hit) return { matches: true, label: `${name} (${hit.alias})` };
    if (!name.toLocaleLowerCase().includes(wanted)) return { matches: false, label: name };
  }
  const scene = aliases.find((a) => a.platform === "scene");
  return { matches: true, label: scene ? `${name} (${scene.alias})` : name };
}
