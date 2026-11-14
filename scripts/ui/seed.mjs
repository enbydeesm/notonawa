// Journal contents for the walkthrough's chunks, made through the app's
// store (public/js/store/: format 1's API or format 2's records, sealed as
// the app seals them) rather than by clicking, so a
// chunk can start from them without running the chunks that check making
// them. They're what the People, Locations, Plans and Ties chunks make.
// Run on an unlocked page; load a page afterwards, so it shows them.

import { run } from "./harness.mjs";

// Page helpers for seeding: made through the app's store (plain text in,
// sealed on the way, for either format), failing loudly.
const SEED_HELPERS = `
  const add = (kind, fields) => store.saveItem(kind, null, fields);
`;

/**
 * @typedef {{ me: string, sam: string, alex: string, studio: string, hotel: string, oldFlat: string,
 *   hip: string, oneSided: string }} JournalIds
 */

/**
 * People, locations and plans: what the People, Locations and Plans chunks
 * end with.
 * - People: Me; Sam (they/them, bottom by default, an educator based in
 *   Seattle, WA, aka fetlife knotsam and instagram @sam, with notes); Alex,
 *   archived.
 * - Locations: Studio (with a Maps link), Old flat; Hotel, archived. No
 *   default.
 * - Plans: Hip harness (a harness, difficulty 3), and Hip harness,
 *   one-sided, a variation of it.
 * @returns {Promise<JournalIds>}
 */
export function seedJournal() {
  return run(`${SEED_HELPERS}
    const me = (await store.listItems("people", false)).find((p) => p.is_self).id;
    const sam = await add("people", { name: "Sam", pronouns: "they/them", default_role: "bottom", notes: "Prefers floor work",
      based_in: "Seattle, WA", is_educator: true,
      aliases: JSON.stringify([{ platform: "fetlife", alias: "knotsam" }, { platform: "instagram", alias: "@sam" }]) });
    const alex = await add("people", { name: "Alex" });
    await store.archiveItem("people", alex);
    const studio = await add("locations", { name: "Studio", maps_url: "https://maps.app.goo.gl/abc" });
    const hotel = await add("locations", { name: "Hotel", archive_now: true });
    const oldFlat = await add("locations", { name: "Old flat" });
    const hip = await add("plans", { title: "Hip harness", plan_type: "harness", est_difficulty: 3 });
    const oneSided = await add("plans", { title: "Hip harness, one-sided", variation_of: hip });
    return { me, sam, alex, studio, hotel, oldFlat, hip, oneSided };`);
}

/**
 * The tie the Ties chunk logs, and the locations it adds on the way: Garage
 * (archived) and Back garden. "Floor session", today: a floor tie at
 * Studio, Me as top and Sam as bottom, on Hip harness, tagged Futomomo,
 * rated 4, 45 minutes, notes "Smooth transitions", with an album link.
 * @param {JournalIds} ids from seedJournal()
 * @returns {Promise<string>} the tie's id
 */
export function seedTie(ids) {
  return run(`${SEED_HELPERS}
    const ids = ${JSON.stringify(ids)};
    await add("locations", { name: "Garage", archive_now: true });
    await add("locations", { name: "Back garden" });
    const d = new Date();
    const today = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    return store.saveTie(null, { title: "Floor session", tie_type: "floor", tie_date: today, location_id: ids.studio,
      participants: [{ person_id: ids.me, role: "top" }, { person_id: ids.sam, role: "bottom" }], plan_ids: [ids.hip],
      tags: ["Futomomo"], success_rating: 4, duration_minutes: 45, notes: "Smooth transitions",
      album_url: "https://photos.app.goo.gl/floor" });`);
}
