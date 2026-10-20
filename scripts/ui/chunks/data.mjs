// The walkthrough's data chunk. Your data: export (JSON, and a zip with photos) and import (CSV, an export, a zip).

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { readZip } from "../../../public/js/zip.js";
import { check, freshAccount, go, run, send, sleep, workDir } from "../harness.mjs";
import { seedJournal, seedTie } from "../seed.mjs";

export default async function () {
  await freshAccount();
  await seedTie(await seedJournal());
  console.log("Your data");
  const downloads = path.join(workDir, "downloads");
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await go("/data");
  check("the data page is in the menu, and its fields are kept out of form history", await run(`
    await openMenu(); const current = $(".nav-data").getAttribute("aria-current"); $("dialog.menu-panel").close();
    return [current, leakyFields()];`), ["page", []]);
  check("export downloads the whole journal", await run(`
    $("#export").click(); await wait(1500); return $("#export-message").textContent;`), "Downloaded.");
  await sleep(500);
  const exported = readdirSync(downloads);
  check("…as a dated JSON file", exported.length === 1 && /^notonawa-\d{4}-\d\d-\d\d\.json$/.test(exported[0]), true);
  const exportText = exported.length ? readFileSync(path.join(downloads, exported[0]), "utf8") : "{}";
  const exportDoc = JSON.parse(exportText);
  check("the file has every tie, and the people", [exportDoc.format, exportDoc.ties?.length, exportDoc.people?.map((p) => p.name).sort()],
    ["notonawa-export", 1, ["Alex", "Me", "Sam"]]);
  check("…with the notes decrypted on the device, nothing left encrypted",
    [exportDoc.ties?.find((t) => t.title === "Floor session")?.notes ?? null, exportDoc.people?.find((p) => p.name === "Sam")?.based_in ?? null,
      exportText.includes('"e1.')],
    ["Smooth transitions", "Seattle, WA", false]);
  // A location the journal already has, for the CSV to match.
  const place = exportDoc.locations?.[0]?.name ?? "";
  // Picks a file in the import box, as if chosen in the file dialog.
  const chooseFile = (name, type, text) => run(`
    const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }));
    $("#import-file").files = dt.files; $("#import-file").dispatchEvent(new Event("change")); await wait(1500);
    return [[...document.querySelectorAll("#import-preview .item")].map(flat), $("#import-go").hidden ? null : $("#import-go").textContent,
      $("#import-message").textContent];`);
  const csv = `date,title,type,people,location,tags\n2026-11-01,Imported one,floor,alex (model); Robin (rigger),${place},imported\n2026-11-02,Imported two,hashira,,Beach,\n`;
  check("a CSV shows what will happen before anything is saved", await chooseFile("ties.csv", "text/csv", csv), [[
    "Ties | 2 to add",
    "People | 1 new: Robin | 1 already in your journal: alex",
    `Locations | 1 new: Beach | 1 already in your journal: ${place}`,
    "Tags | 1 new: imported",
  ], "Import 2 ties", ""]);
  check("importing it adds the ties", await run(`
    $("#import-go").click(); await wait(2000); const msg = $("#import-message").textContent;
    const res = await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page_size: 100 }) })).json();
    return [msg, $("#import-go").hidden, res.ties.filter((t) => t.title?.startsWith("Imported"))
      .map((t) => [t.title, t.location_name, t.participants.map((p) => p.person_name + ":" + p.role).sort()])];`),
    ["Imported 2 ties.", true, [["Imported two", "Beach", []], ["Imported one", place, ["Alex:bottom", "Robin:top"]]]]);
  check("a CSV with mistakes lists them by row, and saves nothing", await chooseFile("bad.csv", "text/csv", "date,title\n12/10/2026,x\n"),
    [[], null, 'Fix these in the file, then choose it again:\nRow 2: Write the date as year-month-day, like 2026-10-12 (not "12/10/2026").']);
  check("importing the export into the same journal has nothing to add", (await chooseFile(exported[0] ?? "x.json", "application/json", exportText)).slice(1),
    [null, "Everything in this file is already in your journal."]);
  check("a file that isn't an export is refused", (await chooseFile("notes.json", "application/json", '{"hello":1}'))[2],
    "This isn't a NotoNawa export.");

  // With photos, the export is a zip that imports back.
  const photoTie = await run(`
    const id = await post("/api/ties", { title: "Zip test", tie_type: "floor", tie_date: "2026-11-05" });
    const canvas = document.createElement("canvas"); canvas.width = 300; canvas.height = 200;
    canvas.getContext("2d").fillRect(0, 0, 150, 100);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    const prepared = await (await import("/js/photo-prep.js")).preparePhoto(new File([blob], "x.jpg", { type: "image/jpeg" }));
    await (await import("/js/photo-upload.js")).uploadPhoto({ item: { tie_id: id }, prepared, caption: "Zip caption" });
    return id;`);
  const zipDownloads = path.join(workDir, "downloads-zip");
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: zipDownloads });
  check("with photos, export downloads a zip", await run(`
    $("#export").click(); for (let i = 0; i < 50 && !/Downloaded|Couldn't/.test($("#export-message").textContent); i++) await wait(100);
    return $("#export-message").textContent;`), "Downloaded.");
  await sleep(800);
  const zipped = readdirSync(zipDownloads);
  const zipBytes = zipped.length ? readFileSync(path.join(zipDownloads, zipped[0])) : Buffer.alloc(0);
  const zipFiles = zipped.length ? await readZip(zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.length)) : new Map();
  const zipDoc = JSON.parse(new TextDecoder().decode(zipFiles.get("notonawa.json") ?? new TextEncoder().encode("{}")));
  const zipPhoto = zipDoc.ties?.find((t) => t.title === "Zip test")?.photos?.[0];
  const photoBytes = zipPhoto ? zipFiles.get(zipPhoto.file) : null;
  check("…holding the journal and the photo, decrypted, with its caption", [
    /^notonawa-\d{4}-\d\d-\d\d\.zip$/.test(zipped[0] ?? ""), zipPhoto?.caption, zipPhoto?.file?.startsWith("photos/"),
    photoBytes ? new TextDecoder("latin1").decode(photoBytes.subarray(0, 12)).replace(/^RIFF.{4}/s, "RIFF") : null,
  ], [true, "Zip caption", true, "RIFFWEBP"]);
  // The photo is deleted, then the zip imported: it comes back on the tie.
  await run(`const [m] = await (await fetch("/api/media?tie_id=${photoTie}")).json(); await fetch("/api/media/" + m.id, { method: "DELETE" });`);
  const chooseZip = () => run(`
    const bytes = Uint8Array.from(atob(${JSON.stringify(zipBytes.toString("base64"))}), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], ${JSON.stringify(zipped[0] ?? "x.zip")}, { type: "application/zip" }));
    $("#import-file").files = dt.files; $("#import-file").dispatchEvent(new Event("change")); await wait(2000);
    return [[...document.querySelectorAll("#import-preview .item")].map(flat).filter((t) => t.startsWith("Photos")), $("#import-go").hidden ? null : $("#import-go").textContent];`);
  check("importing the zip previews its photos", await chooseZip(),
    [["Photos | 1 in the file (added to ties and plans that don't already have photos)"], "Import"]);
  check("…and puts the photo back on its tie, with its caption", await run(`
    $("#import-go").click(); for (let i = 0; i < 80 && !/Imported|Couldn't/.test($("#import-message").textContent); i++) await wait(100);
    const listed = await (await fetch("/api/media?tie_id=${photoTie}")).json();
    const opened = await (await import("/js/vault.js")).openMedia(listed);
    return [$("#import-message").textContent, opened.map((p) => p.caption)];`),
    ["Imported 0 ties. Skipped 4 ties already in your journal. Added 1 photo.", ["Zip caption"]]);
  check("importing it again doesn't add the photo twice", (await chooseZip(), await run(`
    $("#import-go").click(); for (let i = 0; i < 80 && !/Imported|Couldn't/.test($("#import-message").textContent); i++) await wait(100);
    return [$("#import-message").textContent, (await (await fetch("/api/media?tie_id=${photoTie}")).json()).length];`)),
    ["Imported 0 ties. Skipped 4 ties already in your journal. Skipped 1 photo on ties or plans that already have photos.", 1]);
}
