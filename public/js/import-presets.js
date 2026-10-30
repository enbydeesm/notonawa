// An import's saved poser presets (an export lists them in its account):
// which to add. Pure, so it's easy to test. A preset is added unless one
// of the same kind and name is already there (or earlier in the file), and
// only as many as the account has room for; the server checks the angles.

import { jointsInReach } from "./figure-rig.js";

/** @typedef {{ kind: "body" | "arms", name: string, data: Record<string, any> }} PresetEntry */

/**
 * @param {unknown} list the file's account.pose_presets (names as read: plain text)
 * @param {{ kind: string, name: string | null }[]} mine my presets, names opened
 * @param {number} room how many more the account can keep
 * @returns {{ add: PresetEntry[], skipped: number, full: number }}
 */
export function presetsToAdd(list, mine, room) {
  const key = (/** @type {string} */ kind, /** @type {string} */ name) => `${kind}\n${name.trim()}`;
  const have = new Set(mine.filter((p) => p.name !== null).map((p) => key(p.kind, /** @type {string} */ (p.name))));
  /** @type {PresetEntry[]} */
  const add = [];
  let skipped = 0;
  let full = 0;
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || (p.kind !== "body" && p.kind !== "arms") || typeof p.name !== "string" || !p.name.trim()
      || !p.data || typeof p.data !== "object") continue;
    const k = key(p.kind, p.name);
    if (have.has(k)) {
      skipped++;
      continue;
    }
    have.add(k);
    if (add.length >= room) {
      full++;
      continue;
    }
    // One exported before the joints' limits changed is brought within them.
    add.push({ kind: p.kind, name: p.name.trim(), data: jointsInReach(p.data) });
  }
  return { add, skipped, full };
}
