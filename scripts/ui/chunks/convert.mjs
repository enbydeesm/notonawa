// The walkthrough's convert chunk (phase 5): a format 1 journal with
// something of every kind, photos and a video among them, converted to
// format 2 on the device, for real: stopped part-way three times (after
// its files, half-way through its entries, just before the finish) and
// carried on each time, then finished from the Convert view. Afterwards it
// exports exactly as before, its photos are the same bytes, and the old
// rows are gone. Format 1 accounts only: a format 2 run has nothing to
// convert.

import { FORMAT, check, freshAccount, go, run, sql } from "../harness.mjs";
import { seedJournal, seedTie } from "../seed.mjs";

// Stops a run of the conversion at a step, as a closed tab would.
const RUN_TO = (/** @type {string} */ stopAt) => `
  const { convertJournal } = await import("/js/store/convert.js");
  try { await convertJournal({ stopAt: ${JSON.stringify(stopAt)} }); return "finished"; } catch (err) { return err.name; }`;

// The journal as the store exports it, and a hash of each photo's and
// video's bytes, in order.
const SNAPSHOT = `
  const { doc } = await store.exportJournal();
  const media = [...doc.ties, ...doc.plans, ...doc.workshops].flatMap((x) => x.photos ?? []);
  const hashes = [];
  for (const m of media) {
    const bytes = await store.openMediaPart({ id: m.id, kind: m.kind }, "full");
    hashes.push([...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join(""));
  }
  return { doc, hashes };`;

/**
 * An export with its ids swapped for what they name (a conversion gives
 * everything a new id), and nothing that changes by itself.
 * @param {any} doc
 */
function comparable(doc) {
  const names = new Map([
    ...doc.people.map((/** @type {any} */ p) => [p.id, `person:${p.name}`]), ...doc.locations.map((/** @type {any} */ l) => [l.id, `location:${l.name}`]),
    ...doc.plans.map((/** @type {any} */ p) => [p.id, `plan:${p.title}`]), ...doc.ties.map((/** @type {any} */ t) => [t.id, `tie:${t.title}`]),
  ]);
  const name = (/** @type {any} */ id) => (id === null ? null : names.get(id) ?? `?${id}`);
  const visuals = (/** @type {any} */ x) => ({
    photos: (x.photos ?? []).map((/** @type {any} */ p) => [p.kind, p.mime, p.caption, p.position]),
    drawings: (x.drawings ?? []).map((/** @type {any} */ d) => [d.data, d.caption, d.position]),
    poses: (x.poses ?? []).map((/** @type {any} */ d) => [d.data, d.caption, d.position]),
  });
  const strip = (/** @type {any} */ x) => {
    const { id: _id, photos: _p, drawings: _d, poses: _q, ...rest } = x;
    return rest;
  };
  // In a set order: items made in the same second are listed by id, and
  // converting gives each a new one.
  const sorted = (/** @type {any[]} */ list) => [...list].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const parts = {
    presets: doc.account.pose_presets.map((/** @type {any} */ p) => [p.kind, p.name, p.data]),
    people: doc.people.map(strip),
    locations: doc.locations.map(strip),
    plans: doc.plans.map((/** @type {any} */ p) => ({ ...strip(p), variation_of: name(p.variation_of), ...visuals(p) })),
    tags: doc.tags,
    ties: doc.ties.map((/** @type {any} */ t) => ({ ...strip(t), location_id: name(t.location_id), ...visuals(t),
      participants: t.participants.map((/** @type {any} */ p) => ({ ...p, person_id: name(p.person_id) })),
      plans: t.plans.map((/** @type {any} */ p) => ({ ...p, plan_id: name(p.plan_id) })) })),
    workshops: doc.workshops.map((/** @type {any} */ w) => ({ ...strip(w), location_id: name(w.location_id), ...visuals(w),
      educators: w.educators.map((/** @type {any} */ p) => ({ ...p, person_id: name(p.person_id) })),
      participants: w.participants.map((/** @type {any} */ p) => ({ ...p, person_id: name(p.person_id) })),
      ties: w.ties.map(name), plans: w.plans.map(name) })),
  };
  return {
    settings: { top_label: doc.account.settings.top_label, default_shape: doc.account.settings.default_shape },
    ...Object.fromEntries(Object.entries(parts).map(([key, list]) => [key, sorted(list)])),
  };
}

