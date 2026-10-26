// The walkthrough's poses chunk. Poses on ties: the poser (body and arms
// presets, saving my own and managing them, posing a part with a slider, the head and hips moving the whole
// figure, typing a slider's number, dragging a leg, undo, downloading a picture, laying a rope with taps, the ring,
// bamboo and hashira, "Add to visuals"), saving with the tie,
// captions, duplicating, and export and import. Taps on the 3D view are real input (Chrome's own mouse events),
// so a 3D view that doesn't draw, or picks the wrong thing, shows up here.

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
  // A drag across the view (turning it, or moving a limb it starts on).
  const drag = async (fx0, fx1, fy0, fy1 = fy0) => {
    const [left, top, width, height] = await run(`const r = $("#pose-view").getBoundingClientRect(); return [r.left, r.top, r.width, r.height];`);
    const at = (t) => ({ x: left + (fx0 + (fx1 - fx0) * t) * width, y: top + (fy0 + (fy1 - fy0) * t) * height });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", ...at(0), button: "left", buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++) await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at(i / 8), button: "left", buttons: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at(1), button: "left", buttons: 0, clickCount: 1 });
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

  check("the help on one line, the views top right on the floor's grey, and menus for the body and the arms", await run(`
    const options = (id) => [...$(id).options].map((o) => o.textContent);
    const frame = $(".pose-frame").getBoundingClientRect(), views = $("#pose-view-choice").getBoundingClientRect();
    const hint = $(".pose-hint");
    return [hint.textContent, hint.scrollWidth <= hint.clientWidth && hint.getBoundingClientRect().height < 20,
      Math.round(frame.right - views.right) < 12 && Math.round(views.top - frame.top) < 12,
      getComputedStyle($("#pose-view-choice")).backgroundColor, options("#pose-view-choice")[0],
      options("#pose-body-preset").slice(0, 4), options("#pose-arms-preset"), $("#pose-add-visual").textContent];`),
  ["Drag to turn · 2 fingers to pan · pinch to zoom", true, true, "rgb(217, 211, 200)", "View",
    ["Body…", "Standing", "Kneeling (seiza)", "Kneeling up"], ["Arms…", "At sides", "Boxtie", "Bunny ears", "Tengu", "Tenshi", "Crossed (hug)",
      "Save these arms as a preset…", "Manage my presets…"],
    "Add to visuals"]);
  check("undo, redo and download are icons, named for screen readers", await run(`
    return ["#pose-undo", "#pose-redo", "#pose-download"].map((id) => [$(id).getAttribute("aria-label"), !!$(id + " svg"), $(id).textContent]);`),
  [["Undo", true, ""], ["Redo", true, ""], ["Download picture", true, ""]]);
  const pictures = path.join(workDir, "downloads-pose-picture");
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: pictures });
  await run(`$("#pose-download").click();`);
  check("download saves a picture of the pose to the device, as a PNG",
    await pngDownloaded(pictures, /^notonawa-pose-\d{4}-\d{2}-\d{2}\.png$/), [true, 900, 1200]);
  check("an arms position can be chosen, and undone", await run(`
    set("#pose-arms-preset", "b:1"); await wait(300);
    const after = $("#pose-undo").disabled;
    $("#pose-undo").click(); await wait(200);
    const undone = $("#pose-redo").disabled;
    $("#pose-redo").click(); await wait(200);
    return [after, undone, $("#pose-arms-preset").value];`), [false, false, ""]);

  // Saved presets: the arms as they are (the boxtie), and the body.
  const presetsMenu = (id) => `[...$("${id}").querySelectorAll("optgroup")].map((g) => [g.label, [...g.children].map((o) => o.textContent)])`;
  const myPresets = `(async () => {
    const list = await (await fetch("/api/pose-presets")).json();
    return list.map((p) => [p.kind, p.name.startsWith("e1."), p.name.includes("boxtie")]);
  })()`;
  check("the arms can be saved as a preset, named, its name sealed, and it's in the Arms… menu", await run(`
    set("#pose-arms-preset", "save"); await wait(300);
    const asked = [$("#pose-preset-title").textContent, document.activeElement?.id, leakyFields()];
    set("#pose-preset-name", " My boxtie "); $("#pose-preset-save").click();
    for (let i = 0; i < 50 && document.querySelector("#pose-preset-name"); i++) await wait(100);
    return [asked, $("#pose-message").textContent, ${presetsMenu("#pose-arms-preset")}, await ${myPresets}];`),
  [["Save these arms", "pose-preset-name", []], "Saved. It's in the Arms… menu, for any pose.",
    [["My presets", ["My boxtie"]], ["Presets", ["Save these arms as a preset…", "Manage my presets…"]]], [["arms", true, false]]]);
  check("a saved preset puts the arms back, as one change, leaving the body", await run(`
    set("#pose-arms-preset", "b:0"); await wait(200);
    const id = [...$("#pose-arms-preset").options].find((o) => o.textContent === "My boxtie").value;
    set("#pose-arms-preset", id); await wait(200);
    const redo = $("#pose-redo").disabled;
    $("#pose-undo").click(); await wait(200); $("#pose-redo").click(); await wait(200);
    return [redo, ${presetsMenu("#pose-body-preset")}.length];`), [true, 1]);
  check("Manage my presets: a body preset saved too, listed by kind; renaming one, and deleting one after asking", await run(`
    set("#pose-body-preset", "save"); await wait(300);
    set("#pose-preset-name", "Standing tall"); $("#pose-preset-save").click();
    for (let i = 0; i < 50 && document.querySelector("#pose-preset-name"); i++) await wait(100);
    set("#pose-arms-preset", "manage");
    for (let i = 0; i < 50 && !document.querySelector("#pose-preset-list .preset-row"); i++) await wait(100);
    const rows = () => [...document.querySelectorAll("#pose-preset-list > *")].map((el) => el.querySelector(".preset-name")?.textContent ?? el.textContent);
    const listed = rows();
    [...document.querySelectorAll("#pose-preset-list button")].find((b) => b.getAttribute("aria-label") === "Rename My boxtie").click();
    await wait(300);
    const renaming = $("#pose-preset-name").value;
    set("#pose-preset-name", "TK arms"); $("#pose-preset-save").click();
    for (let i = 0; i < 50 && document.querySelector("#pose-preset-name"); i++) await wait(100);
    await wait(200);
    const renamed = rows();
    [...document.querySelectorAll("#pose-preset-list button")].find((b) => b.getAttribute("aria-label") === "Delete Standing tall").click();
    await wait(300);
    const asked = ${topDialog}.querySelector("h2").textContent;
    [...${topDialog}.querySelectorAll("button")].find((b) => b.textContent === "Delete preset").click();
    for (let i = 0; i < 50 && rows().includes("Standing tall"); i++) await wait(100);
    const after = rows();
    $("#pose-presets-done").click(); await wait(200);
    return [listed, renaming, renamed, asked, after, ${presetsMenu("#pose-arms-preset")}[0], ${presetsMenu("#pose-body-preset")}.length,
      !!document.querySelector("dialog.pose-editor[open]"), leakyFields()];`),
  [["Body", "Standing tall", "Arms", "My boxtie"], "My boxtie", ["Body", "Standing tall", "Arms", "TK arms"], 'Delete "Standing tall"?',
    ["Arms", "TK arms"], ["My presets", ["TK arms"]], 1, true, []]);

  // The view looks at the figure's hips, in the middle.
  await tap(0.5, 0.5);
  check("tapping the figure's middle picks its hips, with sliders for the whole body and Reset beside its name", await run(`
    return [$("#pose-part").textContent, [...document.querySelectorAll("#pose-sliders label")].map((l) => l.textContent),
      $("#pose-reset-part").textContent, $("#pose-reset-part").parentElement === $("#pose-part").parentElement,
      Math.round($("#pose-reset-part").getBoundingClientRect().right) === Math.round($("#pose-panel-pose").getBoundingClientRect().right),
      leakyFields()];`),
  ["Hips and whole body", ["Tip forward", "Turn", "Roll", "Height (cm)", "Front to back (cm)", "Across (cm)"], "Reset", true, true, []]);
  // Turning keeps the hips in the middle of the view, for the taps below.
  const turned = `[...document.querySelectorAll("#pose-sliders .pose-value")][1].value`;
  check("a slider moves the body, as one change to undo", await run(`
    ${slide("pose-body-1", 20)}
    return [${turned}, $("#pose-undo").disabled];`), ["20", false]);

  // Typing into a slider's box as a person would: the box focused and
  // emptied, the text typed, then Enter.
  const typeInto = async (id, text) => {
    await run(`$("#${id}").focus(); $("#${id}").select();`);
    await send("Input.insertText", { text });
    for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await sleep(200);
    return run(`return [$("#${id}").value, $("#${id.replace(/-typed$/, "")}").value];`);
  };
  const turnBox = await run(`return [$("#pose-body-1-typed").getAttribute("aria-label"), $("#pose-body-1-typed").type];`);
  const typed = [await typeInto("pose-body-1-typed", "-45"), await typeInto("pose-body-1-typed", "-400"), await typeInto("pose-body-1-typed", "abc")];
  check("a slider's number can be typed, kept within its range, as one change; anything but a number is put back", [turnBox, typed, await run(`
    $("#pose-undo").click(); await wait(200);
    const undone = $("#pose-body-1").value;
    $("#pose-undo").click(); await wait(200);
    return [undone, $("#pose-body-1").value, leakyFields()];`)],
  [["Turn, typed", "number"], [["-45", "-45"], ["-180", "-180"], ["-180", "-180"]], ["-45", "20", []]]);

  // The left shin is low on the view's right, with the hips selected (the
  // view's size, and so the figure's place on it, changes with the
  // selected part's sliders).
  const redoBefore = await run(`return $("#pose-redo").disabled;`);
  await drag(0.57, 0.57, 0.82, 0.6);
  // A change made clears what redo had (the typed turns undone above).
  check("dragging a leg moves it as one change, the shin selected, and undo puts it back", [redoBefore, await run(`
    const after = [$("#pose-part").textContent, $("#pose-redo").disabled];
    $("#pose-undo").click(); await wait(200);
    return [...after, $("#pose-redo").disabled, $("#pose-l_knee-0").value];`)],
  [false, ["Left knee", true, false, "0"]]);
  // Back to the hips, for the steps after.
  await tap(0.5, 0.5);

  await drag(0.3, 0.6, 0.8);
  check("dragging turns the view, which undo leaves alone", await run(`
    $("#pose-undo").click(); await wait(200);
    return ${turned};`), "0");
  await run(`$("#pose-redo").click(); await wait(200);`);

  // The head is at the top of the view.
  await tap(0.5, 0.2);
  check("the head has its own sliders, and the whole figure's height and moves", await run(`
    return [$("#pose-part").textContent, [...document.querySelectorAll("#pose-sliders label")].map((l) => l.textContent).slice(3)];`),
  ["Head", ["Height (cm)", "Front to back (cm)", "Across (cm)"]]);
  check("moving the figure from the head is one change; the head's Reset leaves it moved, and undo puts it back", await run(`
    ${slide("pose-shift-0", 30)} ${slide("pose-head-0", 20)}
    const moved = [$("#pose-shift-0").value, $("#pose-head-0").value];
    $("#pose-reset-part").click(); await wait(200);
    const reset = [$("#pose-shift-0").value, $("#pose-head-0").value];
    $("#pose-undo").click(); await wait(200); $("#pose-undo").click(); await wait(200); $("#pose-undo").click(); await wait(200);
    return [moved, reset, $("#pose-shift-0").value, $("#pose-head-0").value];`), [["30", "20"], ["30", "0"], "0", "0"]);
  await tap(0.5, 0.5);

  const hardpoints = `["ring", "bamboo", "hashira"].map((k) => [$("#pose-" + k).textContent, $("#pose-" + k).getAttribute("aria-pressed")])`;
  const hardpointLabels = `[...document.querySelectorAll("#pose-hardpoint-sliders label")].map((l) => l.textContent)`;
  check("Rope mode: thickness, the eraser and Finish rope above the colors, and a ring, bamboo or hashira, the one there highlighted", await run(`
    $("#pose-mode-rope").click(); await wait(200);
    const rows = [...$("#pose-panel-rope").children].map((c) => c.getAttribute("aria-label"));
    const finish = $("#pose-finish-rope"), row = finish.parentElement;
    const before = [$("#pose-panel-pose").hidden, ${hardpoints}, $("#pose-ring").parentElement.firstElementChild.textContent,
      finish.disabled, row.lastElementChild === finish];
    $("#pose-ring").click(); await wait(200);
    return [rows.slice(0, 2), ...before, ${hardpoints}, $("#pose-ring").title, getComputedStyle($("#pose-ring")).backgroundColor,
      ${hardpointLabels}, leakyFields()];`),
  [["Rope thickness", "Rope color"], true, [["ring", "false"], ["bamboo", "false"], ["hashira", "false"]], "Hardpoint:", true, true,
    [["ring", "true"], ["bamboo", "false"], ["hashira", "false"]], "Remove ring", "rgb(254, 199, 98)",
    ["Across (cm)", "Height (cm)", "Front to back (cm)"], []]);

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
  [false, [0, 20, 0], [105], [0, 195, 0], 1, 2, null, [["photo", 0]], 1]);

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
  check("Edit pose: the saved preset is in its Arms… menu; a bamboo in place of the ring, then a hashira, its own sliders each; nothing kept on Cancel", await run(`
    $("#tie-pose-edit").click();
    for (let i = 0; i < 100 && !document.querySelector("dialog.pose-editor[open]"); i++) await wait(100);
    await wait(300);
    const saved = ${presetsMenu("#pose-arms-preset")}[0];
    $("#pose-mode-rope").click(); await wait(100);
    $("#pose-bamboo").click(); await wait(200);
    const bamboo = [${hardpoints}, $("#pose-rope-hint").textContent, ${hardpointLabels}];
    // No rope is on the bamboo, so nothing to ask about.
    $("#pose-hashira").click(); await wait(300);
    const asked = ${topDialog}.classList.contains("pose-editor");
    const hashira = [$("#pose-hashira").getAttribute("aria-pressed"), ${hardpointLabels}];
    $("#pose-cancel").click(); await wait(300);
    [...${topDialog}.querySelectorAll("button")].find((b) => b.textContent === "Discard changes").click(); await wait(300);
    const [p] = await ${tiePoses};
    return [saved, bamboo, asked, hashira, !!$("dialog.pose-editor"), p.data.ring];`),
  [["My presets", ["TK arms"]], [[["ring", "false"], ["bamboo", "true"], ["hashira", "false"]], "Tap the body to lay a rope, point by point. Tap the bamboo for an upline.",
    ["Across (cm)", "Height (cm)", "Front to back (cm)", "Turn"]],
  true, ["true", ["Across (cm)", "Front to back (cm)", "Turn"]], false, [0, 195, 0]]);
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
