// The walkthrough's share-items chunk: one account shares a tie, a plan and
// a workshop (Share in each one's dialog: what to tick, the name to show
// for me, the code), and a second adds them (/open): who's who (Me, one of
// my people, or a new person even when one of mine has the name), which of
// my locations and plans the tie's are, its drawing and photo, and one that
// looks like it's already in the journal, added again as another copy.

import { check, freshAccount, go, loadPage, run } from "../harness.mjs";
import { seedJournal, seedTie } from "../seed.mjs";

// Opens a share's link in a fresh load of the page (see shares.mjs).
async function openLink(/** @type {string} */ link) {
  await loadPage("/signin");
  await go(link);
}

// Makes the share from the Share dialog that's open, leaving its link (the
// path from /open on) in \`link\`.
const MAKE = (/** @type {Record<string, string | boolean>} */ choices) => `
  for (let i = 0; i < 50 && !$("#share-item-make"); i++) await wait(100);
  ${Object.entries(choices).map(([sel, v]) => `set(${JSON.stringify(sel)}, ${JSON.stringify(v)});`).join(" ")}
  $("#share-item-make").click();
  for (let i = 0; i < 50 && !$("#share-code-link"); i++) await wait(100);
  const full = $("#share-code-link")?.value ?? "";
  const link = full.slice(full.indexOf("/open"));
  $("#share-code-done").click(); await calm(200);`;

// Waits for /open to show what was shared, or say why not.
const OPENED = `for (let i = 0; i < 80 && !$("#open-item") && !$("#open-said"); i++) await wait(100);`;
// Clicks Add to my journal and waits for it to be added or to say why not.
const ADD = `$("#open-add").click();
  for (let i = 0; i < 80 && !$("#open-done") && !$("#open-add-copy") && !$("#open-message.error"); i++) await wait(100);`;

