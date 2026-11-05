// The walkthrough's drawings chunk. Drawings on ties and plans: the drawing pad (colors, undo, the eraser, downloading
// a picture), captions,
// duplicating, editing a copy on its own, copying to a plan, and export and import.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { readZip } from "../../../public/js/zip.js";
import { check, freshAccount, go, run, send, sleep, workDir } from "../harness.mjs";

/**
 * The PNG downloaded into an empty folder: whether its name is as given, and
 * its width and height (from its header), once it's there.
 * @param {string} folder
 * @param {RegExp} name
 */
async function pngDownloaded(folder, name) {
  for (let i = 0; i < 50; i++) {
    const [file] = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith(".png")) : [];
    if (file) {
      const bytes = readFileSync(path.join(folder, file));
      return [name.test(file), bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    }
    await sleep(100);
  }
  return ["no download"];
}

export default async function () {
  await freshAccount();
  console.log("Drawings");
  await go("/");

  // A line drawn on the pad with real input (Chrome's own mouse or touch
  // events), through points given in canvas units (900 × 1200).
  const drawLine = async (points, pointer = "mouse") => {
    const [left, top, width, height] = await run(`const r = $("#drawing-pad .paper").getBoundingClientRect(); return [r.left, r.top, r.width, r.height];`);
    const at = ([x, y]) => ({ x: left + (x / 900) * width, y: top + (y / 1200) * height });
    if (pointer === "mouse") {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", ...at(points[0]), button: "left", buttons: 1, clickCount: 1 });
      for (const p of points.slice(1)) await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at(p), button: "left", buttons: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at(points.at(-1)), button: "left", buttons: 0, clickCount: 1 });
    } else {
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at(points[0])] });
      for (const p of points.slice(1)) await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [at(p)] });
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await sleep(150);
  };
  const paths = `[...document.querySelectorAll("#drawing-pad .lines path")].map((p) => p.getAttribute("class"))`;
  const tieDrawings = `(async () => {
    const tie = (await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json())
      .ties.find((t) => t.title === "Drawing test");
    return (await fetch("/api/drawings?tie_id=" + tie.id)).json();
  })()`;
  const openTie = `[...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Drawing test").click(); await calm(1500);`;
  const topDialog = `[...document.querySelectorAll("dialog[open]")].pop()`;

  await run(`$(".nav-add").click(); await calm(600); set("#tie-title", "Drawing test"); set("#tie-tie_type", "floor");`);
  check("the tie form has Visuals, with a + to add one and a key to the outline colors", await run(`
    const labels = [...document.querySelectorAll("#tie-form .label-row label")].map((l) => l.textContent);
    const key = $("#tie-form .visual-key");
    return [labels.includes("Visuals"), labels.includes("Drawings"), $("#tie-add-visual").getAttribute("aria-label"),
      key.getAttribute("aria-label"), [...key.children].map((k) => k.title)];`),
  [true, false, "Add visual", "Outline colors: teal photo, purple video, coral drawing, yellow pose", ["Photo", "Video", "Drawing", "Pose"]]);
  check("+ asks what to add a visual from", await run(`
    $("#tie-add-visual").click(); await calm(300);
    const d = ${topDialog};
    return [d.querySelector("h2").textContent, [...d.querySelectorAll(".visual-choice")].map((b) => [b.textContent, !!b.querySelector(".visual-icon")]), leakyFields()];`),
  ["Add a visual from…", [["Photo/video", true], ["Drawing", true], ["Model poser", true]], []]);
  check("the pose icon is its file's shape in the text color, 28px in the chooser and 16px in the key", await run(`
    const icon = $("#tie-add-pose .pose-icon"), style = getComputedStyle(icon), keyIcon = $("#tie-form .visual-key .pose-icon");
    const file = await fetch("/img/poser-icon.svg");
    return [style.maskImage.includes("/img/poser-icon.svg"), style.backgroundColor === getComputedStyle($("#tie-add-pose")).color,
      icon.getBoundingClientRect().width, keyIcon.getBoundingClientRect().width, file.status, file.headers.get("content-type")];`),
  [true, true, 28, 16, 200, "image/svg+xml"]);
  check("Drawing opens the drawing pad, filling the screen, on light paper even in dark mode", await run(`
    $("#tie-add-drawing").click(); await calm(400);
    const pad = $("dialog.drawing-editor[open]"), r = pad.getBoundingClientRect();
    return [document.documentElement.dataset.theme, getComputedStyle($("#drawing-pad .paper")).fill,
      Math.round(r.width) === innerWidth, Math.round(r.height) === innerHeight,
      $("#drawing-color-black").getAttribute("aria-pressed"), $("#drawing-width-2").getAttribute("aria-pressed"),
      $("#drawing-undo").disabled, $("#drawing-download").disabled, leakyFields()];`),
  ["dark", "rgb(255, 253, 248)", true, true, "true", "true", true, true, []]);
  check("undo, redo and download are icons, named for screen readers", await run(`
    return ["#drawing-undo", "#drawing-redo", "#drawing-download"].map((id) => [$(id).getAttribute("aria-label"), !!$(id + " svg"), $(id).textContent]);`),
  [["Undo", true, ""], ["Redo", true, ""], ["Download picture", true, ""]]);

  await run(`$("#drawing-color-red").click();`);
  await drawLine([[100, 100], [300, 100], [500, 100], [800, 100]]);
  await run(`$("#drawing-color-blue").click(); $("#drawing-width-3").click();`);
  await drawLine([[100, 600], [450, 700], [800, 600]], "touch");
  check("lines are drawn with a mouse or a finger, in the chosen colors", await run(`return ${paths};`), ["ink-red", "ink-blue"]);
  check("undo and redo", await run(`
    $("#drawing-undo").click(); const undone = ${paths}; $("#drawing-redo").click();
    return [undone, ${paths}, $("#drawing-redo").disabled];`), [["ink-red"], ["ink-red", "ink-blue"], true]);
  const pictures = path.join(workDir, "downloads-drawing-picture");
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: pictures });
  await run(`$("#drawing-download").click();`);
  check("download saves the drawing to the device, as a PNG the canvas's size",
    await pngDownloaded(pictures, /^notonawa-drawing-\d{4}-\d{2}-\d{2}\.png$/), [true, 900, 1200]);
  await run(`$("#drawing-eraser").click();`);
  await drawLine([[450, 102]]);
  check("the eraser takes out the whole line it touches, and can be undone", await run(`
    const erased = ${paths}; const pressed = $("#drawing-eraser").getAttribute("aria-pressed");
    $("#drawing-undo").click(); return [erased, pressed, ${paths}];`), [["ink-blue"], "true", ["ink-red", "ink-blue"]]);
  check("saved, it waits in the form for the tie", await run(`
    $("#drawing-save").click(); await calm(300);
    return [!!$("dialog.drawing-editor"), document.querySelectorAll("#tie-visuals .visual-drawing").length,
      document.querySelectorAll("#tie-visuals .visual-drawing path").length];`), [false, 1, 2]);
  check("…and is saved with the tie, its lines as drawn, plain, and no caption", await run(`
    $("#tie-save").click(); await calm(2000); await settle();
    const [d] = await ${tieDrawings};
    const red = d.data.strokes[0];
    return [!!document.querySelector("dialog[open]"), d.data.strokes.map((s) => s.c + s.w), d.caption,
      red.p.length, Math.abs(red.p[0] - 100) <= 3 && Math.abs(red.p[1] - 100) <= 3 && Math.abs(red.p.at(-2) - 800) <= 3];`),
  [false, ["red2", "blue3"], null, 4, true]);

  check("a caption is saved encrypted and shown under the drawing", await run(`
    ${openTie} $("#tie-visuals .visual-drawing .photo-thumb").click(); await calm(500);
    set("#tie-drawing-caption", " Front view "); $("#tie-drawing-save-caption").click(); await calm(800);
    const [d] = await ${tieDrawings};
    return [$("#tie-visuals .visual-drawing figcaption")?.textContent, /^e1\\./.test(d.caption), d.caption.includes("Front"), leakyFields()];`),
  ["Front view", true, false, []]);
  check("Duplicate adds a copy last, with the same lines and caption", await run(`
    $("#tie-drawing-duplicate").click(); await calm(1000);
    const message = $("#tie-drawing-viewer-message").textContent;
    ${topDialog}.querySelector(".dialog-cancel, [aria-label=Close]").click(); await calm(300);
    const [a, b] = await ${tieDrawings};
    return [message, [...document.querySelectorAll("#tie-visuals .visual-drawing figcaption")].map((f) => f.textContent),
      JSON.stringify(a.data) === JSON.stringify(b.data), a.id !== b.id];`),
  ["Duplicated: the copy is last, and can be edited on its own.", ["Front view", "Front view"], true, true]);

  await run(`document.querySelectorAll("#tie-visuals .visual-drawing .photo-thumb")[1].click(); await calm(500); $("#tie-drawing-edit").click(); await calm(400);`);
  await run(`$("#drawing-color-green").click();`);
  await drawLine([[100, 1000], [800, 1000]]);
  check("editing the copy changes only the copy", await run(`
    $("#drawing-save").click(); await calm(1000);
    const shown = $("dialog.photo-viewer[open] .drawing-full").querySelectorAll("path").length;
    ${topDialog}.querySelector(".dialog-cancel, [aria-label=Close]").click(); await calm(300);
    const [a, b] = await ${tieDrawings};
    return [shown, a.data.strokes.map((s) => s.c), b.data.strokes.map((s) => s.c)];`),
  [3, ["red", "blue"], ["red", "blue", "green"]]);

  check("Cancel on the pad asks before throwing away what's drawn", await run(`
    $("#tie-visuals .visual-drawing .photo-thumb").click(); await calm(500); $("#tie-drawing-edit").click(); await calm(400);
    return $("#drawing-cancel") !== null;`), true);
  await drawLine([[200, 400], [600, 400]]);
  check("…and nothing's saved", await run(`
    $("#drawing-cancel").click(); await calm(300);
    const asked = ${topDialog}.querySelector("h2").textContent;
    [...${topDialog}.querySelectorAll("button")].find((b) => b.textContent === "Discard changes").click(); await calm(300);
    const [a] = await ${tieDrawings};
    return [asked, !!$("dialog.drawing-editor"), a.data.strokes.length];`),
  ["Discard your changes?", false, 2]);

  await run(`await post("/api/plans", { title: "Harness plan" }); await post("/api/ties", { title: "Other tie", tie_type: "floor", tie_date: "2026-10-01" });`);
  check("Copy to… lists ties (not this one), plans and workshops", await run(`
    $("#tie-drawing-copy").click(); await calm(1000);
    const ties = [...document.querySelectorAll("#drawing-copy-list .item-title")].map((t) => t.textContent);
    $("#drawing-copy-plan").click(); await calm(800);
    const plans = [...document.querySelectorAll("#drawing-copy-list .item-title")].map((t) => t.textContent);
    $("#drawing-copy-workshop").click(); await calm(800);
    const workshops = [$("#drawing-copy-message").textContent, document.querySelectorAll("#drawing-copy-list button").length];
    $("#drawing-copy-plan").click(); await calm(800);
    return [ties, plans, workshops, leakyFields()];`),
  [["Other tie"], ["Harness plan"], ["No workshops yet.", 0], []]);
  check("…and copies it there, caption and all", await run(`
    $("#drawing-copy-list .copy-target").click(); await calm(1000);
    const message = $("#tie-drawing-viewer-message").textContent;
    const plan = (await (await fetch("/api/plans?archived=false")).json()).find((p) => p.title === "Harness plan");
    const [copy] = await (await fetch("/api/drawings?plan_id=" + plan.id)).json();
    const [opened] = await (await import("/js/vault.js")).open("drawing", [copy]);
    const [original] = await ${tieDrawings};
    ${topDialog}.querySelector(".dialog-cancel, [aria-label=Close]").click(); await calm(300);
    [...document.querySelectorAll("dialog[open]")].pop().querySelector(".dialog-cancel, [aria-label=Close]").click(); await calm(300);
    return [message, opened.caption, JSON.stringify(copy.data) === JSON.stringify(original.data)];`),
  ['Copied to "Harness plan".', "Front view", true]);
  await go("/plans");
  check("the plan's form shows it in its visuals", await run(`
    await clickIn("Harness plan", "Edit");
    return [[...document.querySelectorAll("#plan-visuals .visual-drawing figcaption")].map((f) => f.textContent), !!$("#plan-add-visual")];`),
  [["Front view"], true]);
  await run(`$("[data-cancel-edit]").click(); await calm(200);`);

  // Export: a zip with the drawings in notonawa.json and a picture of each.
  const downloads = path.join(workDir, "downloads-drawings");
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await go("/data");
  check("with drawings, export downloads a zip", await run(`
    $("#export").click(); for (let i = 0; i < 50 && !/Downloaded|Couldn't/.test($("#export-message").textContent); i++) await wait(100);
    return $("#export-message").textContent;`), "Downloaded.");
  await sleep(500);
  const zipped = readdirSync(downloads);
  const zipBytes = zipped.length ? readFileSync(path.join(downloads, zipped[0])) : Buffer.alloc(0);
  const zipFiles = zipped.length ? await readZip(zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.length)) : new Map();
  const zipDoc = JSON.parse(new TextDecoder().decode(zipFiles.get("notonawa.json") ?? new TextEncoder().encode("{}")));
  const exported = zipDoc.ties?.find((t) => t.title === "Drawing test")?.drawings ?? [];
  const svg = exported[0] ? new TextDecoder().decode(zipFiles.get(exported[0].file)) : "";
  check("…holding each drawing's lines and caption, and a picture of it", [
    /^notonawa-\d{4}-\d\d-\d\d\.zip$/.test(zipped[0] ?? ""), exported.map((d) => [d.caption, d.data.strokes.length]),
    /^drawings\/.+\.svg$/.test(exported[0]?.file ?? ""), svg.startsWith("<svg"), (svg.match(/<path /g) ?? []).length, svg.includes('stroke="#d63031"'),
  ], [true, [["Front view", 2], ["Front view", 3]], true, true, 2, true]);

  // Into a new journal: the drawings come back on the tie and the plan.
  await freshAccount();
  await go("/data");
  check("importing the zip into another journal brings the drawings back, captions and all", await run(`
    const bytes = Uint8Array.from(atob(${JSON.stringify(zipBytes.toString("base64"))}), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], "export.zip", { type: "application/zip" }));
    $("#import-file").files = dt.files; $("#import-file").dispatchEvent(new Event("change")); await calm(2000);
    const preview = [...document.querySelectorAll("#import-preview .item")].map(flat).filter((t) => t.startsWith("Drawings"));
    $("#import-go").click(); for (let i = 0; i < 80 && !/Imported|Couldn't/.test($("#import-message").textContent); i++) await wait(100);
    const listed = await ${tieDrawings};
    const opened = await (await import("/js/vault.js")).open("drawing", listed);
    return [preview, $("#import-message").textContent, opened.map((d) => [d.caption, d.data.strokes.length])];`),
  [["Drawings | 3 in the file (added to ties, plans and workshops that don't already have drawings)"],
    "Imported 2 ties. Added 3 drawings.", [["Front view", 2], ["Front view", 3]]]);

  await go("/");
  check("deleting a drawing asks first, then removes it", await run(`
    ${openTie} $("#tie-visuals .visual-drawing .photo-thumb").click(); await calm(500);
    $("#tie-drawing-delete").click(); await calm(300);
    const asked = ${topDialog}.querySelector("h2").textContent;
    [...${topDialog}.querySelectorAll("button")].find((b) => b.textContent === "Delete drawing").click(); await calm(800);
    return [asked, document.querySelectorAll("#tie-visuals .visual-drawing").length, (await ${tieDrawings}).length];`),
  ["Delete this drawing?", 1, 1]);
}
