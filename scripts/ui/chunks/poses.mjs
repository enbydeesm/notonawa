// The walkthrough's poses chunk. Poses on ties: the poser (body and arms
// presets, posing a part with a slider, undo, laying a rope with taps, the
// ring, bamboo and hashira, "Add to visuals"), saving with the tie,
// captions, duplicating, and export and import. Taps on the 3D view are real input (Chrome's own mouse events),
// so a 3D view that doesn't draw, or picks the wrong thing, shows up here.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { readZip } from "../../../public/js/zip.js";
import { check, freshAccount, go, run, send, sleep, workDir } from "../harness.mjs";

export default async function () {
  await freshAccount();
  console.log("Poses");
  await go("/");

  // A tap on the 3D view, at a fraction of its width and height.
  const tap = async (fx, fy) => {
    const [left, top, width, height] = await run(`const r = $("#pose-view").getBoundingClientRect(); return [r.left, r.top, r.width, r.height];`);
    const at = { x: left + fx * width, y: top + fy * height };
    await send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", buttons: 1, clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", buttons: 0, clickCount: 1 });
    await sleep(250);
  };
  // A drag across the view (turning it).
  const drag = async (fx0, fx1, fy) => {
    const [left, top, width, height] = await run(`const r = $("#pose-view").getBoundingClientRect(); return [r.left, r.top, r.width, r.height];`);
    const at = (fx) => ({ x: left + fx * width, y: top + fy * height });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", ...at(fx0), button: "left", buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++) await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at(fx0 + ((fx1 - fx0) * i) / 8), button: "left", buttons: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at(fx1), button: "left", buttons: 0, clickCount: 1 });
    await sleep(250);
  };
  // A slider moved as a finger would: input while dragging, change when let go.
  const slide = (id, value) => `{ const el = $("#${id}"); el.value = "${value}"; el.dispatchEvent(new Event("input")); el.dispatchEvent(new Event("change")); await wait(200); }`;
  const tiePoses = `(async () => {
    const tie = (await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json())
      .ties.find((t) => t.title === "Pose test");
    return (await fetch("/api/poses?tie_id=" + tie.id)).json();
  })()`;
  const openTie = `[...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Pose test").click(); await wait(1500);`;
  const topDialog = `[...document.querySelectorAll("dialog[open]")].pop()`;

  await run(`$(".nav-add").click(); await wait(600); set("#tie-title", "Pose test"); set("#tie-tie_type", "suspension");`);
  check("the Visuals + offers the model poser", await run(`
    $("#tie-add-visual").click(); await wait(300);
    return $("#tie-add-pose").textContent;`), "Model poser");
  check("it opens the poser, filling the screen, with the 3D view drawn and Pose chosen", await run(`
    $("#tie-add-pose").click();
    for (let i = 0; i < 100 && !document.querySelector("dialog.pose-editor[open]"); i++) await wait(100);
    await wait(500);
    const editor = $("dialog.pose-editor[open]"), r = editor.getBoundingClientRect(), view = $("#pose-view").getBoundingClientRect();
    return [Math.round(r.width) === innerWidth, Math.round(r.height) === innerHeight, view.width > 200, view.height > 150,
      $("#pose-mode-pose").getAttribute("aria-pressed"), $("#pose-part").textContent, $("#pose-undo").disabled, leakyFields()];`),
  [true, true, true, true, "true", "Tap a body part to pose it", true, []]);

  check("the help, the views top right, and menus for the body and the arms", await run(`
    const options = (id) => [...$(id).options].map((o) => o.textContent);
    const frame = $(".pose-frame").getBoundingClientRect(), views = $("#pose-view-choice").getBoundingClientRect();
    return [$(".pose-hint").textContent, Math.round(frame.right - views.right) < 12 && Math.round(views.top - frame.top) < 12,
      options("#pose-body-preset").slice(0, 4), options("#pose-arms-preset"), $("#pose-add-visual").textContent];`),
  ["Drag to turn · two-finger drag to pan · pinch to zoom", true, ["Body…", "Standing", "Kneeling", "Kneeling up"],
    ["Arms…", "At sides", "Behind back", "Crossed in front", "Arms behind head"], "Add to visuals"]);
  check("an arms position can be chosen, and undone", await run(`
    set("#pose-arms-preset", "1"); await wait(300);
    const after = $("#pose-undo").disabled;
    $("#pose-undo").click(); await wait(200);
    const undone = $("#pose-redo").disabled;
    $("#pose-redo").click(); await wait(200);
    return [after, undone, $("#pose-arms-preset").value];`), [false, false, ""]);

  // The view looks at the figure's hips, in the middle.
  await tap(0.5, 0.5);
  check("tapping the figure's middle picks its hips, with sliders for the whole body", await run(`
    return [$("#pose-part").textContent, [...document.querySelectorAll("#pose-sliders label")].map((l) => l.textContent), leakyFields()];`),
  ["Hips and whole body", ["Tip forward", "Turn", "Roll", "Height (cm)"], []]);
  // Turning keeps the hips in the middle of the view, for the taps below.
  const turned = `[...document.querySelectorAll("#pose-sliders output")][1].textContent`;
  check("a slider moves the body, as one change to undo", await run(`
    ${slide("pose-body-1", 20)}
    return [${turned}, $("#pose-undo").disabled];`), ["20", false]);

  await drag(0.3, 0.6, 0.8);
  check("dragging turns the view, which undo leaves alone", await run(`
    $("#pose-undo").click(); await wait(200);
    return ${turned};`), "0");
  await run(`$("#pose-redo").click(); await wait(200);`);

  check("Rope mode: thickness, the eraser and Finish rope above the colors, and a ring, bamboo or hashira to add", await run(`
    $("#pose-mode-rope").click(); await wait(200);
    const rows = [...$("#pose-panel-rope").children].map((c) => c.getAttribute("aria-label"));
    const finish = $("#pose-finish-rope"), row = finish.parentElement;
    const before = [$("#pose-panel-pose").hidden, ["ring", "bamboo", "hashira"].map((k) => $("#pose-" + k).textContent), finish.disabled,
      row.lastElementChild === finish];
    $("#pose-ring").click(); await wait(200);
    return [rows.slice(0, 2), ...before, $("#pose-ring").textContent, document.querySelectorAll("#pose-hardpoint-sliders input[type=range]").length, leakyFields()];`),
  [["Rope thickness", "Rope color"], true, ["Add ring", "Add bamboo", "Add hashira"], true, true, "Remove ring", 3, []]);

  await tap(0.5, 0.5);
  await tap(0.5, 0.38);
  check("tapping the body lays a rope, point by point", await run(`
    return [$("#pose-rope-hint").textContent, $("#pose-finish-rope").disabled];`),
  ["Rope: 2 points. Keep tapping, then Finish rope.", false]);
  check("Undo takes back the last point first", await run(`
    $("#pose-undo").click(); await wait(200); const one = $("#pose-rope-hint").textContent;
    return one;`), "Rope: 1 point. Keep tapping, then Finish rope.");
  await tap(0.5, 0.4);
  await run(`$("#pose-finish-rope").click(); await wait(200);`);

  check("Add to visuals puts a picture of the pose into the form's visuals, as a photo", await run(`
    $("#pose-add-visual").click();
    for (let i = 0; i < 100 && !/Added|Couldn't/.test($("#pose-message").textContent); i++) await wait(100);
    return [$("#pose-message").textContent, document.querySelectorAll("#tie-visuals .visual-photo img").length];`),
  ["Added to visuals, as a photo.", 1]);
  check("saved, the pose waits in the form for the tie, drawn as a picture, after the photo", await run(`
    $("#pose-save").click();
    for (let i = 0; i < 50 && !document.querySelector("#tie-visuals .visual-pose img"); i++) await wait(100);
    return [!!$("dialog.pose-editor"), [...document.querySelectorAll("#tie-visuals .photo-tile")].map((t) => t.className),
      ($("#tie-visuals .visual-pose img")?.src ?? "").startsWith("blob:")];`), [false, ["photo-tile visual-photo", "photo-tile visual-pose"], true]);
  check("…and is saved with the tie: the figure, the ring and the rope, plain, and the picture sealed like any photo", await run(`
    $("#tie-save").click(); await wait(3000); await settle();
    const [p] = await ${tiePoses};
    const tie = (await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json())
      .ties.find((t) => t.title === "Pose test");
    const media = await (await fetch("/api/media?tie_id=" + tie.id)).json();
    return [!!document.querySelector("dialog[open]"), p.data.body, p.data.joints.l_elbow, p.data.ring, p.data.ropes.length,
      p.data.ropes[0].p.length, p.caption, media.map((m) => [m.kind, m.position]), p.position];`),
  [false, [0, 20, 0], [100], [0, 195, 0], 1, 2, null, [["photo", 0]], 1]);

  check("a caption is saved encrypted and shown under the pose", await run(`
    ${openTie} $("#tie-visuals .visual-pose .photo-thumb").click(); await wait(800);
    set("#tie-pose-caption", " Lift "); $("#tie-pose-save-caption").click(); await wait(800);
    const [p] = await ${tiePoses};
    return [$("#tie-visuals .visual-pose figcaption")?.textContent, /^e1\\./.test(p.caption), p.caption.includes("Lift"), leakyFields()];`),
  ["Lift", true, false, []]);
  check("its details: Edit pose above the caption, the moves and Duplicate and Copy to… in rows, no Add as photo", await run(`
    const d = ${topDialog};
    const order = [...d.children].map((c) => c.id || c.className);
    const edit = order.indexOf("tie-pose-edit"), caption = order.indexOf("tie-pose-caption");
    return [edit > 0 && edit < caption, $("#tie-pose-edit").className, $("#tie-pose-duplicate").parentElement === $("#tie-pose-copy").parentElement,
      $("#tie-pose-earlier").parentElement === $("#tie-pose-later").parentElement, !!$("#tie-pose-photo")];`),
  [true, "outline-accent wide", true, true, false]);
  check("Edit pose: a bamboo in place of the ring, then a hashira, its own sliders each; nothing kept on Cancel", await run(`
    $("#tie-pose-edit").click();
    for (let i = 0; i < 100 && !document.querySelector("dialog.pose-editor[open]"); i++) await wait(100);
    await wait(300);
    $("#pose-mode-rope").click(); await wait(100);
    $("#pose-bamboo").click(); await wait(200);
    const bamboo = [["ring", "bamboo", "hashira"].map((k) => $("#pose-" + k).textContent), $("#pose-rope-hint").textContent,
      document.querySelectorAll("#pose-hardpoint-sliders input[type=range]").length];
    // No rope is on the bamboo, so nothing to ask about.
    $("#pose-hashira").click(); await wait(300);
    const asked = ${topDialog}.classList.contains("pose-editor");
    const hashira = [$("#pose-hashira").textContent, document.querySelectorAll("#pose-hardpoint-sliders input[type=range]").length];
    $("#pose-cancel").click(); await wait(300);
    [...${topDialog}.querySelectorAll("button")].find((b) => b.textContent === "Discard changes").click(); await wait(300);
    const [p] = await ${tiePoses};
    return [bamboo, asked, hashira, !!$("dialog.pose-editor"), p.data.ring];`),
  [[["Add ring", "Remove bamboo", "Add hashira"], "Tap the body to lay a rope, point by point. Tap the bamboo for an upline.", 4],
    true, ["Remove hashira", 3], false, [0, 195, 0]]);
  check("Duplicate adds a copy last, with the same pose and caption", await run(`
    $("#tie-pose-duplicate").click(); await wait(1000);
    ${topDialog}.querySelector(".dialog-cancel").click(); await wait(300);
    const [a, b] = await ${tiePoses};
    return [[...document.querySelectorAll("#tie-visuals .visual-pose figcaption")].map((f) => f.textContent),
      JSON.stringify(a.data) === JSON.stringify(b.data), a.id !== b.id];`),
  [["Lift", "Lift"], true, true]);
  await run(`${topDialog}.querySelector(".dialog-cancel").click(); await wait(300);`);

  // Export: the poses are in notonawa.json (a zip, as there's a photo now).
  const downloads = path.join(workDir, "downloads-poses");
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await go("/data");
  check("export downloads a zip", await run(`
    $("#export").click(); for (let i = 0; i < 80 && !/Downloaded|Couldn't/.test($("#export-message").textContent); i++) await wait(100);
    return $("#export-message").textContent;`), "Downloaded.");
  await sleep(500);
  const zipped = readdirSync(downloads);
  const zipBytes = zipped.length ? readFileSync(path.join(downloads, zipped[0])) : Buffer.alloc(0);
  const zipFiles = zipped.length ? await readZip(zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.length)) : new Map();
  const zipDoc = JSON.parse(new TextDecoder().decode(zipFiles.get("notonawa.json") ?? new TextEncoder().encode("{}")));
  const exported = zipDoc.ties?.find((t) => t.title === "Pose test")?.poses ?? [];
  check("…holding each pose and its caption", exported.map((p) => [p.caption, p.data.ropes.length, p.data.body[1]]),
    [["Lift", 1, 20], ["Lift", 1, 20]]);

  await freshAccount();
  await go("/data");
  check("importing it into another journal brings the poses back, captions and all", await run(`
    const bytes = Uint8Array.from(atob(${JSON.stringify(zipBytes.toString("base64"))}), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], "export.zip", { type: "application/zip" }));
    $("#import-file").files = dt.files; $("#import-file").dispatchEvent(new Event("change")); await wait(2000);
    const preview = [...document.querySelectorAll("#import-preview .item")].map(flat).filter((t) => t.startsWith("Poses"));
    $("#import-go").click(); for (let i = 0; i < 100 && !/Imported|Couldn't/.test($("#import-message").textContent); i++) await wait(100);
    const listed = await ${tiePoses};
    const opened = await (await import("/js/vault.js")).open("pose", listed);
    return [preview, /Added 2 poses\\./.test($("#import-message").textContent), opened.map((p) => [p.caption, p.data.body[1]])];`),
  [["Poses | 2 in the file (added to ties, plans and workshops that don't already have poses)"], true, [["Lift", 20], ["Lift", 20]]]);

  await go("/");
  check("deleting a pose asks first, then removes it", await run(`
    ${openTie} $("#tie-visuals .visual-pose .photo-thumb").click(); await wait(800);
    $("#tie-pose-delete").click(); await wait(300);
    const asked = ${topDialog}.querySelector("h2").textContent;
    [...${topDialog}.querySelectorAll("button")].find((b) => b.textContent === "Delete pose").click(); await wait(800);
    return [asked, document.querySelectorAll("#tie-visuals .visual-pose").length, (await ${tiePoses}).length];`),
  ["Delete this pose?", 1, 1]);
}