export default async function () {
  console.log("Converting a journal to format 2");
  if (FORMAT === 2) {
    console.log("  (format 1 accounts only: nothing to convert on format 2)");
    return;
  }
  await freshAccount();
  const ids = await seedJournal();
  const tieId = await seedTie(ids);
  // Something of every other kind: a photo and a clip on the tie, a drawing,
  // a pose on a plan, a workshop the tie is linked to, a preset, role names
  // and a default body.
  await run(`
    const tie = ${JSON.stringify(tieId)};
    const canvas = document.createElement("canvas"); canvas.width = 300; canvas.height = 200;
    canvas.getContext("2d").fillRect(0, 0, 150, 100);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    const prepared = await (await import("/js/photo-prep.js")).preparePhoto(new File([blob], "x.jpg", { type: "image/jpeg" }));
    await store.uploadPhoto({ item: { tie_id: tie }, prepared, caption: "Front" });
    const mb = await import("/js/vendor/mediabunny.js");
    const frames = new OffscreenCanvas(64, 48);
    const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
    const source = new mb.CanvasSource(frames, { codec: "avc", bitrate: 2e5 });
    output.addVideoTrack(source, { frameRate: 10 });
    await output.start();
    for (let i = 0; i < 10; i++) { frames.getContext("2d").fillRect(i * 4, 0, 8, 8); await source.add(i / 10, 0.1); }
    await output.finalize();
    const clip = await (await import("/js/video-prep.js")).prepareVideo(new File([output.target.buffer], "c.mp4", { type: "video/mp4" }));
    await store.uploadPhoto({ item: { tie_id: tie }, prepared: clip, caption: "Spin" });
    await store.addDrawing({ tie_id: tie }, { data: { v: 1, strokes: [{ c: "red", w: 2, p: [10, 20, 30, 40] }] }, caption: "Wrap" });
    const { newPose, forSaving } = await import("/js/pose-format.js");
    await store.addPose({ plan_id: ${JSON.stringify(ids.hip)} }, { data: forSaving(newPose()), caption: "Standing" });
    const workshop = await store.saveWorkshop(null, { title: "Intro", start_date: "2026-03-01", cost: "EUR 40.00",
      educators: [{ person_id: ${JSON.stringify(ids.sam)}, role: "top" }], tags: ["Futomomo"] });
    await store.linkToWorkshop(workshop, { tie_id: tie });
    await store.addPosePresets([{ kind: "arms", name: "Box", data: { joints: { l_elbow: [90] } } }]);
    await store.saveSettings({ top_label: "Rigger", default_shape: [50, 50, 50, 170] });`);
  const myId = await run(`return (await (await fetch("/api/keys")).json()).user_id;`);
  const before = await run(SNAPSHOT);
  const status = () => run(`const k = await (await fetch("/api/keys")).json(); return [k.format, k.converting];`);

  check("a run stopped after its files leaves the journal format 1, converting, as it was", [
    await run(RUN_TO("files")), await status(), sql(`SELECT COUNT(*) AS n FROM ties WHERE owner_id = '${myId}'`)[0].n,
  ], ["Stopped", [1, true], 1]);

  await go("/plans");
  check("then, unlocked, the journal waits for the update: it says it was started, and offers to carry on here", await run(`
    return [document.title, !$("#convert-started").hidden, $("#convert-go").textContent, $("nav").hidden];`),
  ["Updating your journal · NotoNawa", true, "Continue on this device", true]);
  await go("/data");
  check("…but Your data still opens, to export first", await run(`return document.title;`), "Your data · NotoNawa");

  check("stopped again half-way through its entries, and again just before the finish: nothing old touched", [
    await run(RUN_TO("half-records")), await run(RUN_TO("finish")), await status(),
    sql(`SELECT COUNT(*) AS n FROM media WHERE owner_id = '${myId}'`)[0].n,
  ], ["Stopped", "Stopped", [1, true], 2]);

  await go("/");
  check("Continue finishes it, and the journal opens as format 2", await run(`
    $("#convert-go").click();
    for (let i = 0; i < 300 && !$("#tie-count"); i++) await wait(100);
    await calm(1000);
    const k = await (await fetch("/api/keys")).json();
    return [k.format, k.converting, document.title, titles().includes("Floor session")];`),
  [2, false, "NotoNawa", true]);

  const after = await run(SNAPSHOT);
  check("the converted journal exports exactly as before: every item, link, caption and visual's place", comparable(after.doc),
    comparable(before.doc));
  check("…its photo and video are the same bytes", after.hashes, before.hashes);
  check("…and the format 1 rows are gone, the records there", [
    sql(`SELECT (SELECT COUNT(*) FROM ties WHERE owner_id = '${myId}') + (SELECT COUNT(*) FROM people WHERE owner_id = '${myId}')
      + (SELECT COUNT(*) FROM media WHERE owner_id = '${myId}') AS n`)[0].n,
    sql(`SELECT COUNT(*) AS n FROM records WHERE owner_id = '${myId}'`)[0].n > 10,
    sql(`SELECT COUNT(*) AS n FROM files WHERE owner_id = '${myId}'`)[0].n,
  ], [0, true, 2]);

  await go("/people");
  check("after unlocking again, it's still all there", await run(`return personNames();`), ["Me", "Sam"]);
}