export default async function () {
  await freshAccount();
  console.log("Sharing ties, plans and workshops");
  const ids = await seedJournal();
  const tieId = await seedTie(ids);
  await run(`
    const { sealOne } = await import("/js/vault.js");
    const { caption } = await sealOne("drawing", { caption: "The wrap" });
    await post("/api/drawings", { tie_id: ${JSON.stringify(tieId)}, data: { v: 1, strokes: [{ c: "red", w: 2, p: [10, 20, 30, 40] }] }, caption });
    // A photo, drawn here (as photo-prep.js would leave one) and uploaded.
    const canvas = new OffscreenCanvas(40, 30);
    const g = canvas.getContext("2d"); g.fillStyle = "#c33"; g.fillRect(0, 0, 40, 30);
    const full = await (await canvas.convertToBlob({ type: "image/jpeg" })).arrayBuffer();
    const { uploadPhoto } = await import("/js/photo-upload.js");
    await uploadPhoto({ item: { tie_id: ${JSON.stringify(tieId)} }, prepared: { thumb: full.slice(0), full, mime: "image/jpeg" }, caption: "Front" });
    await post("/api/workshops", { title: "Floor intensive", start_date: "2026-03-01", end_date: "2026-03-02",
      educators: [{ person_id: ${JSON.stringify(ids.sam)}, role: "top" }], participants: [{ person_id: ${JSON.stringify(ids.me)}, role: "bottom" }] });`);

  await go("/");
  check("a saved tie has Share; its dialog ticks everything it has, photos too with what they take of my 1 GB, asks the name to show for me, and explains behind ?s", await run(`
    for (let i = 0; i < 50 && !$(".tie-card"); i++) await wait(100);
    $(".tie-card .tie-date").click();
    for (let i = 0; i < 50 && !$("#tie-share"); i++) await wait(100);
    $("#tie-share").click();
    for (let i = 0; i < 50 && !$("#share-item-make"); i++) await wait(100);
    const fields = [...document.querySelectorAll(".share-item .share-field")].map((l) => [l.innerText, l.querySelector("input").checked]);
    const tips = [...document.querySelectorAll(".share-item .info-text")].map((t) => [t.id, t.hidden]);
    $("[aria-controls=share-item-my-name-info]").click();
    const nameTip = $("#share-item-my-name-info").hidden ? null : $("#share-item-my-name-info").textContent;
    return [fields, $("#share-item-my-name").value, $("label[for=share-item-my-name]").textContent, $("#share-item-always").textContent,
      tips, nameTip, document.querySelectorAll(".share-item p.hint").length, $("#share-item-media-size")?.textContent,
      $("#share-item-expires").value, $("#share-item-uses").value, leakyFields()];`),
  [[["Title: Floor session", true], ["Mins: 45", true], ["Location: Studio", true], ["Plans: Hip harness", true],
    ["People and their roles: you (top), Sam (bottom)", true], ["How did it go?: 4/5", true], ["Notes", true],
    ["Album link", true], ["Drawings and poses: 1 drawing", true], ["Photos and videos: 1 photo", true], ["Tags: Futomomo", true]],
  "", "Your profile name", "Share date and type and…",
  [["share-item-intro", true], ["share-item-my-name-info", true], ["share-item-label-info", true]],
  "The name shared for the 'Me' rows on this tie.", 1,
  "Photos and videos are copied into the share, taking under 0.1 MB of your 1 GB until it ends.", "1d", "one", []]);
  check("it needs a name for me while people are shared", await run(`
    set("#share-item-label", "For Sam"); $("#share-item-make").click(); await calm(500);
    return $("#share-item-status").textContent;`), "Couldn't share it: Type the name to show for you.");
  const tieLink = await run(`${MAKE({ "#share-item-my-name": "Jude", "#share-item-album_url": false, "#share-item-uses": "any" })}
    return link;`);
  check("making it shows its code", /^\/open#[\w-]{22}\.[\w-]{43}$/.test(tieLink), true);
  await run(`[...document.querySelectorAll("dialog[open] .dialog-cancel")].pop()?.click(); await calm(300);`);

  await go("/plans");
  const planLink = await run(`
    for (let i = 0; i < 50 && !$(".plan-card"); i++) await wait(100);
    [...document.querySelectorAll(".plan-card")].find((c) => c.querySelector(".tie-title").innerText === "Hip harness").querySelector(".tie-place").click();
    await calm(400); $("#plan-share").click();
    for (let i = 0; i < 50 && !$("#share-item-make"); i++) await wait(100);
    const legend = [$("#share-item-always").textContent, !!$("#share-item-my-name")];
    ${MAKE({ "#share-item-label": "Plan for Sam" })}
    $("[data-cancel-edit]").click(); await calm(200);
    return [legend, link];`);
  check("a plan's Share says its title is always shared, and asks no name (it has no people)", planLink[0], ["Share title and…", false]);

  await go("/education");
  const workshopLink = await run(`
    for (let i = 0; i < 50 && !$(".workshop-card"); i++) await wait(100);
    $(".workshop-card .tie-title").click(); await calm(1000);
    $("#workshop-share").click();
    for (let i = 0; i < 50 && !$("#share-item-make"); i++) await wait(100);
    const people = [...document.querySelectorAll(".share-item .share-field")].find((l) => l.innerText.startsWith("Educators"))?.innerText;
    ${MAKE({ "#share-item-my-name": "Jude", "#share-item-label": "Workshop" })}
    [...document.querySelectorAll("dialog[open] .dialog-cancel")].pop()?.click(); await calm(200);
    return [people, link];`);
  check("a workshop's Share lists its educators and participants", workshopLink[0],
    "Educators and people, with their roles: Sam (top), you (bottom)");
  await go("/data");
  check("Shared by me lists them by kind", await run(`
    for (let i = 0; i < 30 && document.querySelectorAll(".share-item").length < 3; i++) await wait(100);
    return [...document.querySelectorAll(".share-item .item-meta")].map((m) => m.textContent.split(" · ")[0]);`),
  ["Workshop", "Plan", "Tie"]);

  // Someone else adds them: Sam, who has a different Jude, and a Studio.
  await freshAccount();
  const mine = await run(`
    const { sealOne } = await import("/js/vault.js");
    const jude = await post("/api/people", await sealOne("person", { name: "Jude" }));
    const studio = await post("/api/locations", await sealOne("location", { name: "Studio" }));
    return { jude, studio };`);
  await openLink(tieLink);
  check("the tie's preview shows what was ticked (not the album link) with its photo's thumbnail, and the key gone from the address", await run(`
    ${OPENED}
    for (let i = 0; i < 50 && !$("#open-thumbs img"); i++) await wait(100);
    return [location.pathname + location.hash, $("#open-title")?.textContent, $("#open-place")?.textContent, $("#open-plans")?.textContent,
      $("#open-people")?.textContent, $("#open-notes")?.textContent, $("#open-visuals")?.textContent,
      $("#open-thumbs img")?.src.startsWith("blob:"), $("#open-thumbs figcaption")?.textContent,
      document.body.innerText.includes("Open album"), leakyFields()];`),
  ["/open", "Floor session", "At Studio", "Plans: Hip harness", "With: Jude (top), Sam (bottom)", "Smooth transitions", "1 photo, 1 drawing",
    true, "Front", false, []]);
  check("each person, the location and the plan start from a suggestion: names that match mine, else new", await run(`
    const label = (i) => $("label[for=open-person-" + i + "]").innerText;
    return [label(0), $("#open-person-0").value, label(1), $("#open-person-1").value, $("#open-person-1-name").hidden,
      $("#open-person-1-name").value, $("#open-location").value, $("#open-plan-0").value];`),
  ["Jude Top · shared this", `person:${mine.jude}`, "Sam Bottom", "new", false, "Sam", mine.studio, "new"]);
  check("two people can't both be me", await run(`
    set("#open-person-0", "me"); set("#open-person-1", "me"); $("#open-add").click(); await calm(300);
    return $("#open-message").textContent;`), "Jude and Sam can't both be you: someone is on a tie once.");
  check("adding it with Sam as Me and Jude as a new person saves the tie, linked to my journal, its photo and its drawing, in order", await run(`
    set("#open-person-0", "new"); set("#open-person-1", "me");
    ${ADD}
    const said = [$("#open-done")?.textContent, $("#open-to-view")?.getAttribute("href")];
    const { open } = await import("/js/vault.js");
    const [tie] = await open("tie", (await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json()).ties);
    const people = await (await fetch("/api/people?archived=false")).json();
    const drawings = await open("drawing", await (await fetch("/api/drawings?tie_id=" + tie.id)).json());
    const { openMedia, openPhoto } = await import("/js/vault.js");
    const media = await openMedia(await (await fetch("/api/media?tie_id=" + tie.id)).json());
    const photo = media[0] && new Uint8Array(await openPhoto(media[0].id, "full"));
    const photos = media.map((m) => [m.kind, m.mime, m.caption, m.position < drawings[0].position]);
    const roleOf = (p) => (p.is_self ? "Me" : p.id === ${JSON.stringify(mine.jude)} ? "my Jude" : p.name) + " " ;
    return [said, tie.title, tie.tie_type, tie.duration_minutes, tie.success_rating, tie.notes, tie.album_url, tie.location_id, tie.tags,
      tie.plans.map((p) => p.plan_title),
      tie.participants.map((p) => roleOf(people.find((x) => x.id === p.person_id)) + p.role).sort(),
      people.filter((p) => p.name === "Jude").length, drawings.map((d) => [d.data.strokes.length, d.caption]),
      photos, photo?.[0] === 0xff && photo?.[1] === 0xd8];`),
  [["The tie is in your journal.", "/"], "Floor session", "floor", 45, 4, "Smooth transitions", null, mine.studio, ["Futomomo"], ["Hip harness"],
    ["Jude top", "Me bottom"], 2, [[1, "The wrap"]], [["photo", "image/jpeg", "Front", false]], true]);

  // The same tie again, all from my journal now: it looks like it's there already.
  const newJude = await run(`return (await (await fetch("/api/people?archived=false")).json()).find((p) => p.name === "Jude" && p.id !== ${JSON.stringify(mine.jude)}).id;`);
  await openLink(tieLink);
  check("adding the same tie again says it looks like it's already there, and Add another copy adds it", await run(`
    ${OPENED}
    set("#open-person-0", "person:${newJude}"); set("#open-person-1", "me");
    const plan = $("#open-plan-0").selectedOptions[0].text;
    ${ADD}
    const said = [$("#open-message").textContent, !!$("#open-add-copy"), plan];
    $("#open-add-copy").click(); for (let i = 0; i < 80 && !$("#open-done"); i++) await wait(100);
    const total = (await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json()).total;
    return [said, $("#open-done")?.textContent, total];`),
  [["This tie looks like one already in your journal.", true, "Hip harness"], "The tie is in your journal.", 2]);

  await openLink(planLink[1]);
  check("a shared plan matching one of mine says so too, and adds another copy with its type and difficulty", await run(`
    ${OPENED}
    const shown = [$("#open-title").textContent, $("#open-when").textContent];
    ${ADD}
    const asked = $("#open-message").textContent;
    $("#open-add-copy").click(); for (let i = 0; i < 80 && !$("#open-done"); i++) await wait(100);
    const plans = (await (await fetch("/api/plans?archived=false")).json()).filter((p) => p.title === "Hip harness");
    return [shown, asked, $("#open-done")?.textContent, plans.map((p) => [p.plan_type, p.est_difficulty]).sort()];`),
  [["Hip harness", "Harness"], "This plan looks like one already in your journal.", "The plan is in your journal.",
    [["harness", 3], ["idea", null]]]);

  await openLink(workshopLink[1]);
  check("a shared workshop asks about its educators and participants, and saves them as chosen", await run(`
    ${OPENED}
    const shown = [$("#open-when").textContent, $("#open-educators").textContent, $("#open-people").textContent,
      $("label[for=open-person-0]").innerText, $("label[for=open-person-1]").innerText];
    set("#open-person-0", "me"); set("#open-person-1", "person:${newJude}");
    ${ADD}
    const [w] = await (await fetch("/api/workshops")).json();
    const me = (await (await fetch("/api/people?archived=false")).json()).find((p) => p.is_self).id;
    return [shown, $("#open-done")?.textContent, w.title,
      w.educators.map((p) => [p.person_id === me ? "me" : p.person_name, p.role]), w.participants.map((p) => [p.person_name, p.role])];`),
  [["Mar 1, 2026 – Mar 2, 2026", "Educators: Sam (top)", "People: Jude (bottom)",
    "Sam Top · educator", "Jude Bottom · participant · shared this"],
  "The workshop is in your journal.", "Floor intensive", [["me", "top"]], [["Jude", "bottom"]]]);
}
