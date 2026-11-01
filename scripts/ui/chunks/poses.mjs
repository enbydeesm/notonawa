// The walkthrough's poses chunk. Poses on ties: the poser (the body, arms and turn pickers, saving, saving over,
// renaming and deleting my own presets, posing a part with a slider, the head's sliders moving the whole
// figure, typing a slider's number and stepping it with ▲ ▼, dragging a leg, undo, downloading a picture, laying a
// rope with taps, the ring, bamboo (its length and hanger inset) and hashira, the pencil's marks, "Add to visuals",
// a see-saw rope, cinches (one through three points), a rope added to an upline, slack, Cancel rope, moving an upline along the bamboo, tapped on a pose made through the API, and the
// tools in one row on a phone), "Allow collisions" (fixing or leaving clashes), the nav's poser, saving with the tie,
// captions, duplicating, and export and import. Taps on the 3D view are real input (Chrome's own mouse events),
// so a 3D view that doesn't draw, or picks the wrong thing, shows up here.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { readZip } from "../../../public/js/zip.js";
import { check, freshAccount, go, run, send, sleep, workDir } from "../harness.mjs";
import { readPose, setHardpoint } from "../../../public/js/pose-format.js";

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

  check("the nav's poser button opens the poser on its own: Add to visuals and Save pose greyed out, Close in place of Cancel, Allow collisions ticked", await run(`
    $("#nav-poser").click();
    for (let i = 0; i < 100 && !document.querySelector("dialog.pose-editor[open]"); i++) await wait(100);
    await wait(500);
    const frame = $(".pose-frame").getBoundingClientRect(), allow = $(".pose-allow"), box = allow.getBoundingClientRect();
    const result = [$("#pose-add-visual").disabled, $("#pose-save").disabled, $("#pose-cancel").textContent, $("#pose-allow-collisions").checked,
      allow.textContent, frame.right - box.right < 16 && frame.bottom - box.bottom < 16,
      getComputedStyle(allow).color === getComputedStyle($(".pose-hint")).color, leakyFields()];
    $("#pose-cancel").click(); await wait(300);
    return [...result, !!document.querySelector("dialog.pose-editor")];`),
  [true, true, "Close", true, "Allow collisions", true, true, [], false]);

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

  check("the help on one line, the views top right on the floor's grey, and pickers for the body, the arms and the body's turn", await run(`
    const options = (id) => [...$(id).options].map((o) => o.textContent);
    const frame = $(".pose-frame").getBoundingClientRect(), views = $("#pose-view-choice").getBoundingClientRect();
    const hint = $(".pose-hint");
    return [hint.textContent, hint.scrollWidth <= hint.clientWidth && hint.getBoundingClientRect().height < 20,
      Math.round(frame.right - views.right) < 12 && Math.round(views.top - frame.top) < 12,
      getComputedStyle($("#pose-view-choice")).backgroundColor, options("#pose-view-choice")[0],
      ["#pose-body-preset", "#pose-arms-preset", "#pose-orientation"].map((id) => [$(id).tagName, $(id).textContent]),
      $("#pose-add-visual").textContent];`),
  ["Drag to turn · 2 fingers to pan · pinch to zoom", true, true, "rgb(217, 211, 200)", "View",
    [["BUTTON", "Body…"], ["BUTTON", "Arms…"], ["BUTTON", "Turn body…"]], "Add to visuals"]);
  check("undo, redo and download are icons, named for screen readers, and the pencil is a mode after Rope", await run(`
    const modes = [...$("#pose-mode-draw").parentElement.children].map((b) => b.id);
    return [["#pose-undo", "#pose-redo", "#pose-download", "#pose-mode-draw"].map((id) => [$(id).getAttribute("aria-label"), !!$(id + " svg"), $(id).textContent]),
      modes];`),
  [[["Undo", true, ""], ["Redo", true, ""], ["Download picture", true, ""], ["Draw over the view", true, ""]],
    ["pose-mode-pose", "pose-mode-rope", "pose-mode-draw"]]);
  // A phone 390px wide: the tools in one row, and the panel below cut part-way through a row, fading out.
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  check("on a phone, the tools fit one row, and the panel fades where there's more to scroll, with no empty band above Cancel", await run(`
    const middle = (id) => { const b = $(id).getBoundingClientRect(); return Math.round((b.top + b.bottom) / 2); };
    const row = [middle("#pose-mode-pose"), middle("#pose-mode-draw"), middle("#pose-download"), middle("#pose-add-visual")];
    const fits = $("#pose-add-visual").getBoundingClientRect().right <= innerWidth;
    $("#pose-mode-rope").click(); await wait(200); $("#pose-bamboo").click(); await wait(500);
    $("#pose-hardpoint-settings").open = true; await wait(300);
    const panels = $("#pose-panels"), box = panels.getBoundingClientRect();
    const cut = [...document.querySelectorAll("#pose-hardpoint-sliders .pose-slider")]
      .some((r) => { const b = r.getBoundingClientRect(); return b.top < box.bottom && b.bottom > box.bottom; });
    const result = [new Set(row).size, fits, panels.classList.contains("more-below"), cut, getComputedStyle($("#pose-message")).display];
    $("#pose-hardpoint-settings").open = false;
    $("#pose-undo").click(); await wait(200); $("#pose-mode-pose").click(); await wait(200);
    return result;`), [1, true, true, true, "none"]);
  await send("Emulation.clearDeviceMetricsOverride");
  await sleep(500);
  const pictures = path.join(workDir, "downloads-pose-picture");
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: pictures });
  await run(`$("#pose-download").click();`);
  check("download saves a picture of the pose to the device, as a PNG",
    await pngDownloaded(pictures, /^notonawa-pose-\d{4}-\d{2}-\d{2}\.png$/), [true, 900, 1200]);
  // The pickers: Body…, Arms… and Turn body… each open a dialog over the poser.
  const openPicker = (button, dialog) =>
    `$("${button}").click(); for (let i = 0; i < 50 && !document.querySelector("${dialog}[open]"); i++) await wait(100); await wait(200);`;
  // Each row's name, and whether it's tinted as the one the figure's in (the divider's words, and false).
  const pickerRows = (dialog) => `[...document.querySelectorAll("${dialog} .preset-list > *")]
    .map((el) => [el.querySelector(".preset-name")?.textContent ?? el.textContent, el.classList.contains("current")])`;
  const BODY_NAMES = ["Standing", "Kneeling (seiza)", "Kneeling up", "One leg folded (futomomo)", "Face down", "Face up", "On their side", "Upside down"];
  check("Arms… opens Arms Presets: Save as preset and ✕ on its heading's row, on the heading (no keyboard), the one the figure's in tinted and Save greyed out; ✕ changes nothing", await run(`
    ${openPicker("#pose-arms-preset", "#pose-arms-presets")}
    const d = $("#pose-arms-presets");
    const header = [...d.querySelector(".dialog-header").querySelectorAll("h2, button")].map((el) => el.getAttribute("aria-label") ?? el.textContent);
    const tinted = getComputedStyle($("#pose-arms-presets-b0")).backgroundColor !== getComputedStyle($("#pose-arms-presets-b1")).backgroundColor;
    const result = [header, document.activeElement?.id, $("#pose-arms-presets-search").placeholder, $("#pose-arms-presets-save").disabled,
      ${pickerRows("#pose-arms-presets")}, tinted, leakyFields()];
    $("#pose-arms-presets-close").click(); await wait(200);
    return [...result, !!$("#pose-arms-presets"), $("#pose-undo").disabled];`),
  [["Arms Presets", "Save as preset", "Close"], "pose-arms-presets-title", "Search", true,
    [["At sides", true], ["Boxtie", false], ["Bunny ears", false], ["Tengu", false], ["Tenshi", false], ["Crossed (hug)", false]], true, [],
    false, true]);
  check("searching narrows the list, the picker staying where it is at the same height; tapping a row anywhere chooses it and closes it, as one change to undo", await run(`
    ${openPicker("#pose-arms-preset", "#pose-arms-presets")}
    const box = () => { const r = $("#pose-arms-presets").getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height)]; };
    const opened = box();
    const search = $("#pose-arms-presets-search");
    search.value = "BOX"; search.dispatchEvent(new Event("input")); await wait(100);
    const found = ${pickerRows("#pose-arms-presets")};
    const searched = box();
    const steady = opened[0] === searched[0] && opened[1] === searched[1] && opened[0] < 40;
    $("#pose-arms-presets-b1").click(); await wait(300);
    const after = [!!$("#pose-arms-presets"), $("#pose-undo").disabled];
    $("#pose-undo").click(); await wait(200);
    const undone = $("#pose-redo").disabled;
    $("#pose-redo").click(); await wait(200);
    ${openPicker("#pose-arms-preset", "#pose-arms-presets")}
    const now = [$("#pose-arms-presets-b1").classList.contains("current"), $("#pose-arms-presets-save").disabled];
    $("#pose-arms-presets-close").click(); await wait(200);
    return [steady, found, after, undone, now];`), [true, [["Boxtie", false]], [false, false], false, [true, true]]);
  check("Turn body…: the same kind of picker, no search or Save, the way the body faces tinted", await run(`
    ${openPicker("#pose-orientation", "#pose-turn")}
    const result = [$("#pose-turn h2").textContent, !!$("#pose-turn input"), ${pickerRows("#pose-turn")}.filter(([, on]) => on).length];
    $("#pose-turn-close").click(); await wait(200);
    return [...result, !!$("#pose-turn")];`), ["Turn body", false, 1, false]);

  // Saved presets. The body as it starts is the Standing preset, so it's
  // changed first (the head tipped), for there to be something to save.
  const myPresets = `(async () => {
    const list = await (await fetch("/api/pose-presets")).json();
    return list.map((p) => [p.kind, p.name.startsWith("e1."), p.name.includes("tall")]);
  })()`;
  await tap(0.5, 0.2);
  check("the body can be saved as a preset, named, its name sealed; it's listed under My presets, tinted, and Save greys out", await run(`
    ${slide("pose-head-0", 10)}
    ${openPicker("#pose-body-preset", "#pose-body-presets")}
    const enabled = !$("#pose-body-presets-save").disabled;
    $("#pose-body-presets-save").click(); await wait(300);
    const asked = [$("#pose-preset-title").textContent, document.activeElement?.id, $("#pose-preset-also").closest("label").textContent,
      $("#pose-preset-also").checked, leakyFields()];
    set("#pose-preset-name", " Standing tall "); $("#pose-preset-save").click();
    for (let i = 0; i < 50 && document.querySelector("#pose-preset-name"); i++) await wait(100);
    await wait(200);
    return [enabled, asked, $("#pose-body-presets-message").textContent, ${pickerRows("#pose-body-presets")},
      $("#pose-body-presets-save").disabled, await ${myPresets}];`),
  [true, ["Save this body as a preset", "pose-preset-name", " Save arms as a preset too?", false, []], "Saved, for any pose.",
    [...BODY_NAMES.map((n) => [n, false]), ["My presets", false], ["Standing tall", true]], true, [["body", true, false]]]);
  check("my presets are in alphabetical order after the built-in ones, each with save, rename and delete (red) icons, from the left; saving with the arms too adds an arms preset", await run(`
    $("#pose-body-presets-b2").click(); await wait(300);
    ${slide("pose-head-0", -10)}
    ${openPicker("#pose-body-preset", "#pose-body-presets")}
    $("#pose-body-presets-save").click(); await wait(300);
    set("#pose-preset-name", "Kneel, head down"); $("#pose-preset-also").checked = true; $("#pose-preset-save").click();
    for (let i = 0; i < 50 && document.querySelector("#pose-preset-name"); i++) await wait(100);
    await wait(200);
    const kinds = (await (await fetch("/api/pose-presets")).json()).map((p) => p.kind);
    const said = $("#pose-body-presets-message").textContent;
    const row = [...document.querySelectorAll("#pose-body-presets .preset-row")].pop();
    const icons = [...row.querySelectorAll(".preset-icons button")].map((b) => [b.getAttribute("aria-label"), b.classList.contains("danger")]);
    return [${pickerRows("#pose-body-presets")}.slice(BODY_NAMES_LENGTH), icons, kinds, said];`.replace("BODY_NAMES_LENGTH", String(BODY_NAMES.length))),
  [[["My presets", false], ["Kneel, head down", true], ["Standing tall", false]],
    [["Save this body over Standing tall", false], ["Rename Standing tall", false], ["Delete Standing tall", true]],
    ["body", "body", "arms"], "Saved, with the arms as a preset too, for any pose."]);
  // Each icon by its name: the last row's (Standing tall), and the first of mine.
  const icon = (label) => `[...document.querySelectorAll("#pose-body-presets .preset-icons button")].find((b) => b.getAttribute("aria-label") === "${label}")`;
  check("saving over one asks first, then holds the body as it is; renaming one; deleting one asks first", await run(`
    ${icon("Save this body over Standing tall")}.click(); await wait(300);
    const overAsked = ${topDialog}.querySelector("h2").textContent;
    [...${topDialog}.querySelectorAll("button")].find((b) => b.textContent === "Save over it").click();
    for (let i = 0; i < 50 && !${pickerRows("#pose-body-presets")}.at(-1)[1]; i++) await wait(100);
    const over = ${pickerRows("#pose-body-presets")}.slice(-2);
    ${icon("Rename Kneel, head down")}.click(); await wait(300);
    const renaming = [$("#pose-preset-title").textContent, $("#pose-preset-name").value];
    set("#pose-preset-name", "Kneel"); $("#pose-preset-save").click();
    for (let i = 0; i < 50 && document.querySelector("#pose-preset-name"); i++) await wait(100);
    await wait(200);
    const renamed = ${pickerRows("#pose-body-presets")}.slice(-2);
    ${icon("Delete Standing tall")}.click(); await wait(300);
    const deleteAsked = ${topDialog}.querySelector("h2").textContent;
    [...${topDialog}.querySelectorAll("button")].find((b) => b.textContent === "Delete preset").click();
    for (let i = 0; i < 50 && ${pickerRows("#pose-body-presets")}.some(([n]) => n === "Standing tall"); i++) await wait(100);
    const after = ${pickerRows("#pose-body-presets")}.slice(-2);
    $("#pose-body-presets-close").click(); await wait(200);
    // Back to standing (the kneel, and both tips of the head), for the taps below.
    for (let i = 0; i < 3; i++) { $("#pose-undo").click(); await wait(200); }
    return [overAsked, over, renaming, renamed, deleteAsked, after, !!document.querySelector("dialog.pose-editor[open]"), leakyFields()];`),
  ['Save over "Standing tall"?', [["Kneel, head down", true], ["Standing tall", true]], ["Rename preset", "Kneel, head down"],
    [["Kneel", true], ["Standing tall", true]], 'Delete "Standing tall"?', [["My presets", false], ["Kneel", true]], true, []]);

  // The view looks at the figure's hips, in the middle: tapping them poses the pelvis.
  await tap(0.5, 0.5);
  check("tapping the figure's middle picks its hips, with Reset beside its name", await run(`
    return [$("#pose-part").textContent, [...document.querySelectorAll("#pose-sliders label")].map((l) => l.textContent),
      $("#pose-reset-part").textContent, $("#pose-reset-part").parentElement === $("#pose-part").parentElement,
      Math.round($("#pose-reset-part").getBoundingClientRect().right) === Math.round($("#pose-panel-pose").getBoundingClientRect().right),
      leakyFields()];`),
  ["Hips", ["Tilt", "Hike", "Turn"], "Reset", true, true, []]);
  check("tilting the hips is one change, the hips' angles making up for it so the legs stay; Reset puts it back", await run(`
    ${slide("pose-hips-0", 20)}
    const tilted = [$("#pose-hips-0").value, $("#pose-undo").disabled];
    $("#pose-reset-part").click(); await wait(200);
    const reset = $("#pose-hips-0").value;
    $("#pose-undo").click(); await wait(200); $("#pose-undo").click(); await wait(200);
    return [tilted, reset, $("#pose-hips-0").value];`), [["20", false], "0", "0"]);
  // The waist is just above, at the top of the hips.
  await tap(0.5, 0.43);
  check("just above the hips is the waist", await run(`
    return [$("#pose-part").textContent, [...document.querySelectorAll("#pose-sliders label")].map((l) => l.textContent)];`),
  ["Waist", ["Forward", "Lean", "Turn"]]);
  // The head is at the top of the view.
  await tap(0.5, 0.2);
  check("the head has its own sliders, then the whole body's under a heading with its own Reset", await run(`
    return [$("#pose-part").textContent, [...document.querySelectorAll("#pose-sliders label")].map((l) => l.textContent),
      $("#pose-whole").textContent, $("#pose-reset-whole").parentElement === $("#pose-whole").parentElement];`),
  ["Head", ["Forward", "Lean", "Turn", "Tip body", "Turn body", "Roll body", "Height (cm)", "Front to back (cm)", "Across (cm)"], "Whole body", true]);
  const turned = `$("#pose-body-1").value`;
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
  [["Turn body, typed", "number"], [["-45", "-45"], ["-180", "-180"], ["-180", "-180"]], ["-45", "20", []]]);
  check("▲ and ▼ left of a slider's box step it by one, each a change", await run(`
    const steps = $("#pose-body-1-up").parentElement;
    const placed = steps.nextElementSibling === $("#pose-body-1-typed") && steps.previousElementSibling === $("#pose-body-1");
    $("#pose-body-1-up").click(); await wait(200);
    const up = $("#pose-body-1-typed").value;
    $("#pose-body-1-down").click(); await wait(200); $("#pose-body-1-down").click(); await wait(200);
    const down = $("#pose-body-1").value;
    for (let i = 0; i < 3; i++) { $("#pose-undo").click(); await wait(200); }
    return [placed, $("#pose-body-1-up").getAttribute("aria-label"), $("#pose-body-1-down").textContent, up, down, $("#pose-body-1").value];`),
  [true, "Turn body: up one", "▼", "21", "19", "20"]);

  // The left shin is low on the view's right, with the head selected (the
  // view's size, and so the figure's place on it, changes with the
  // selected part's sliders).
  const redoBefore = await run(`return $("#pose-redo").disabled;`);
  await drag(0.63, 0.63, 0.82, 0.6);
  // A change made clears what redo had (the typed turns undone above).
  check("dragging a leg moves it as one change, the shin selected, and undo puts it back", [redoBefore, await run(`
    const after = [$("#pose-part").textContent, $("#pose-redo").disabled];
    $("#pose-undo").click(); await wait(200);
    return [...after, $("#pose-redo").disabled, $("#pose-l_knee-0").value];`)],
  [false, ["Left knee", true, false, "0"]]);
  // Back to the head, for the steps after.
  await tap(0.5, 0.2);

  await drag(0.3, 0.6, 0.8);
  check("dragging turns the view, which undo leaves alone", await run(`
    $("#pose-undo").click(); await wait(200);
    return ${turned};`), "0");
  await run(`$("#pose-redo").click(); await wait(200);`);

  check("moving the figure from the head is one change; the head's Reset leaves it moved, the whole body's Reset stands it back up, and undo puts it back", await run(`
    ${slide("pose-shift-0", 30)} ${slide("pose-head-0", 20)}
    const moved = [$("#pose-shift-0").value, $("#pose-head-0").value];
    $("#pose-reset-part").click(); await wait(200);
    const reset = [$("#pose-shift-0").value, $("#pose-head-0").value];
    $("#pose-undo").click(); await wait(200); $("#pose-undo").click(); await wait(200); $("#pose-undo").click(); await wait(200);
    const undone = [$("#pose-shift-0").value, $("#pose-head-0").value];
    ${slide("pose-shift-0", 30)} ${slide("pose-body-0", 15)}
    $("#pose-reset-whole").click(); await wait(200);
    const whole = [$("#pose-shift-0").value, $("#pose-body-0").value];
    for (let i = 0; i < 3; i++) { $("#pose-undo").click(); await wait(200); }
    return [moved, reset, undone, whole, $("#pose-shift-0").value];`), [["30", "20"], ["30", "0"], ["0", "0"], ["0", "0"], "0"]);
  await tap(0.5, 0.5);

  const hardpoints = `["ring", "bamboo", "hashira"].map((k) => [$("#pose-" + k).textContent, $("#pose-" + k).getAttribute("aria-pressed")])`;
  const hardpointLabels = `[...document.querySelectorAll("#pose-hardpoint-sliders label")].map((l) => l.textContent)`;
  check("Rope mode: thickness, the eraser, Cancel rope and Finish rope above the colors, a ring, bamboo or hashira, the one there highlighted, its sliders folded under Hardpoint Settings", await run(`
    $("#pose-mode-rope").click(); await wait(200);
    const rows = [...$("#pose-panel-rope").children].map((c) => c.getAttribute("aria-label"));
    const finish = $("#pose-finish-rope"), row = finish.parentElement;
    const before = [$("#pose-panel-pose").hidden, ${hardpoints}, $("#pose-ring").parentElement.firstElementChild.textContent,
      finish.disabled, row.lastElementChild === finish, finish.previousElementSibling === $("#pose-cancel-rope"), $("#pose-cancel-rope").disabled,
      $("#pose-hardpoint-settings summary").textContent, $("#pose-hardpoint-settings").open];
    $("#pose-ring").click(); await wait(200);
    return [rows.slice(0, 2), ...before, ${hardpoints}, $("#pose-ring").title, getComputedStyle($("#pose-ring")).backgroundColor,
      ${hardpointLabels}, leakyFields()];`),
  [["Rope thickness", "Rope color"], true, [["ring", "false"], ["bamboo", "false"], ["hashira", "false"]], "Hardpoint:", true, true, true, true,
    "Hardpoint Settings", false,
    [["ring", "true"], ["bamboo", "false"], ["hashira", "false"]], "Remove ring", "rgb(254, 199, 98)",
    ["Across (cm)", "Height (cm)", "Front to back (cm)"], []]);
  check("a bamboo has a length and a hanger inset, 152 and 30 cm to begin with, the inset short of the middle", await run(`
    $("#pose-bamboo").click(); await wait(200);
    const labels = ${hardpointLabels}.slice(4);
    const start = [$("#pose-bamboo-4").value, $("#pose-bamboo-5").value, $("#pose-bamboo-5").max];
    ${slide("pose-bamboo-4", 90)}
    const shorter = [$("#pose-bamboo-5").value, $("#pose-bamboo-5").max];
    ${slide("pose-bamboo-5", 60)}
    const inset = $("#pose-bamboo-5").value;
    $("#pose-bamboo-5-up").click(); await wait(200);
    const stepped = $("#pose-bamboo-5").value;
    for (let i = 0; i < 3; i++) { $("#pose-undo").click(); await wait(200); }
    return [labels, start, shorter, inset, stepped, ${hardpoints}];`),
  [["Length (cm)", "Hanger inset (cm)"], ["152", "30", "71"], ["30", "40"], "40", "40",
    [["ring", "true"], ["bamboo", "false"], ["hashira", "false"]]]);

  await tap(0.5, 0.5);
  await tap(0.5, 0.38);
  check("tapping the body lays a rope, point by point, Finish rope outlined as a reminder to end it", await run(`
    return [$("#pose-rope-hint").textContent, $("#pose-finish-rope").disabled, getComputedStyle($("#pose-finish-rope")).borderTopWidth];`),
  ["Rope: 2 points. Keep tapping, then Finish rope.", false, "2px"]);
  check("Undo takes back the last point first", await run(`
    $("#pose-undo").click(); await wait(200); const one = $("#pose-rope-hint").textContent;
    return one;`), "Rope: 1 point. Keep tapping, then Finish rope.");
  check("Cancel rope drops the rope being laid", await run(`
    const on = !$("#pose-cancel-rope").disabled;
    $("#pose-cancel-rope").click(); await wait(200);
    return [on, $("#pose-finish-rope").disabled, $("#pose-cancel-rope").disabled, $("#pose-rope-hint").textContent.startsWith("Tap the body")];`),
  [true, true, true, true]);
  await tap(0.5, 0.5);
  await tap(0.5, 0.4);
  await run(`$("#pose-finish-rope").click(); await wait(200);`);

  const marks = `document.querySelectorAll("#pose-marks path").length`;
  check("the pencil: its own panel of widths, an eraser and colors, and marks only it can draw", await run(`
    $("#pose-mode-draw").click(); await wait(200);
    return [$("#pose-mode-draw").getAttribute("aria-pressed"), $("#pose-panel-draw").hidden, $("#pose-panel-rope").hidden,
      [...$("#pose-panel-draw").children].map((c) => c.getAttribute("aria-label") ?? c.id),
      $("#pose-mark-color-red").getAttribute("aria-pressed"), $("#pose-marks").classList.contains("drawing"), ${marks}];`),
  ["true", false, true, ["Line width", "Line color", "pose-draw-hint"], "true", true, 0]);
  await drag(0.3, 0.7, 0.2, 0.3);
  check("drawing over the view adds a mark, as one change, and the view doesn't turn", await run(`
    return [${marks}, $("#pose-undo").disabled, $("#pose-marks path").getAttribute("class")];`), [1, false, "ink-red"]);
  await run(`$("#pose-mark-eraser").click(); await wait(100);`);
  await tap(0.5, 0.25);
  check("the eraser takes a mark out, and undo brings it back", await run(`
    const erased = ${marks};
    $("#pose-undo").click(); await wait(300);
    return [erased, ${marks}];`), [0, 1]);
  await run(`$("#pose-mode-pose").click(); await wait(200);`);
  check("the marks show in the other modes, but don't take their taps", await run(`
    return [${marks}, $("#pose-marks").classList.contains("drawing"), getComputedStyle($("#pose-marks")).pointerEvents];`), [1, false, "none"]);
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: path.join(workDir, "downloads-pose-marks") });
  await run(`$("#pose-download").click();`);
  check("download still saves the picture, with the marks on it", await pngDownloaded(path.join(workDir, "downloads-pose-marks"), /\.png$/),
    [true, 900, 1200]);
  await drag(0.1, 0.2, 0.9);
  check("turning the view hides the marks", await run(`return ${marks};`), 0);

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
  [false, [0, 20, 0], [105, 0], [0, 195, 0], 1, 2, null, [["photo", 0]], 1]);

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
  check("Edit pose: the saved preset is in its Body… picker; a bamboo in place of the ring, then a hashira, its own sliders each; nothing kept on Cancel", await run(`
    $("#tie-pose-edit").click();
    for (let i = 0; i < 100 && !document.querySelector("dialog.pose-editor[open]"); i++) await wait(100);
    await wait(300);
    ${openPicker("#pose-body-preset", "#pose-body-presets")}
    const saved = ${pickerRows("#pose-body-presets")}.slice(${BODY_NAMES.length}).map(([n]) => n);
    $("#pose-body-presets-close").click(); await wait(200);
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
  [["My presets", "Kneel"], [[["ring", "false"], ["bamboo", "true"], ["hashira", "false"]],
    "Tap the body to lay a rope, point by point. Tap the bamboo for an upline. Tap a rope to choose it.",
    ["Across (cm)", "Height (cm)", "Front to back (cm)", "Turn", "Length (cm)", "Hanger inset (cm)"]],
  true, ["true", ["Across (cm)", "Front to back (cm)", "Turn"]], false, [0, 195, 0]]);
  check("Duplicate adds a copy last, with the same pose and caption", await run(`
    $("#tie-pose-duplicate").click(); await wait(1000);
    ${topDialog}.querySelector(".dialog-cancel, [aria-label=Close]").click(); await wait(300);
    const [a, b] = await ${tiePoses};
    return [[...document.querySelectorAll("#tie-visuals .visual-pose figcaption")].map((f) => f.textContent),
      JSON.stringify(a.data) === JSON.stringify(b.data), a.id !== b.id];`),
  [["Lift", "Lift"], true, true]);
  await run(`${topDialog}.querySelector(".dialog-cancel, [aria-label=Close]").click(); await wait(300);`);

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
  await run(`${topDialog}.querySelector(".dialog-cancel, [aria-label=Close]").click(); await wait(300);`);

  await ropes({ tap, slide, topDialog });
  await collisions({ tap, slide, topDialog });
}

/**
 * A see-saw rope and a cinch, tapped on a pose made through the API (so
 * where its ropes are on the view is known): arms out to the sides under a
 * ring, a see-saw from wrist to wrist over it, and uplines from each elbow.
 * @param {{ tap: (fx: number, fy: number) => Promise<void>, slide: (id: string, value: number) => string, topDialog: string }} helpers
 */
async function ropes({ tap, slide, topDialog }) {
  const RING = ["ring", 0, 0, 0];
  const joints = { l_shoulder: [0, 90, 0], r_shoulder: [0, 90, 0] };
  const seeded = {
    v: 1, joints, body: [0, 0, 0], lift: 99, shift: [0, 0], camera: [0, 8, 380, 150, 0, 0], ring: [0, 250, 0], bamboo: null, hashira: null,
    ropes: [
      { c: "red", w: 3, p: [["l_wrist", 0, -80, 0], RING, ["r_wrist", 0, -80, 0]], s: true },
      { c: "blue", w: 3, p: [["l_elbow", 0, 0, 0], RING] },
      { c: "green", w: 3, p: [["r_elbow", 0, 0, 0], RING] },
    ],
  };
  const tiePose = `(async () => {
    const tie = (await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json())
      .ties.find((t) => t.title === "Rope test");
    return (await (await fetch("/api/poses?tie_id=" + tie.id)).json())[0];
  })()`;
  await run(`
    const postJson = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    const tie = await postJson("/api/ties", { tie_type: "suspension", tie_date: "2026-10-02", title: "Rope test" });
    await postJson("/api/poses", { tie_id: tie.id, data: ${JSON.stringify(seeded)} });`);
  // As stored, every joint listed.
  const stored = await run(`return (await ${tiePose}).data;`);
  await go("/");
  // Where a spot on a rope is on the view, as fractions of its width and
  // height: the pose posed as the view poses it, through its camera.
  const spot = async (data, rope, segment, t) => run(`
    const three = await import("/js/vendor/three.js");
    const { makeSkeleton, posed } = await import("/js/pose-skeleton.js");
    const { ropeLine } = await import("/js/pose-cinch.js");
    const data = ${JSON.stringify(data)};
    const skeleton = makeSkeleton(); posed(skeleton, data);
    const line = ropeLine(skeleton, data, ${rope});
    const point = line[${segment}].clone().lerp(line[${segment + 1}], ${t});
    const r = $("#pose-view").getBoundingClientRect();
    const camera = new three.PerspectiveCamera(38, r.width / r.height, 5, 5000);
    const [yaw, pitch, distance, height, tx, tz] = data.camera;
    const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
    camera.position.set(tx + Math.sin(y) * Math.cos(p) * distance, height + Math.sin(p) * distance, tz + Math.cos(y) * Math.cos(p) * distance);
    camera.lookAt(tx, height, tz);
    camera.updateMatrixWorld();
    const at = point.project(camera);
    return [(at.x + 1) / 2, (1 - at.y) / 2];`);
  const tapRope = async (data, rope, segment, t) => {
    await sleep(300);
    // The view changes size as the panel below it does: wait for it to settle.
    await run(`let last = ""; for (let i = 0; i < 30; i++) {
      const r = $("#pose-view").getBoundingClientRect(), now = r.width + "x" + r.height;
      if (now === last) break; last = now; await wait(120); }`);
    const [fx, fy] = await spot(data, rope, segment, t);
    await tap(fx, fy);
  };
  const editPose = `$("#tie-pose-edit").click();
    for (let i = 0; i < 100 && !document.querySelector("dialog.pose-editor[open]"); i++) await wait(100);
    await wait(500);`;
  const savePose = `$("#pose-save").click();
    for (let i = 0; i < 100 && !/Pose saved|Couldn't/.test(${topDialog}.textContent); i++) await wait(100);`;

  await run(`[...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Rope test").click(); await wait(1500);
    $("#tie-visuals .visual-pose .photo-thumb").click(); await wait(800); ${editPose}
    $("#pose-mode-rope").click(); await wait(300);`);
  await tapRope(stored, 0, 0, 0.5);
  check("tapping a rope chooses it: one over the ring and back is a see-saw, ticked, above the help; Add cinch on the left, Add rope on the right, and its slack", await run(`
    const seesaw = $("#pose-seesaw");
    const panel = [...$("#pose-panel-rope").children];
    const actions = $("#pose-cinch-start").parentElement.getBoundingClientRect();
    return [seesaw?.checked, seesaw?.parentElement.textContent, panel.indexOf($("#pose-seesaw-slot")) < panel.indexOf($("#pose-rope-hint")),
      $("#pose-cinch-start").textContent, $("#pose-added-start").textContent,
      Math.round($("#pose-cinch-start").getBoundingClientRect().left) === Math.round(actions.left),
      Math.round($("#pose-added-start").getBoundingClientRect().right) === Math.round(actions.right),
      $("#pose-rope-hint").textContent.startsWith("Rope chosen"), !!$("#pose-slack"), leakyFields()];`),
  [true, "See-saw: runs over the ring", true, "Add cinch", "Add rope", true, true, true, true, []]);

  // The left upper arm, halfway along: where to tap to pose it.
  const upperArm = await run(`
    const three = await import("/js/vendor/three.js");
    const { makeSkeleton, posed, onBone } = await import("/js/pose-skeleton.js");
    const data = ${JSON.stringify(stored)};
    const skeleton = makeSkeleton(); posed(skeleton, data);
    $("#pose-mode-pose").click(); await wait(400);
    const point = onBone(skeleton, "l_shoulder", [0, -14, 0]);
    const r = $("#pose-view").getBoundingClientRect();
    const camera = new three.PerspectiveCamera(38, r.width / r.height, 5, 5000);
    const [yaw, pitch, distance, height] = data.camera;
    const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
    camera.position.set(Math.sin(y) * Math.cos(p) * distance, height + Math.sin(p) * distance, Math.cos(y) * Math.cos(p) * distance);
    camera.lookAt(0, height, 0);
    camera.updateMatrixWorld();
    const at = point.project(camera);
    return [(at.x + 1) / 2, (1 - at.y) / 2];`);
  await tap(upperArm[0], upperArm[1]);
  check("raising one arm of a see-saw lowers the other, as one change", await run(`
    const part = $("#pose-part").textContent;
    ${slide("pose-l_shoulder-1", 110)}
    ${savePose}
    const saved = (await ${tiePose}).data;
    return [part, saved.joints.l_shoulder[1], saved.joints.r_shoulder[1] < 90, saved.ropes[0].s];`), ["Left shoulder", 110, true, true]);

  const afterSeesaw = await run(`return (await ${tiePose}).data;`);
  await run(`${editPose} $("#pose-mode-rope").click(); await wait(300);`);
  await tapRope(afterSeesaw, 1, 0, 0.5);
  await run(`$("#pose-cinch-start").click(); await wait(200);`);
  const cinchHint = await run(`return $("#pose-rope-hint").textContent;`);
  await tapRope(afterSeesaw, 2, 0, 0.5);
  check("Add cinch, another upline, then Finish rope ties a cinch, taut, with Move the body ticked; Finish with one point says what's missing", [cinchHint, await run(`
    const tapped = $("#pose-rope-hint").textContent;
    $("#pose-finish-rope").click(); await wait(300);
    const length = $("#pose-cinch-length");
    return [tapped, $("#pose-rope-note").textContent, length.value === length.max, Number(length.max) > 10, $("#pose-cinch-body").checked];`)],
  ["Cinch: 1 point. Tap uplines, ropes or the body to tie it through, then Finish rope.",
    ["Cinch: 2 points. Tap uplines, ropes or the body to tie it through, then Finish rope.", "Cinch tied. Shorten it to pull the upline aside.", true, true, true]]);
  check("shortening it pulls the uplines together, and the arms with them; saved with the pose", await run(`
    const max = Number($("#pose-cinch-length").max);
    { const el = $("#pose-cinch-length"); el.value = String(max - 10); el.dispatchEvent(new Event("input")); el.dispatchEvent(new Event("change")); await wait(500); }
    ${savePose}
    const saved = (await ${tiePose}).data;
    const cinch = saved.ropes[3];
    return [cinch.l === max - 10, cinch.p.map((p) => [p[0], p[1], p[2]]), "still" in cinch,
      saved.joints.l_shoulder.join() !== ${JSON.stringify(afterSeesaw.joints.l_shoulder.join())}];`),
  [true, [["rope", 1, 0], ["rope", 2, 0]], false, true]);

  // A second cinch, a bridge: the left upline, the right, the left again.
  const cinched = await run(`return (await ${tiePose}).data;`);
  await run(`${editPose} $("#pose-mode-rope").click(); await wait(300);`);
  await tapRope(cinched, 1, 0, 0.3);
  await run(`$("#pose-cinch-start").click(); await wait(200);`);
  await tapRope(cinched, 2, 0, 0.3);
  await tapRope(cinched, 1, 0, 0.15);
  check("a second cinch on the same uplines, through three points, back to the first", await run(`
    $("#pose-finish-rope").click(); await wait(300);
    ${savePose}
    const saved = (await ${tiePose}).data;
    return [saved.ropes.length, saved.ropes[4].p.map((p) => [p[0], p[1]]), saved.ropes[4].l > 0];`),
  [5, [["rope", 1], ["rope", 2], ["rope", 1]], true]);

  // A rope added to the right upline, out to the body; then slack on it.
  const bridged = await run(`return (await ${tiePose}).data;`);
  await run(`${editPose} $("#pose-mode-rope").click(); await wait(300);`);
  await tapRope(bridged, 2, 0, 0.7);
  await run(`$("#pose-added-start").click(); await wait(200);`);
  const addedHint = await run(`return [$("#pose-rope-hint").textContent, $("#pose-cancel-rope").disabled];`);
  await tap(0.5, 0.45);
  check("Add rope starts a rope at the dot, laid as any rope, ended with Finish rope", [addedHint, await run(`
    for (let i = 0; i < 50 && !$("#pose-rope-hint").textContent.includes("2 points"); i++) await wait(100);
    const laid = $("#pose-rope-hint").textContent;
    $("#pose-finish-rope").click(); await wait(300);
    return [laid, $("#pose-finish-rope").disabled];`)],
  [["Added rope: 1 point. Keep tapping, then Finish rope.", false], ["Added rope: 2 points. Keep tapping, then Finish rope.", true]]);
  // The right upline above its two bends (the cinches), toward the ring.
  await tapRope(bridged, 2, 2, 0.5);
  check("…the slack, saved with the pose", await run(`
    if (!$("#pose-slack")) return ["no slack slider", $("#pose-rope-hint").textContent];
    ${slide("pose-slack", 30)}
    ${savePose}
    const saved = (await ${tiePose}).data;
    return [saved.ropes.length, saved.ropes[5].p[0].slice(0, 2), saved.ropes[5].p.length, saved.ropes[2].k];`),
  [6, ["rope", 2], 2, 30]);

  // On a bamboo in place of the ring (the uplines move to its middle).
  const onBamboo = setHardpoint(readPose(await run(`return (await ${tiePose}).data;`)), "bamboo");
  await run(`${editPose} $("#pose-mode-rope").click(); await wait(300); $("#pose-bamboo").click(); await wait(500);`);
  await sleep(300);
  // Above its three bends (the cinches), toward the bamboo.
  const [fx, fy] = await spot(onBamboo, 1, 3, 0.5);
  const across = await run(`return $("#pose-view").getBoundingClientRect().width;`);
  // A finger's width to one side of the upline, not on it.
  await tap(fx + 12 / across, fy);
  check("a tap beside an upline still chooses it; tied to a bamboo, it has Move on bamboo between Add cinch and Add rope", await run(`
    const at = (id) => $(id).getBoundingClientRect();
    return [!!$("#pose-cinch-start"), $("#pose-along-start")?.textContent, $("#pose-along-start")?.parentElement === $("#pose-cinch-start")?.parentElement,
      at("#pose-cinch-start").right < at("#pose-along-start").left && at("#pose-along-start").right < at("#pose-added-start").left];`),
  [true, "Move on bamboo", true, true]);
  check("Move on bamboo gives a slider under the buttons, sliding the upline along it; Done takes it away", await run(`
    $("#pose-along-start").click(); await wait(300);
    const labels = [...document.querySelectorAll("#pose-rope-options label")].map((l) => l.textContent);
    const range = [$("#pose-along-bamboo").min, $("#pose-along-bamboo").max];
    ${slide("pose-along-bamboo", -40)}
    $("#pose-along-bamboo-down").click(); await wait(200);
    const value = $("#pose-along-bamboo").value;
    $("#pose-along-done").click(); await wait(200);
    const back = !!$("#pose-along-bamboo");
    ${savePose}
    const saved = (await ${tiePose}).data;
    return [labels, range, value, back, saved.ropes[1].p.at(-1), saved.ropes[2].p.at(-1), saved.ropes[3].l > 0];`),
  [["Along the bamboo (cm)", "Slack (cm)"], ["-76", "76"], "-41", false, ["bamboo", -410, 0, 0], ["bamboo", 0, 0, 0], true]);
}

/**
 * "Allow collisions": a forearm folded into the belly is left where it's
 * put while it's ticked; unticked, the poser offers to fix it (as one
 * change) or leave it; and a move made while it's unticked is settled.
 * @param {{ tap: (fx: number, fy: number) => Promise<void>, slide: (id: string, value: number) => string, topDialog: string }} helpers
 */
async function collisions({ tap, slide, topDialog }) {
  const seeded = {
    v: 1, joints: { l_shoulder: [20, 0, -80] }, body: [0, 0, 0], lift: 99, shift: [0, 0], camera: [0, 8, 380, 110, 0, 0],
    ring: null, bamboo: null, hashira: null, ropes: [],
  };
  await run(`
    const postJson = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    const tie = await postJson("/api/ties", { tie_type: "floor", tie_date: "2026-10-03", title: "Collision test" });
    await postJson("/api/poses", { tie_id: tie.id, data: ${JSON.stringify(seeded)} });`);
  await go("/");
  await run(`[...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Collision test").click(); await wait(1500);
    $("#tie-visuals .visual-pose .photo-thumb").click(); await wait(800); $("#tie-pose-edit").click();
    for (let i = 0; i < 100 && !document.querySelector("dialog.pose-editor[open]"); i++) await wait(100);
    await wait(500);`);
  // The left forearm, halfway along: where to tap to pose the elbow.
  const forearm = await run(`
    const three = await import("/js/vendor/three.js");
    const { makeSkeleton, posed, onBone } = await import("/js/pose-skeleton.js");
    const { readPose } = await import("/js/pose-format.js");
    const data = readPose(${JSON.stringify(seeded)});
    const skeleton = makeSkeleton(); posed(skeleton, data);
    const point = onBone(skeleton, "l_elbow", [0, -12, 0]);
    const r = $("#pose-view").getBoundingClientRect();
    const camera = new three.PerspectiveCamera(38, r.width / r.height, 5, 5000);
    const [yaw, pitch, distance, height] = data.camera;
    const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
    camera.position.set(Math.sin(y) * Math.cos(p) * distance, height + Math.sin(p) * distance, Math.cos(y) * Math.cos(p) * distance);
    camera.lookAt(0, height, 0);
    camera.updateMatrixWorld();
    const at = point.project(camera);
    return [(at.x + 1) / 2, (1 - at.y) / 2];`);
  await tap(forearm[0], forearm[1]);
  const buttonIn = `(label) => [...${topDialog}.querySelectorAll("button")].find((b) => b.textContent === label)`;
  check("with Allow collisions ticked, a forearm folded into the belly stays where it's put", await run(`
    const part = $("#pose-part").textContent;
    ${slide("pose-l_elbow-0", 150)}
    return [part, $("#pose-allow-collisions").checked, $("#pose-l_elbow-0").value];`), ["Left elbow", true, "150"]);
  check("unticking it asks to fix the collisions; fixing them brings the forearm out, as one change to undo", await run(`
    const box = $("#pose-allow-collisions"); box.click(); await wait(800);
    const asked = [${topDialog}.querySelector("h2")?.textContent, !!(${buttonIn})("Leave them")];
    (${buttonIn})("Fix them now").click(); await wait(800);
    const fixed = [$("#pose-message").textContent, $("#pose-undo").disabled];
    $("#pose-undo").click(); await wait(300);
    return [asked, fixed, $("#pose-l_elbow-0").value, box.checked];`),
  [["Fix the collisions?", true], ["Fixed: the body parts are back within reach and apart.", false], "150", false]);
  check("leaving them changes nothing; a move made unticked is settled", await run(`
    const box = $("#pose-allow-collisions"); box.click(); await wait(200); box.click(); await wait(800);
    (${buttonIn})("Leave them").click(); await wait(500);
    const left = $("#pose-l_elbow-0").value;
    ${slide("pose-l_elbow-0", 0)}
    ${slide("pose-l_elbow-0", 150)}
    return [left, Number($("#pose-l_elbow-0").value) < 150];`), ["150", true]);
  // Ticked again for the next time the poser opens, as it is by default.
  await run(`$("#pose-allow-collisions").click(); await wait(200); $("#pose-cancel").click(); await wait(500);
    (${buttonIn})("Discard changes")?.click(); await wait(500);`);
}
