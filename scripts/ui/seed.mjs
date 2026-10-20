// Journal contents for the walkthrough's chunks, made through the API (with
// notes sealed on the page, as the app does) rather than by clicking, so a
// chunk can start from them without running the chunks that check making
// them. They're what the People, Locations, Plans and Ties chunks make.
// Run on an unlocked page; load a page afterwards, so it shows them.

import { run } from "./harness.mjs";

// Page helpers for seeding: a POST that fails loudly, and sealing first.
const SEED_HELPERS = `
  const { sealOne } = await import("/js/vault.js");
  const add = async (path, body, kind) => {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(kind ? await sealOne(kind, body) : body) });
    const text = await res.text();
    if (!res.ok) throw new Error("Seeding " + path + " failed: " + res.status + " " + text);
    return text ? JSON.parse(text).id : null;
  };
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
    const me = (await (await fetch("/api/people?archived=false")).json()).find((p) => p.is_self).id;
    const sam = await add("/api/people", { name: "Sam", pronouns: "they/them", default_role: "bottom", notes: "Prefers floor work",
      based_in: "Seattle, WA", is_educator: true,
      aliases: JSON.stringify([{ platform: "fetlife", alias: "knotsam" }, { platform: "instagram", alias: "@sam" }]) }, "person");
    const alex = await add("/api/people", { name: "Alex" }, "person");
    await add("/api/people/" + alex + "/archive", {});
    const studio = await add("/api/locations", { name: "Studio", maps_url: "https://maps.app.goo.gl/abc" }, "location");
    const hotel = await add("/api/locations", { name: "Hotel", archive_now: true }, "location");
    const oldFlat = await add("/api/locations", { name: "Old flat" }, "location");
    const hip = await add("/api/plans", { title: "Hip harness", plan_type: "harness", est_difficulty: 3 }, "plan");
    const oneSided = await add("/api/plans", { title: "Hip harness, one-sided", variation_of: hip }, "plan");
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
    await add("/api/locations", { name: "Garage", archive_now: true }, "location");
    await add("/api/locations", { name: "Back garden" }, "location");
    const d = new Date();
    const today = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    return add("/api/ties", { title: "Floor session", tie_type: "floor", tie_date: today, location_id: ids.studio,
      participants: [{ person_id: ids.me, role: "top" }, { person_id: ids.sam, role: "bottom" }], plan_ids: [ids.hip],
      tags: ["Futomomo"], success_rating: 4, duration_minutes: 45, notes: "Smooth transitions",
      album_url: "https://photos.app.goo.gl/floor" }, "tie");`);
}
