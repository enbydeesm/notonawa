// The walkthrough's poses chunk. Poses on ties: the poser (the body, arms and turn pickers, saving, saving over,
// renaming and deleting my own presets, posing a part with a slider, the head's sliders moving the whole
// figure, typing a slider's number and stepping it with ▲ ▼, dragging a leg, undo, downloading a picture, laying a
// rope with taps, the ring, bamboo (its length and hanger inset) and hashira, the pencil's marks, "Add to visuals",
// a see-saw rope, the chosen rope's panel, cinches (one through three points, and one on ropes round the body only), a rope added to an upline, slack, Cancel, sliding an upline along the bamboo, tapped on a pose made through the API, and the
// tabs and foot in a row each on a phone, the Scene tab), "Allow collisions" (fixing or leaving clashes), the nav's poser (and its "Add pose
// to…": on a tie there already, or a new one), saving with the tie,
// captions, duplicating, and export and import. Taps on the 3D view are real input (Chrome's own mouse events),
// so a 3D view that doesn't draw, or picks the wrong thing, shows up here.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { readZip } from "../../../public/js/zip.js";
import { check, freshAccount, go, run, send, sleep, workDir } from "../harness.mjs";
import { readPose, setHardpoint } from "../../../public/js/pose-format.js";
import { BODY_PRESETS, ARMS_PRESETS } from "../../../public/js/figure-rig.js";

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
  const slide = (id, value) => `{ const el = $("#${id}"); el.value = "${value}"; el.dispatchEvent(new Event("input")); el.dispatchEvent(new Event("change")); await calm(200); }`;
  const tiePoses = `(async () => {
    const tie = (await store.findTies({}))
      .ties.find((t) => t.title === "Pose test");
    return store.listPoses({ tie_id: tie.id });
  })()`;
  const openTie = `[...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Pose test").click(); await calm(1500);`;
  const topDialog = `[...document.querySelectorAll("dialog[open]")].pop()`;

  check("the nav's poser button opens the poser on its own, its hidden heading taking focus (no button ringed): Add to visuals and Save pose there to use, Close, Allow collisions ticked", await run(`
    $("#nav-poser").click();
    for (let i = 0; i < 100 && !document.querySelector("dialog.pose-editor[open]"); i++) await wait(100);
    await calm(500);
    const focused = document.activeElement?.id;
    const frame = $(".pose-frame").getBoundingClientRect(), allow = $(".pose-allow"), box = allow.getBoundingClientRect();
    const result = [$("#pose-add-visual").disabled, $("#pose-save").disabled, $("#pose-cancel").textContent, $("#pose-allow-collisions").checked,
      allow.textContent, frame.right - box.right < 16 && frame.bottom - box.bottom < 16,
      getComputedStyle(allow).color === getComputedStyle($("#pose-view-hint")).color, leakyFields()];
    $("#pose-cancel").click(); await calm(300);
    return [focused, ...result, !!document.querySelector("dialog.pose-editor")];`),
  ["pose-heading", false, false, "Close", true, "Allow collisions", true, true, [], false]);

  await run(`$(".nav-add").click(); await calm(600); set("#tie-title", "Pose test"); set("#tie-tie_type", "suspension");`);
  check("the Visuals + offers the model poser", await run(`
    $("#tie-add-visual").click(); await calm(300);
    return $("#tie-add-pose").textContent;`), "Model poser");
  check("it opens the poser, filling the screen, with the 3D view drawn and Pose chosen", await run(`
    $("#tie-add-pose").click();
    for (let i = 0; i < 100 && !document.querySelector("dialog.pose-editor[open]"); i++) await wait(100);
    await calm(500);
    const editor = $("dialog.pose-editor[open]"), r = editor.getBoundingClientRect(), view = $("#pose-view").getBoundingClientRect();
    return [Math.round(r.width) === innerWidth, Math.round(r.height) === innerHeight, view.width > 200, view.height > 150,
      $("#pose-mode-pose").getAttribute("aria-pressed"), $("#pose-part").textContent, $("#pose-undo").disabled, leakyFields()];`),
  [true, true, true, true, "true", "Tap a body part to pose it", true, []]);

  check("the view's hint bottom left, the cube top right opening the views, and Positions (Body, Arms) apart from Facing (Turn)", await run(`
    const frame = $(".pose-frame").getBoundingClientRect(), views = $("#pose-view-choice").getBoundingClientRect();
    const hint = $("#pose-view-hint"), at = hint.getBoundingClientRect();
    const closed = $("#pose-view-list").hidden;
    $("#pose-view-choice").click(); await wait(100);
    const listed = [...document.querySelectorAll("#pose-view-list button")].map((b) => b.textContent);
    $("#pose-view-0").click(); await wait(100);
    return [hint.textContent, frame.bottom - at.bottom < 16 && at.left - frame.left < 16,
      Math.round(frame.right - views.right) < 12 && Math.round(views.top - frame.top) < 12,
      $("#pose-view-choice").getAttribute("aria-label"), !!$("#pose-view-choice svg"), closed, listed, $("#pose-view-list").hidden,
      ["#pose-body-preset", "#pose-arms-preset", "#pose-orientation"].map((id) => [$(id).tagName, $(id).textContent, !!$(id + " svg")]),
      [...document.querySelectorAll(".pose-menus .pose-row-label")].map((l) => l.textContent), $("#pose-orientation").getAttribute("aria-label")];`),
  ["Drag head for height · tap for whole body", true, true, "View from", true, true, ["Front", "Left side", "Back", "Right side", "Above"], true,
    [["BUTTON", "Body▾", true], ["BUTTON", "Arms▾", true], ["BUTTON", "Turn▾", true]], ["Positions", "Facing"], "Turn body"]);
  check("Pose, Rope and Scene are the tabs; undo, redo and the pencil are icons on the view; Download and Add to visuals icons at the foot", await run(`
    return [[...$("#pose-mode-pose").parentElement.children].map((b) => b.id),
      [...$(".pose-view-tools").children].map((b) => b.id).filter(Boolean),
      ["#pose-undo", "#pose-redo", "#pose-mode-draw", "#pose-download", "#pose-add-visual"].map((id) => [$(id).getAttribute("aria-label"), !!$(id + " svg"), $(id).textContent]),
      [...$("#pose-save").parentElement.children].map((b) => b.id)];`),
  [["pose-mode-pose", "pose-mode-rope", "pose-mode-scene"], ["pose-undo", "pose-redo", "pose-mode-draw"],
    [["Undo", true, ""], ["Redo", true, ""], ["Draw over the view", true, ""], ["Download picture", true, ""], ["Add to visuals", true, ""]],
    ["pose-cancel", "pose-download", "pose-add-visual", "pose-save"]]);
  // A phone 390px wide: the tabs in one row, the foot in one row, and the panel below cut part-way through a row, fading out.
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  check("on a phone, the tabs fit one row and the foot another, and the panel fades where there's more to scroll", await run(`
    const middle = (id) => { const b = $(id).getBoundingClientRect(); return Math.round((b.top + b.bottom) / 2); };
    const tabs = ["#pose-mode-pose", "#pose-mode-rope", "#pose-mode-scene"].map(middle);
    const foot = ["#pose-cancel", "#pose-download", "#pose-add-visual", "#pose-save"].map(middle);
    const fits = $("#pose-save").getBoundingClientRect().right <= innerWidth;
    $("#pose-mode-scene").click(); await calm(200); $("#pose-bamboo").click(); await calm(500);
    const panels = $("#pose-panels"), box = panels.getBoundingClientRect();
    const cut = [...document.querySelectorAll("#pose-hardpoint-sliders .pose-slider")]
      .some((r) => { const b = r.getBoundingClientRect(); return b.top < box.bottom && b.bottom > box.bottom; });
    const result = [new Set(tabs).size, new Set(foot).size, fits, panels.classList.contains("more-below"), cut, getComputedStyle($("#pose-message")).display];
    $("#pose-undo").click(); await calm(200); $("#pose-mode-pose").click(); await calm(200);
    return result;`), [1, 1, true, true, true, "none"]);
  check("on a phone, the view's hint is bottom left, clear of Allow collisions, and says what fingers do in each tab", await run(`
    const hint = $("#pose-view-hint"), box = hint.getBoundingClientRect(), allow = $(".pose-allow").getBoundingClientRect();
    const frame = $(".pose-frame").getBoundingClientRect();
    const shown = [hint.textContent, box.right <= allow.left, frame.bottom - box.bottom < 16 && box.left - frame.left < 16];
    $("#pose-mode-rope").click(); await calm(200);
    const inRope = [hint.textContent, $(".pose-allow").checkVisibility()];
    $("#pose-mode-pose").click(); await calm(200);
    return [...shown, inRope, hint.textContent];`),
  ["Drag head for height · tap for whole body", true, true, ["Drag to turn · 2 fingers to pan · pinch to zoom", false],
    "Drag head for height · tap for whole body"]);
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
  // The built-in body presets, in their order (figure-rig.js).
  const BODY_NAMES = BODY_PRESETS.map((p) => p.name);
  check("Arms… opens Arms Presets: Save as preset and ✕ on its heading's row, on the heading (no keyboard), the one the figure's in tinted and Save greyed out; ✕ changes nothing", await run(`
    ${openPicker("#pose-arms-preset", "#pose-arms-presets")}
    const d = $("#pose-arms-presets");
    const header = [...d.querySelector(".dialog-header").querySelectorAll("h2, button")].map((el) => el.getAttribute("aria-label") ?? el.textContent);
    const tinted = getComputedStyle($("#pose-arms-presets-b0")).backgroundColor !== getComputedStyle($("#pose-arms-presets-b1")).backgroundColor;
    const result = [header, document.activeElement?.id, $("#pose-arms-presets-search").placeholder, $("#pose-arms-presets-save").disabled,
      ${pickerRows("#pose-arms-presets")}, tinted, leakyFields()];
    $("#pose-arms-presets-close").click(); await calm(200);
    return [...result, !!$("#pose-arms-presets"), $("#pose-undo").disabled];`),
  [["Arms Presets", "Save as preset", "Close"], "pose-arms-presets-title", "Search", true,
    ARMS_PRESETS.map((p, i) => [p.name, i === 0]), true, [],
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
    $("#pose-arms-presets-b1").click(); await calm(300);
    const after = [!!$("#pose-arms-presets"), $("#pose-undo").disabled];
    $("#pose-undo").click(); await calm(200);
    const undone = $("#pose-redo").disabled;
    $("#pose-redo").click(); await calm(200);
    ${openPicker("#pose-arms-preset", "#pose-arms-presets")}
    const now = [$("#pose-arms-presets-b1").classList.contains("current"), $("#pose-arms-presets-save").disabled];
    $("#pose-arms-presets-close").click(); await calm(200);
    return [steady, found, after, undone, now];`), [true, [["Boxtie", false]], [false, false], false, [true, true]]);
  check("Turn body…: the same kind of picker, no search or Save, the way the body faces tinted", await run(`
    ${openPicker("#pose-orientation", "#pose-turn")}
    const result = [$("#pose-turn h2").textContent, !!$("#pose-turn input"), ${pickerRows("#pose-turn")}.filter(([, on]) => on).length];
    $("#pose-turn-close").click(); await calm(200);
    return [...result, !!$("#pose-turn")];`), ["Turn body", false, 1, false]);

  // Saved presets. The body as it starts is the Standing preset, so it's
  // changed first (the head tipped), for there to be something to save.
  const myPresets = `(async () => {
    const list = await store.listPosePresets();
    const hidden = !(await plainOnServer("Standing tall"));
    return list.map((p) => [p.kind, hidden, p.name.includes("tall")]);
  })()`;
  await tap(0.5, 0.2);
  check("the body can be saved as a preset, named, its name sealed; it's listed under My presets, tinted, and Save greys out", await run(`
    ${slide("pose-head-0", 10)}
    ${openPicker("#pose-body-preset", "#pose-body-presets")}
    const enabled = !$("#pose-body-presets-save").disabled;
    $("#pose-body-presets-save").click(); await calm(300);
    const asked = [$("#pose-preset-title").textContent, document.activeElement?.id, $("#pose-preset-also").closest("label").textContent,
      $("#pose-preset-also").checked, leakyFields()];
    set("#pose-preset-name", " Standing tall "); $("#pose-preset-save").click();
    for (let i = 0; i < 50 && document.querySelector("#pose-preset-name"); i++) await wait(100);
    await calm(200);
    return [enabled, asked, $("#pose-body-presets-message").textContent, ${pickerRows("#pose-body-presets")},
      $("#pose-body-presets-save").disabled, await ${myPresets}];`),
  [true, ["Save this body as a preset", "pose-preset-name", " Save arms as a preset too?", false, []], "Saved, for any pose.",
    [...BODY_NAMES.map((n) => [n, false]), ["My presets", false], ["Standing tall", true]], true, [["body", true, true]]]);
  check("my presets are in alphabetical order after the built-in ones, each with save, rename and delete (red) icons, from the left; saving with the arms too adds an arms preset", await run(`
    $("#pose-body-presets-b${BODY_NAMES.indexOf("Kneeling up")}").click(); await calm(300);
    ${slide("pose-head-0", -10)}
    ${openPicker("#pose-body-preset", "#pose-body-presets")}
    $("#pose-body-presets-save").click(); await calm(300);
    set("#pose-preset-name", "Kneel, head down"); $("#pose-preset-also").checked = true; $("#pose-preset-save").click();
    for (let i = 0; i < 50 && document.querySelector("#pose-preset-name"); i++) await wait(100);
    await calm(200);
    const kinds = (await store.listPosePresets()).map((p) => p.kind);
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
    ${icon("Save this body over Standing tall")}.click(); await calm(300);
    const overAsked = ${topDialog}.querySelector("h2").textContent;
    [...${topDialog}.querySelectorAll("button")].find((b) => b.textContent === "Save over it").click();
    for (let i = 0; i < 50 && !${pickerRows("#pose-body-presets")}.at(-1)[1]; i++) await wait(100);
    const over = ${pickerRows("#pose-body-presets")}.slice(-2);
    ${icon("Rename Kneel, head down")}.click(); await calm(300);
    const renaming = [$("#pose-preset-title").textContent, $("#pose-preset-name").value];
    set("#pose-preset-name", "Kneel"); $("#pose-preset-save").click();
    for (let i = 0; i < 50 && document.querySelector("#pose-preset-name"); i++) await wait(100);
    await calm(200);
    const renamed = ${pickerRows("#pose-body-presets")}.slice(-2);
    ${icon("Delete Standing tall")}.click(); await calm(300);
    const deleteAsked = ${topDialog}.querySelector("h2").textContent;
    [...${topDialog}.querySelectorAll("button")].find((b) => b.textContent === "Delete preset").click();
    for (let i = 0; i < 50 && ${pickerRows("#pose-body-presets")}.some(([n]) => n === "Standing tall"); i++) await wait(100);
    const after = ${pickerRows("#pose-body-presets")}.slice(-2);
    $("#pose-body-presets-close").click(); await calm(200);
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
    $("#pose-reset-part").click(); await calm(200);
    const reset = $("#pose-hips-0").value;
    $("#pose-undo").click(); await calm(200); $("#pose-undo").click(); await calm(200);
    return [tilted, reset, $("#pose-hips-0").value];`), [["20", false], "0", "0"]);
  // The waist is just above, at the top of the hips.
  await tap(0.5, 0.43);
  check("just above the hips is the waist", await run(`
    return [$("#pose-part").textContent, [...document.querySelectorAll("#pose-sliders label")].map((l) => l.textContent)];`),
  ["Waist", ["Forward", "Lean", "Turn"]]);
  // Off the body, on the empty view to its left.
  await tap(0.08, 0.3);
  check("tapping off the body lets the part go, and the panel is as it opens", await run(`
    return [$("#pose-part").textContent, document.querySelectorAll("#pose-sliders .pose-slider").length, $("#pose-reset-part").hidden];`),
  ["Tap a body part to pose it", 0, true]);
  // The head is at the top of the view.
  await tap(0.5, 0.2);
  check("the head has its own sliders, then the whole body's under a heading with its own Reset", await run(`
    return [$("#pose-part").textContent, [...document.querySelectorAll("#pose-sliders label")].map((l) => l.textContent),
      $("#pose-whole").textContent, $("#pose-reset-whole").parentElement === $("#pose-whole").parentElement];`),
  ["Head", ["Forward", "Lean", "Turn", "Tip body", "Turn body", "Roll body", "Height (cm)", "Front to back (cm)", "Across (cm)"], "Whole body", true]);
  // Dragging the head up lifts the whole body: its Height, nothing else of
  // the head's; off the floor, the feet go en pointe.
  const heightBefore = await run(`return $("#pose-lift").value;`);
  await drag(0.5, 0.5, 0.2, 0.08);
  check("dragging the head up lifts the whole body, as one change: the head's own sliders as they were, and the feet pointed off the floor", await run(`
    const lifted = [$("#pose-part").textContent, Number($("#pose-lift").value) > ${Number(heightBefore)} + 5,
      ["pose-head-0", "pose-head-1", "pose-head-2"].map((id) => $("#" + id).value), $("#pose-undo").disabled];
    $("#pose-undo").click(); await calm(200);
    return [...lifted, $("#pose-lift").value];`),
  ["Head", true, ["0", "0", "0"], false, heightBefore]);
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
    $("#pose-undo").click(); await calm(200);
    const undone = $("#pose-body-1").value;
    $("#pose-undo").click(); await calm(200);
    return [undone, $("#pose-body-1").value, leakyFields()];`)],
  [["Turn body, typed", "number"], [["-45", "-45"], ["-180", "-180"], ["-180", "-180"]], ["-45", "20", []]]);
  check("▲ and ▼ left of a slider's box step it by one, each a change", await run(`
    const steps = $("#pose-body-1-up").parentElement;
    const placed = steps.nextElementSibling === $("#pose-body-1-typed") && steps.previousElementSibling === $("#pose-body-1");
    $("#pose-body-1-up").click(); await calm(200);
    const up = $("#pose-body-1-typed").value;
    $("#pose-body-1-down").click(); await calm(200); $("#pose-body-1-down").click(); await calm(200);
    const down = $("#pose-body-1").value;
    for (let i = 0; i < 3; i++) { $("#pose-undo").click(); await wait(200); }
    return [placed, $("#pose-body-1-up").getAttribute("aria-label"), $("#pose-body-1-down").textContent, up, down, $("#pose-body-1").value];`),
  [true, "Turn body: up one", "▼", "21", "19", "20"]);

  // The left shin is low on the view's right, with the head selected (the
  // view's size, and so the figure's place on it, changes with the
  // selected part's sliders).
  const redoBefore = await run(`return $("#pose-redo").disabled;`);
  await drag(0.62, 0.62, 0.78, 0.6);
  // A change made clears what redo had (the typed turns undone above).
  check("dragging a leg moves it as one change, the shin selected, and undo puts it back", [redoBefore, await run(`
    const after = [$("#pose-part").textContent, $("#pose-redo").disabled];
    $("#pose-undo").click(); await calm(200);
    return [...after, $("#pose-redo").disabled, $("#pose-l_knee-0").value];`)],
  [false, ["Left knee", true, false, "0"]]);
  // Back to the head, for the steps after.
  await tap(0.5, 0.2);

  await drag(0.3, 0.6, 0.8);
  check("dragging turns the view, which undo leaves alone", await run(`
    $("#pose-undo").click(); await calm(200);
    return ${turned};`), "0");
  await run(`$("#pose-redo").click(); await calm(200);`);

  check("moving the figure from the head is one change; the head's Reset leaves it moved, the whole body's Reset stands it back up, and undo puts it back", await run(`
    ${slide("pose-shift-0", 30)} ${slide("pose-head-0", 20)}
    const moved = [$("#pose-shift-0").value, $("#pose-head-0").value];
    $("#pose-reset-part").click(); await calm(200);
    const reset = [$("#pose-shift-0").value, $("#pose-head-0").value];
    $("#pose-undo").click(); await calm(200); $("#pose-undo").click(); await calm(200); $("#pose-undo").click(); await calm(200);
    const undone = [$("#pose-shift-0").value, $("#pose-head-0").value];
    ${slide("pose-shift-0", 30)} ${slide("pose-body-0", 15)}
    $("#pose-reset-whole").click(); await calm(200);
    const whole = [$("#pose-shift-0").value, $("#pose-body-0").value];
    for (let i = 0; i < 3; i++) { $("#pose-undo").click(); await wait(200); }
    return [moved, reset, undone, whole, $("#pose-shift-0").value];`), [["30", "20"], ["30", "0"], ["0", "0"], ["0", "0"], "0"]);
  await tap(0.5, 0.5);

  const hardpoints = `["ring", "bamboo", "hashira"].map((k) => [$("#pose-" + k).textContent, $("#pose-" + k).getAttribute("aria-pressed")])`;
  const hardpointLabels = `[...document.querySelectorAll("#pose-hardpoint-sliders label")].map((l) => l.textContent)`;
  check("Rope: thickness and the eraser above the colors, jute chosen to begin with, no bar over the view, and + Hardpoint at the end of the thickness row, opening Scene", await run(`
    $("#pose-mode-rope").click(); await calm(200);
    const rows = [...document.querySelectorAll("#pose-panel-rope .pose-rope-tools-rows [role=group]")].map((c) => c.getAttribute("aria-label"));
    const chip = $("#pose-hardpoint-link"), row = $("#pose-eraser").getBoundingClientRect(), at = chip.getBoundingClientRect();
    const rope = [$("#pose-color-jute").getAttribute("aria-pressed"), $("#pose-panel-pose").hidden, $("#pose-laying-bar").hidden,
      chip.textContent, chip.getAttribute("aria-label"), Math.abs((at.top + at.bottom) / 2 - (row.top + row.bottom) / 2) < 3,
      Math.round($("#pose-panel-rope").getBoundingClientRect().right - at.right) < 4, $("#pose-rope-hint").textContent];
    $("#pose-hardpoint-link").click(); await calm(200);
    return [rows, ...rope, $("#pose-mode-scene").getAttribute("aria-pressed"), $("#pose-panel-rope").hidden];`),
  [["Rope thickness", "Rope color"], "true", true, true, "+ Hardpoint", "Add a hardpoint in Scene", true, true,
    "Tap the body to lay a rope, point by point.", "true", true]);
  check("Scene: Hardpoint and Body shape as a switch, a ring, bamboo or hashira as chips, the one there highlighted, its sliders under it", await run(`
    const parts = [$("#pose-scene-hardpoint").getAttribute("aria-pressed"), $("#pose-scene-shape").getAttribute("aria-pressed"),
      $("#pose-scene-part-shape").hidden, ${hardpoints}, $("#pose-hardpoint-sliders").hidden];
    $("#pose-ring").click(); await calm(200);
    return [...parts, ${hardpoints}, $("#pose-ring").title, $("#pose-hardpoint-sliders").hidden, ${hardpointLabels}, leakyFields()];`),
  ["true", "false", true, [["ring", "false"], ["bamboo", "false"], ["hashira", "false"]], true,
    [["ring", "true"], ["bamboo", "false"], ["hashira", "false"]], "Remove ring", false,
    ["Across (cm)", "Height (cm)", "Front to back (cm)"], []]);
  check("a bamboo has a length and a hanger inset, 152 and 30 cm to begin with, the inset short of the middle", await run(`
    $("#pose-bamboo").click(); await calm(200);
    const labels = ${hardpointLabels}.slice(4);
    const start = [$("#pose-bamboo-4").value, $("#pose-bamboo-5").value, $("#pose-bamboo-5").max];
    ${slide("pose-bamboo-4", 90)}
    const shorter = [$("#pose-bamboo-5").value, $("#pose-bamboo-5").max];
    ${slide("pose-bamboo-5", 60)}
    const inset = $("#pose-bamboo-5").value;
    $("#pose-bamboo-5-up").click(); await calm(200);
    const stepped = $("#pose-bamboo-5").value;
    for (let i = 0; i < 3; i++) { $("#pose-undo").click(); await wait(200); }
    return [labels, start, shorter, inset, stepped, ${hardpoints}];`),
  [["Length (cm)", "Hanger inset (cm)"], ["152", "30", "71"], ["30", "40"], "40", "40",
    [["ring", "true"], ["bamboo", "false"], ["hashira", "false"]]]);

  await run(`$("#pose-mode-rope").click(); await calm(200);`);
  await tap(0.5, 0.5);
  await tap(0.5, 0.38);
  check("tapping the body lays a rope, point by point, its count, Cancel and Finish in a bar over the view", await run(`
    return [$("#pose-rope-hint").textContent, $("#pose-laying-bar").hidden, $("#pose-laying-count").textContent, $("#pose-finish-rope").disabled,
      [...$("#pose-laying-bar").children].map((c) => c.id), $("#pose-view-hint").hidden];`),
  ["Rope: 2 points. Keep tapping, then Finish.", false, "Laying rope · 2 points", false,
    ["pose-laying-count", "pose-cancel-rope", "pose-finish-rope"], true]);
  check("Undo takes back the last point first", await run(`
    $("#pose-undo").click(); await calm(200); const one = $("#pose-rope-hint").textContent;
    return one;`), "Rope: 1 point. Keep tapping, then Finish.");
  check("Cancel drops the rope being laid, and the bar goes", await run(`
    $("#pose-cancel-rope").click(); await calm(200);
    return [$("#pose-laying-bar").hidden, $("#pose-rope-hint").textContent.startsWith("Tap the body")];`),
  [true, true]);
  await tap(0.5, 0.5);
  await tap(0.5, 0.4);
  await run(`$("#pose-finish-rope").click(); await calm(200);`);

  const marks = `document.querySelectorAll("#pose-marks path").length`;
  check("the pencil: a switch over the tab; in the tab's place, the Rope tab's own rows where they were, red chosen, Done where the hardpoint's chip was, and marks only it can draw", await run(`
    const place = (id) => { const r = $(id).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; };
    const before = [place("#pose-width-1"), place("#pose-color-black"), place("#pose-hardpoint-link")];
    $("#pose-mode-draw").click(); await calm(200);
    const rows = (id) => [...document.querySelectorAll(id + " .pose-rope-tools-rows [role=group]")].map((c) => c.getAttribute("aria-label"));
    const after = [place("#pose-mark-width-1"), place("#pose-mark-color-black")];
    const done = $("#pose-draw-done").getBoundingClientRect(), chipWas = before[2];
    return [$("#pose-mode-draw").getAttribute("aria-pressed"), $("#pose-panel-draw").hidden, $("#pose-panel-rope").hidden,
      JSON.stringify(after) === JSON.stringify(before.slice(0, 2)), Math.abs(Math.round(done.top) - chipWas[1]) < 6,
      $("#pose-draw-done").textContent, !!$("#pose-draw-done svg"), rows("#pose-panel-draw"), rows("#pose-panel-rope"),
      [...document.querySelectorAll("#pose-panel-draw .swatch-tool")].map((b) => b.getAttribute("aria-label")), !!$("#pose-color-grey"),
      getComputedStyle($("#pose-mark-color-jute")).getPropertyValue("--ink").trim(),
      $("#pose-mark-color-red").getAttribute("aria-pressed"), $("#pose-marks").classList.contains("drawing"), $("#pose-view-hint").textContent, ${marks}];`),
  ["true", false, true, true, true, "Done", true, ["Line thickness", "Line color"], ["Rope thickness", "Rope color"],
    ["Black", "Jute", "Red", "Orange", "Green", "Blue", "Purple", "Pink"], false, "#b8925a", "true", true,
    "Draw with a finger", 0]);
  await drag(0.3, 0.7, 0.2, 0.3);
  check("drawing over the view adds a mark, as one change, and the view doesn't turn", await run(`
    return [${marks}, $("#pose-undo").disabled, $("#pose-marks path").getAttribute("class")];`), [1, false, "ink-red"]);
  await run(`$("#pose-mark-eraser").click(); await wait(100);`);
  await tap(0.5, 0.25);
  check("the eraser takes a mark out, and undo brings it back", await run(`
    const erased = ${marks};
    $("#pose-undo").click(); await calm(300);
    return [erased, ${marks}];`), [0, 1]);
  check("Done puts the pencil away, back to the tab it was on", await run(`
    $("#pose-draw-done").click(); await wait(100);
    return [$("#pose-mode-draw").getAttribute("aria-pressed"), $("#pose-panel-draw").hidden, $("#pose-panel-rope").hidden];`), ["false", true, false]);
  await run(`$("#pose-mode-pose").click(); await calm(200);`);
  check("the marks still show in the other tabs, but don't take taps", await run(`
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
    $("#tie-save").click(); await calm(3000); await settle();
    const [p] = await ${tiePoses};
    const tie = (await store.findTies({}))
      .ties.find((t) => t.title === "Pose test");
    const media = await store.listMedia({ tie_id: tie.id });
    return [!!document.querySelector("dialog[open]"), p.data.body, p.data.joints.l_elbow, p.data.ring, p.data.ropes.length,
      p.data.ropes[0].p.length, p.caption, media.map((m) => [m.kind, m.position]), p.position];`),
  [false, [0, 20, 0], [105, 0], [0, 195, 0], 1, 2, null, [["photo", 0]], 1]);

  check("a caption is saved encrypted and shown under the pose", await run(`
    ${openTie} $("#tie-visuals .visual-pose .photo-thumb").click(); await calm(800);
    set("#tie-pose-caption", " Lift "); $("#tie-pose-save-caption").click(); await calm(800);
    const [p] = await ${tiePoses};
    return [$("#tie-visuals .visual-pose figcaption")?.textContent, !(await plainOnServer("Lift")), p.caption, leakyFields()];`),
  ["Lift", true, "Lift", []]);
  check("its details: the caption, then one row of icons: the moves, Edit pose (in the accent), Duplicate, Copy to… and Delete; no Add as photo", await run(`
    const d = ${topDialog};
    const tools = [...d.querySelector(".viewer-tools").children].map((el) => el.id || el.className);
    const order = [...d.children].map((c) => c.className);
    return [order.indexOf("caption-wrap") < order.indexOf("viewer-tools"), tools, $("#tie-pose-edit").classList.contains("accent"), !!$("#tie-pose-photo")];`),
  [true, ["tie-pose-earlier", "tie-pose-later", "tool-divider", "tie-pose-edit", "tie-pose-duplicate", "tie-pose-copy", "tool-gap", "tie-pose-delete"],
    true, false]);
  check("Edit pose: the saved preset is in its Body… picker; a bamboo in place of the ring, then a hashira, its own sliders each; nothing kept on Cancel", await run(`
    $("#tie-pose-edit").click();
    for (let i = 0; i < 100 && !document.querySelector("dialog.pose-editor[open]"); i++) await wait(100);
    await calm(300);
    ${openPicker("#pose-body-preset", "#pose-body-presets")}
    const saved = ${pickerRows("#pose-body-presets")}.slice(${BODY_NAMES.length}).map(([n]) => n);
    $("#pose-body-presets-close").click(); await calm(200);
    $("#pose-mode-scene").click(); await wait(100);
    $("#pose-bamboo").click(); await calm(200);
    const bamboo = [${hardpoints}, $("#pose-rope-hint").textContent, ${hardpointLabels}];
    // Nothing's asked, whatever ropes are on it.
    $("#pose-hashira").click(); await calm(300);
    const asked = ${topDialog}.classList.contains("pose-editor");
    const hashira = [$("#pose-hashira").getAttribute("aria-pressed"), ${hardpointLabels}];
    $("#pose-cancel").click(); await calm(300);
    [...${topDialog}.querySelectorAll("button")].find((b) => b.textContent === "Discard changes").click(); await calm(300);
    const [p] = await ${tiePoses};
    return [saved, bamboo, asked, hashira, !!$("dialog.pose-editor"), p.data.ring];`),
  [["My presets", "Kneel"], [[["ring", "false"], ["bamboo", "true"], ["hashira", "false"]],
    "Tap the body to lay a rope. Tap the bamboo for an upline, or a rope to choose it.",
    ["Across (cm)", "Height (cm)", "Front to back (cm)", "Turn", "Length (cm)", "Hanger inset (cm)"]],
  true, ["true", ["Across (cm)", "Front to back (cm)", "Turn"]], false, [0, 195, 0]]);
  check("Duplicate adds a copy last, with the same pose and caption", await run(`
    $("#tie-pose-duplicate").click(); await calm(1000);
    ${topDialog}.querySelector(".dialog-cancel, [aria-label=Close]").click(); await calm(300);
    const [a, b] = await ${tiePoses};
    return [[...document.querySelectorAll("#tie-visuals .visual-pose figcaption")].map((f) => f.textContent),
      JSON.stringify(a.data) === JSON.stringify(b.data), a.id !== b.id];`),
  [["Lift", "Lift"], true, true]);
  await run(`${topDialog}.querySelector(".dialog-cancel, [aria-label=Close]").click(); await calm(300);`);

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
    $("#import-file").files = dt.files; $("#import-file").dispatchEvent(new Event("change")); await calm(2000);
    const preview = [...document.querySelectorAll("#import-preview .item")].map(flat).filter((t) => t.startsWith("Poses"));
    $("#import-go").click(); for (let i = 0; i < 100 && !/Imported|Couldn't/.test($("#import-message").textContent); i++) await wait(100);
    const listed = await ${tiePoses};
    const opened = await (await import("/js/vault.js")).open("pose", listed);
    return [preview, /Added 2 poses\\./.test($("#import-message").textContent), opened.map((p) => [p.caption, p.data.body[1]])];`),
  [["Poses | 2 in the file (added to ties, plans and workshops that don't already have poses)"], true, [["Lift", 20], ["Lift", 20]]]);

  await go("/");
  check("deleting a pose asks first, then removes it", await run(`
    ${openTie} $("#tie-visuals .visual-pose .photo-thumb").click(); await calm(800);
    $("#tie-pose-delete").click(); await calm(300);
    const asked = ${topDialog}.querySelector("h2").textContent;
    [...${topDialog}.querySelectorAll("button")].find((b) => b.textContent === "Delete pose").click(); await calm(800);
    return [asked, document.querySelectorAll("#tie-visuals .visual-pose").length, (await ${tiePoses}).length];`),
  ["Delete this pose?", 1, 1]);
  await run(`${topDialog}.querySelector(".dialog-cancel, [aria-label=Close]").click(); await calm(300);`);

  await ropes({ tap, slide, topDialog });
  await bodyCinch({ tap, topDialog });
  await collisions({ tap, slide, topDialog });
  await hanging({ topDialog });
  await wrapping({ tap, drag, topDialog });
  await standalone({ topDialog });
}

/**
 * Dangle: a body in the air, on a line to a ring off to its side,
 * comes to rest under the ring; a body standing on the floor has no button.
 * @param {{ topDialog: string }} helpers
 */
async function hanging({ topDialog }) {
  const seeded = {
    v: 1, joints: {}, body: [0, 0, 0], lift: 130, shift: [0, 0], shape: [50, 50, 25, 184], camera: [0, 8, 380, 110, 0, 0],
    ring: [40, 250, 0], bamboo: null, hashira: null, ropes: [{ c: "red", w: 2, p: [["chest", 0, 0, 0], ["ring", 0, 0, 0]] }],
  };
  const tiePose = `(async () => {
    const tie = (await store.findTies({}))
      .ties.find((t) => t.title === "Hang test");
    return (await store.listPoses({ tie_id: tie.id }))[0];
  })()`;
  await run(`
    const tie = await store.saveTie(null, { tie_type: "suspension", tie_date: "2026-10-05", title: "Hang test" });
    await store.addPose({ tie_id: tie }, { data: ${JSON.stringify(seeded)}, caption: null });`);
  await go("/");
  await run(`[...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Hang test").click(); await calm(1500);
    $("#tie-visuals .visual-pose .photo-thumb").click(); await calm(800); $("#tie-pose-edit").click();
    for (let i = 0; i < 100 && !document.querySelector("dialog.pose-editor[open]"); i++) await wait(100);
    await calm(500); $("#pose-mode-rope").click(); await calm(300);`);
  check("a body in the air has Dangle in the Rope tab, on one line between the eraser and the hardpoint's chip; at rest, tapping it again says so; Undo puts the body back", await run(`
    const box = (id) => $(id).getBoundingClientRect();
    const [eraser, dangle, chip] = [box("#pose-eraser"), box("#pose-hang"), box("#pose-hardpoint-link")];
    const shown = [!$("#pose-hang").hidden, $("#pose-hang").textContent, !!$("#pose-eraser svg"), $("#pose-eraser").textContent,
      eraser.right <= dangle.left && dangle.right <= chip.left, Math.abs(eraser.top - dangle.top) < 12 && Math.abs(dangle.top - chip.top) < 12];
    $("#pose-hang").click(); await calm(500);
    $("#pose-hang").click(); await calm(400);
    const said = $("#pose-rope-note").textContent;
    $("#pose-undo").click(); await calm(400);
    const undone = $("#pose-undo").disabled;
    $("#pose-redo").click(); await calm(400);
    return [shown, said, undone];`),
  [[true, "Dangle", true, "", true, true], "It's hanging as low as its lines allow.", true]);
  check("it swings the body under the ring, as one piece, saved with the pose", await run(`
    $("#pose-save").click();
    for (let i = 0; i < 100 && !/Pose saved|Couldn't/.test(${topDialog}.textContent); i++) await wait(100);
    const saved = (await ${tiePose}).data;
    // The ring is 40 cm to its left: the body went most of the way across, and came down a little.
    return [saved.shift[0] > 25, saved.lift < 130, saved.joints.l_hip];`),
  [true, true, [0, 0, 0]]);
}

/**
 * Wrap lays a turn of rope round the part tapped, undone as one; a chosen
 * rope's white dots move a point when dragged and take it out when tapped.
 * @param {{ tap: (fx: number, fy: number) => Promise<void>, drag: (fx0: number, fx1: number, fy0: number, fy1?: number) => Promise<void>, topDialog: string }} helpers
 */
async function wrapping({ tap, drag, topDialog }) {
  const tiePose = `(async () => {
    const tie = (await store.findTies({}))
      .ties.find((t) => t.title === "Wrap test");
    return (await store.listPoses({ tie_id: tie.id }))[0];
  })()`;
  const seeded = {
    v: 1, joints: {}, body: [0, 0, 0], lift: 99, shift: [0, 0], shape: [50, 50, 25, 184], camera: [0, 8, 380, 110, 0, 0],
    ring: null, bamboo: null, hashira: null, ropes: [],
  };
  await run(`$("#tie-close")?.click(); await calm(500);
    [...${topDialog}?.querySelectorAll("button") ?? []].find((b) => b.textContent === "Discard changes")?.click(); await calm(300);
    const tie = await store.saveTie(null, { tie_type: "floor", tie_date: "2026-10-06", title: "Wrap test" });
    await store.addPose({ tie_id: tie }, { data: ${JSON.stringify(seeded)}, caption: null });`);
  await go("/");
  await run(`[...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Wrap test").click(); await calm(1500);
    $("#tie-visuals .visual-pose .photo-thumb").click(); await calm(800); $("#tie-pose-edit").click();
    for (let i = 0; i < 100 && !document.querySelector("dialog.pose-editor[open]"); i++) await wait(100);
    await calm(500); $("#pose-mode-rope").click(); await calm(300);`);
  const count = `[$("#pose-wrap-count [aria-hidden]").textContent, $("#pose-wrap-count .visually-hidden").textContent]`;
  check("the Rope tab has Wrap top middle, between undo and the views, + over −; off, its turns greyed out; on, + makes it two turns and the help says what a tap does", await run(`
    const box = (id) => $(id).getBoundingClientRect();
    const [left, wrap, views, more, fewer] = [box(".pose-view-tools"), box(".pose-wrap-row"), box("#pose-view-choice"), box("#pose-wrap-more"), box("#pose-wrap-fewer")];
    const placed = [left.right < wrap.left && wrap.right < views.left, Math.abs(wrap.top - left.top) < 2,
      Math.abs((wrap.left - left.right) - (views.left - wrap.right)) < 3, more.bottom <= fewer.top && Math.abs(more.left - fewer.left) < 1];
    const off = [$("#pose-wrap").getAttribute("aria-pressed"), $("#pose-wrap-fewer").disabled, $("#pose-wrap-more").disabled, ${count}];
    $("#pose-wrap").click(); await calm(200);
    $("#pose-wrap-more").click(); await calm(200);
    return [placed, off, $("#pose-wrap").getAttribute("aria-pressed"), ${count}, $("#pose-rope-hint").textContent];`),
  [[true, true, true, true], ["false", true, true, ["1", "1 turn"]], "true", ["2", "2 turns"], "Wrap: tap an arm, a leg or the body to lay a turn of rope round it there."]);
  await tap(0.5, 0.42);
  check("a tap on the chest lays two turns round it, twenty-five points; Undo takes the whole wrap back", await run(`
    const laid = $("#pose-laying-count").textContent;
    $("#pose-undo").click(); await calm(300);
    return [laid, $("#pose-laying-count").textContent];`),
  ["Laying rope · 25 points", "Laying rope · 0 points"]);
  await run(`$("#pose-wrap-fewer").click(); await calm(200);`);
  await tap(0.5, 0.42);
  check("one turn is thirteen points, back to where it began, all round the chest; finished, it's a rope", await run(`
    const laid = $("#pose-laying-count").textContent;
    $("#pose-finish-rope").click(); await calm(300);
    $("#pose-wrap").click(); await calm(200);
    return [laid, $("#pose-laying-bar").hidden, $("#pose-wrap").getAttribute("aria-pressed")];`),
  ["Laying rope · 13 points", true, "false"]);
  // Tapping it where it began chooses it; its dots show, and the help says what they do.
  await tap(0.5, 0.42);
  check("chosen, the help tells its white dots from the black one, and Wrap is put away", await run(`
    return [$("#pose-rope-hint").textContent, $("#pose-wrap").closest(".pose-wrap-row").hidden];`),
  ["Drag a white dot to move that point, or tap it to take it out. Cinch and Add rope start from the black dot.", true]);
  // Its first point's dot is under the same spot: tapped, the point goes.
  await tap(0.5, 0.42);
  check("a white dot tapped takes its point out, and says so; the rope stays chosen", await run(`
    return [$("#pose-rope-note").textContent, !$("#pose-rope-options").hidden && !!$("#pose-rope-options").children.length];`),
  ["Point taken out.", true]);
  // Its last point is still there: dragged down the body, it moves.
  await drag(0.5, 0.5, 0.42, 0.52);
  check("a white dot dragged moves its point over the skin, as one change, saved with the pose", await run(`
    $("#pose-save").click();
    for (let i = 0; i < 100 && !/Pose saved|Couldn't/.test(${topDialog}.textContent); i++) await wait(100);
    const [rope] = (await ${tiePose}).data.ropes;
    const [first, last] = [rope.p[0], rope.p[rope.p.length - 1]];
    // Twelve points left, every one on the trunk; the last no longer where the wrap ended (level with its start).
    return [rope.p.length, rope.p.every((p) => ["chest", "spine", "pelvis"].includes(p[0])), last[0] !== "chest" || Math.abs(last[2] - first[2]) > 30];`),
  [12, true, true]);
}

/**
 * The poser opened on its own (the nav's button): Save pose and Add to
 * visuals ask where ("Add pose to…"), on a tie there already or a new one,
 * and the one chosen last comes first next time. Uses "Collision test",
 * made through the store by collisions().
 * @param {{ topDialog: string }} helpers
 */
async function standalone({ topDialog }) {
  const onTie = (/** @type {string} */ title, /** @type {string} */ what) => `(async () => {
    const tie = (await store.findTies({}))
      .ties.find((t) => t.title === "${title}");
    return tie ? store["${what === "media" ? "listMedia" : "listPoses"}"]({ tie_id: tie.id }) : null;
  })()`;
  const waitFor = (/** @type {string} */ expr) => `for (let i = 0; i < 100 && !(${expr}); i++) await wait(100);`;
  const rows = `[...document.querySelectorAll("#add-to-list .add-to-row")]`;
  const row = (/** @type {string} */ title) => `${rows}.find((r) => r.querySelector(".item-title").textContent === "${title}")`;
  const buttonIn = `(label) => [...${topDialog}.querySelectorAll("button")].find((b) => b.textContent === label)`;

  // "Collision test"'s form is still open from collisions(): the nav's
  // poser is opened from the view, with nothing over it.
  await run(`$("#tie-close")?.click(); await calm(500); (${buttonIn})("Discard changes")?.click(); await calm(300);`);
  check("the nav's poser: Save pose asks where, in one sheet: the poser's icon, one search, All chosen, Recent with each kind's tab icon, and + Tie, + Plan, + Workshop", await run(`
    $("#nav-poser").click();
    ${waitFor(`document.querySelector("dialog.pose-editor[open]")`)}
    await calm(500);
    $("#pose-save").click();
    ${waitFor(row("Collision test"))}
    const tie = ${row("Collision test")};
    return [$("#add-to-heading").textContent, !!$(".add-to-head .pose-icon"), $("#add-to-search").placeholder,
      ["all", "tie", "plan", "workshop"].map((k) => [$("#add-to-filter-" + k).textContent, $("#add-to-filter-" + k).getAttribute("aria-pressed")]),
      $("#add-to-list-label").textContent, !!tie.querySelector("svg"), tie.querySelector(".badge").textContent,
      $("#add-to-new-label").textContent,
      [...document.querySelectorAll("#add-to-new .add-to-make")].map((b) => [b.textContent, !!b.querySelector("svg")]),
      // + Workshop has the most room, its label clear of its edges.
      (() => { const [t, , w] = [...document.querySelectorAll("#add-to-new .add-to-make")].map((b) => b.getBoundingClientRect().width); return w > t; })(),
      [...document.querySelectorAll("#add-to-new .add-to-make")].every((b) => b.scrollWidth <= b.clientWidth), leakyFields()];`),
  ["Add pose to…", true, "Search ties, plans, workshops",
    [["All", "true"], ["Ties", "false"], ["Plans", "false"], ["Workshops", "false"]],
    "Recent", true, "Tie", "Create new", [["+Tie", true], ["+Plan", true], ["+Workshop", true]], true, true, []]);

  const posesBefore = (await run(`return await ${onTie("Collision test", "poses")};`)).length;
  check("nothing's said while choosing; choosing a tie saves the pose on it at once, the poser staying open", await run(`
    const asking = $("#pose-message").textContent;
    ${row("Collision test")}.click();
    ${waitFor(`$("#pose-message").textContent.startsWith("Pose")`)}
    return [asking, $("#pose-message").textContent, !!document.querySelector("dialog.pose-editor[open]"), !document.querySelector(".add-to-sheet"),
      (await ${onTie("Collision test", "poses")}).length];`),
  ["", "Pose added to tie “Collision test”.", true, true, posesBefore + 1]);

  check("Add to visuals asks too, the tie chosen last first; choosing it adds a picture of the pose as a photo", await run(`
    $("#pose-add-visual").click();
    ${waitFor(`${rows}.length`)}
    const first = ${rows}[0].querySelector(".item-title").textContent;
    ${rows}[0].click();
    ${waitFor(`$("#pose-message").textContent.startsWith("Picture")`)}
    return [first, $("#pose-message").textContent, (await ${onTie("Collision test", "media")}).length];`),
  ["Collision test", "Picture added to tie “Collision test”.", 1]);

  check("…and both kept, Close doesn't ask", await run(`
    $("#pose-cancel").click(); await calm(500);
    return !!document.querySelector("dialog.pose-editor[open]");`), false);

  check("typing a name nothing has offers to make one called that, of each kind; a chip offers only its own", await run(`
    $("#nav-poser").click();
    ${waitFor(`document.querySelector("dialog.pose-editor[open]")`)}
    await calm(500);
    $("#pose-save").click();
    ${waitFor(`${rows}.length`)}
    const search = $("#add-to-search");
    search.value = "Hip harness"; search.dispatchEvent(new Event("input")); await calm(600);
    const all = [$("#add-to-new-label").textContent, [...document.querySelectorAll("#add-to-new .add-to-make")].map((b) => b.textContent),
      $("#add-to-message").textContent];
    $("#add-to-filter-workshop").click(); await wait(100);
    const one = [...document.querySelectorAll("#add-to-new .add-to-make")].map((b) => b.textContent);
    $("#add-to-filter-all").click(); await wait(100);
    return [all, one];`),
  [["Create “Hip harness” as a new…", ["+Tie", "+Plan", "+Workshop"], "Nothing matches."], ["+Workshop"]]);

  check("+ Tie opens the tie form over the poser: named, the pose in its visuals, and Not saved yet at the top", await run(`
    $("#add-to-new-tie").click();
    ${waitFor(`document.querySelector("#tie-visuals .visual-pose")`)}
    return [$("#tie-title").value, document.querySelectorAll("#tie-visuals .visual-pose").length, $("#tie-form").firstElementChild.className,
      $("#tie-form-unsaved").textContent, !!document.querySelector("dialog.pose-editor[open]")];`),
  ["Hip harness", 1, "unsaved-bar", "Not saved yet. Save this tie to keep the pose.", true]);

  check("closing it asks first, even with nothing else changed", await run(`
    $("#tie-close").click(); await calm(400);
    const asked = [${topDialog}.querySelector("h2").textContent, !!(${buttonIn})("Discard tie")];
    (${buttonIn})("Keep editing").click(); await calm(300);
    return [...asked, !!$("#tie-form")];`), ["Discard this new tie?", true, true]);

  check("saving it saves the pose with it, back in the poser; next time the new tie is first", await run(`
    set("#tie-tie_type", "floor");
    $("#tie-save").click();
    ${waitFor(`!document.querySelector("#tie-form") && $("#pose-message").textContent`)}
    const said = $("#pose-message").textContent;
    const poses = (await ${onTie("Hip harness", "poses")})?.length;
    $("#pose-save").click();
    ${waitFor(`${rows}.length`)}
    const first = ${rows}[0].querySelector(".item-title").textContent;
    // A phone's screen, short: the sheet fits it, the list scrolling under
    // the new ones' bar, pinned to the bottom; ✕ top right closes it.
    const sheet = $(".add-to-sheet"), box = sheet.getBoundingClientRect(), foot = $("#add-to-foot").getBoundingClientRect();
    const close = $("#add-to-close").getBoundingClientRect(), head = $(".add-to-head").getBoundingClientRect();
    const scroll = $("#add-to-scroll");
    // Filtered to few, it stays where it was, as tall.
    $("#add-to-filter-workshop").click(); await calm(200);
    const filtered = sheet.getBoundingClientRect();
    $("#add-to-filter-all").click(); await calm(200);
    const layout = [Math.abs(box.height - (innerHeight - 32)) < 2, filtered.top === box.top && filtered.height === box.height,
      Math.abs(box.bottom - foot.bottom) < 2, getComputedStyle($("#add-to-foot")).position,
      getComputedStyle(scroll).overflowY, Math.abs(head.right - close.right) < 2, !!$(".add-to-sheet .dialog-cancel"),
      $("#add-to-close").getAttribute("aria-label")];
    $("#add-to-close").click(); await calm(300);
    const closed = !document.querySelector(".add-to-sheet");
    $("#pose-cancel").click(); await calm(500);
    return [said, poses, first, layout, closed, !!document.querySelector("dialog.pose-editor[open]")];`),
  ["Saved on the new tie.", 1, "Hip harness", [true, true, true, "sticky", "auto", true, false, "Close"], true, false]);

  check("+ Plan from Add to visuals opens the plan form over the poser: named, the picture in its visuals, Not saved yet", await run(`
    $("#nav-poser").click();
    ${waitFor(`document.querySelector("dialog.pose-editor[open]")`)}
    await calm(500);
    $("#pose-add-visual").click();
    ${waitFor(`${rows}.length`)}
    const search = $("#add-to-search");
    search.value = "Ladder plan"; search.dispatchEvent(new Event("input")); await calm(600);
    $("#add-to-new-plan").click();
    ${waitFor(`document.querySelector("#plan-visuals .visual-photo")`)}
    return [$("#plan-title").value, document.querySelectorAll("#plan-visuals .visual-photo").length,
      $("#plan-form-unsaved").textContent, !!document.querySelector("dialog.pose-editor[open]"), location.pathname];`),
  ["Ladder plan", 1, "Not saved yet. Save this plan to keep the picture of the pose.", true, "/"]);

  check("saving it saves the picture with it, back in the poser, still open", await run(`
    $("#plan-save").click();
    ${waitFor(`!document.querySelector("#plan-dialog") && $("#pose-message").textContent`)}
    const said = $("#pose-message").textContent;
    const plan = (await store.listItems("plans", "false")).find((p) => p.title === "Ladder plan");
    const media = plan ? await store.listMedia({ plan_id: plan.id }) : null;
    const open = !!document.querySelector("dialog.pose-editor[open]");
    $("#pose-cancel").click(); await calm(500);
    return [said, media?.length, open, !!document.querySelector("dialog.pose-editor[open]")];`),
  ["Saved on the new plan.", 1, true, false]);
}

/**
 * A see-saw rope and a cinch, tapped on a pose made through the API (so
 * where its ropes are on the view is known): arms out to the sides under a
 * ring, a see-saw from wrist to wrist over it, and uplines from each elbow.
 * @param {{ tap: (fx: number, fy: number) => Promise<void>, slide: (id: string, value: number) => string, topDialog: string }} helpers
 */
async function ropes({ tap, slide, topDialog }) {
  // Fixed waits here, not calm(): a tap on a rope picks from the view as
  // last drawn, and the waits give headless Chrome's slow 3D drawing time
  // to catch up (with calm() these steps sometimes tapped the old view).
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
    const tie = (await store.findTies({}))
      .ties.find((t) => t.title === "Rope test");
    return (await store.listPoses({ tie_id: tie.id }))[0];
  })()`;
  await run(`
    const tie = await store.saveTie(null, { tie_type: "suspension", tie_date: "2026-10-02", title: "Rope test" });
    await store.addPose({ tie_id: tie }, { data: ${JSON.stringify(seeded)}, caption: null });`);
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
  // The viewer may still say "Pose saved." from the last save: wait for
  // this one's "Saving…" first, then for it to finish.
  const savePose = `$("#pose-save").click();
    for (let i = 0; i < 50 && !/Saving/.test(${topDialog}.textContent); i++) await wait(50);
    for (let i = 0; i < 100 && !/Pose saved|Couldn't/.test(${topDialog}.textContent); i++) await wait(100);`;

  await run(`[...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Rope test").click(); await wait(1500);
    $("#tie-visuals .visual-pose .photo-thumb").click(); await wait(800); ${editPose}
    $("#pose-mode-rope").click(); await wait(300);`);
  await tapRope(stored, 0, 0, 0.5);
  check("tapping a rope gives its own panel: Rope selected, Runs free (ticked: it's a see-saw) and ✕ in its heading, then Cinch and Add rope side by side, and Start ◀ ▶ End (where the ring sits along it), not slack", await run(`
    const seesaw = $("#pose-seesaw");
    const actions = $("#pose-cinch-start").parentElement.getBoundingClientRect();
    const head = [...$(".pose-chosen-head").children].map((c) => c.id || c.querySelector("input")?.id || c.className);
    return [$("#pose-chosen-title").textContent, head, $(".pose-rope-tools-rows").hidden,
      seesaw?.checked, seesaw?.parentElement.textContent, seesaw?.parentElement.title,
      $("#pose-cinch-start").textContent, $("#pose-added-start").textContent, !!$("#pose-along-start"),
      Math.round($("#pose-cinch-start").getBoundingClientRect().left) === Math.round(actions.left),
      Math.round($("#pose-added-start").getBoundingClientRect().right) === Math.round(actions.right),
      $("#pose-rope-hint").textContent, $("#pose-view-hint").textContent, !!$("#pose-slack"),
      $("label[for=pose-seesaw-start]")?.textContent, Number($("#pose-seesaw-start")?.min) > 0, leakyFields()];`),
  ["Rope selected", ["pose-chosen-dot ink-red", "pose-chosen-title", "pose-seesaw", "pose-rope-letgo"], true, true, "Runs free",
    "Runs free over the ring: pulling one end moves the other", "Cinch", "Add rope", false, true, true,
    "Drag a white dot to move that point, or tap it to take it out. Cinch and Add rope start from the black dot.", "Tap anywhere else to let it go", false,
    "Start ◀ ▶ End", true, []]);
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
  check("Cinch, another upline, then Finish ties a cinch, taut, with Move the body ticked; Finish with one point says what's missing", [cinchHint, await run(`
    const tapped = $("#pose-rope-hint").textContent;
    $("#pose-finish-rope").click(); await wait(300);
    const length = $("#pose-cinch-length");
    return [tapped, $("#pose-rope-note").textContent, length.value === length.max, Number(length.max) > 10, $("#pose-cinch-body").checked];`)],
  ["Cinch: 1 point. Tap uplines, ropes or the body to tie it through, then Finish.",
    ["Cinch: 2 points. Tap uplines, ropes or the body to tie it through, then Finish.", "Cinch tied. Shorten it to pull the upline aside.", true, true, true]]);
  check("a cinch chosen: Cinch pressed, Slide and Add rope dimmed, Move the body in its heading, its length in the box", await run(`
    return [$("#pose-cinch-start").getAttribute("aria-pressed"), $("#pose-added-start").disabled,
      $("#pose-cinch-body").closest(".pose-chosen-head") !== null, $("#pose-cinch-length").closest(".pose-setting-box.active") !== null,
      $("label[for=pose-cinch-length]").textContent, $("#pose-rope-hint").textContent];`),
  ["true", true, true, true, "Length (cm)", "Shorten the cinch to pull the upline aside. Tap Cinch again when you're done."]);
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
  check("Add rope starts a rope at the dot, laid as any rope, ended with Finish", [addedHint, await run(`
    for (let i = 0; i < 50 && !$("#pose-rope-hint").textContent.includes("2 points"); i++) await wait(100);
    const laid = $("#pose-rope-hint").textContent;
    $("#pose-finish-rope").click(); await wait(300);
    return [laid, $("#pose-finish-rope").disabled];`)],
  [["Added rope: 1 point. Keep tapping, then Finish.", false], ["Added rope: 2 points. Keep tapping, then Finish.", true]]);
  // The right upline above its two bends (the cinches), toward the ring.
  await tapRope(bridged, 2, 2, 0.5);
  // An upline has a Length: 30 cm more lowers the arm it's tied to as far
  // as it goes, and the rest is slack.
  check("…an upline's Length raised lowers the arm on it, the rest slack, saved with the pose", await run(`
    if (!$("#pose-length") || $("#pose-slack")) return ["no length slider", $("#pose-rope-hint").textContent];
    const before = JSON.stringify((await ${tiePose}).data.joints);
    { const el = $("#pose-length"); el.value = String(Number(el.value) + 30); el.dispatchEvent(new Event("input")); el.dispatchEvent(new Event("change")); await calm(200); }
    ${savePose}
    const saved = (await ${tiePose}).data;
    const slack = saved.ropes[2].k ?? 0;
    return [saved.ropes.length, saved.ropes[5].p[0].slice(0, 2), saved.ropes[5].p.length, slack > 0 && slack < 30, JSON.stringify(saved.joints) !== before];`),
  [6, ["rope", 2], 2, true, true]);

  // On a bamboo in place of the ring (the uplines move to its middle).
  const onBamboo = setHardpoint(readPose(await run(`return (await ${tiePose}).data;`)), "bamboo");
  await run(`${editPose} $("#pose-mode-rope").click(); await wait(300); $("#pose-bamboo").click(); await wait(500);`);
  await sleep(300);
  // Above its three bends (the cinches), toward the bamboo.
  const [fx, fy] = await spot(onBamboo, 1, 3, 0.5);
  const across = await run(`return $("#pose-view").getBoundingClientRect().width;`);
  // A finger's width to one side of the upline, not on it.
  await tap(fx + 12 / across, fy);
  check("a tap beside an upline still chooses it; tied to a bamboo, it has Slide between Cinch and Add rope", await run(`
    const at = (id) => $(id).getBoundingClientRect();
    return [!!$("#pose-cinch-start"), $("#pose-along-start")?.textContent, $("#pose-along-start")?.parentElement === $("#pose-cinch-start")?.parentElement,
      at("#pose-cinch-start").right < at("#pose-along-start").left && at("#pose-along-start").right < at("#pose-added-start").left];`),
  [true, "Slide", true, true]);
  check("Slide puts its position in the box in place of the slack, sliding the upline along the bamboo; tapping Slide again ends it", await run(`
    $("#pose-along-start").click(); await wait(300);
    const labels = [...document.querySelectorAll("#pose-rope-options .pose-setting-box label")].map((l) => l.textContent);
    const pressed = $("#pose-along-start").getAttribute("aria-pressed");
    const range = [$("#pose-along-bamboo").min, $("#pose-along-bamboo").max];
    ${slide("pose-along-bamboo", -40)}
    $("#pose-along-bamboo-down").click(); await wait(200);
    const value = $("#pose-along-bamboo").value;
    $("#pose-along-start").click(); await wait(200);
    const back = [!!$("#pose-along-bamboo"), !!$("#pose-length")];
    ${savePose}
    const saved = (await ${tiePose}).data;
    return [labels, pressed, range, value, back, saved.ropes[1].p.at(-1), saved.ropes[2].p.at(-1), saved.ropes[3].l > 0];`),
  [["Position (cm)"], "true", ["-76", "76"], "-41", [false, true], ["bamboo", -410, 0, 0], ["bamboo", 0, 0, 0], true]);
}

/**
 * Ropes round the body only (no hardpoint): two wraps across the front,
 * one over the chest and one over the belly. Each has a Length (two
 * points); cinched together from the first, Move the body bends the trunk
 * to bring them closer.
 * @param {{ tap: (fx: number, fy: number) => Promise<void>, topDialog: string }} helpers
 */
async function bodyCinch({ tap, topDialog }) {
  const base = {
    v: 1, joints: {}, body: [0, 0, 0], lift: 99, shift: [0, 0], camera: [0, 8, 380, 110, 0, 0], ring: null, bamboo: null, hashira: null, ropes: [],
  };
  // Each wrap straight across, 30 cm in front of its bone (toward the
  // camera): a straight line across the front of the body would be inside
  // it, so the view would show the body over it.
  const seeded = await run(`
    const { makeSkeleton, posed, onBone, toBone } = await import("/js/pose-skeleton.js");
    const { readPose } = await import("/js/pose-format.js");
    const data = readPose(${JSON.stringify(base)});
    const skeleton = makeSkeleton(); posed(skeleton, data);
    const wrap = (bone, c) => {
      const at = onBone(skeleton, bone);
      const side = (dx) => [bone, ...toBone(skeleton, bone, at.clone().set(at.x + dx, at.y, at.z + 30))];
      return { c, w: 3, p: [side(-15), side(15)] };
    };
    // With its shape, so the poser opens it as it is (one without is an older pose, its ropes moved).
    return { ...${JSON.stringify(base)}, shape: data.shape, ropes: [wrap("chest", "red"), wrap("spine", "blue")] };`);
  const tiePose = `(async () => {
    const tie = (await store.findTies({}))
      .ties.find((t) => t.title === "Body cinch test");
    return (await store.listPoses({ tie_id: tie.id }))[0];
  })()`;
  await run(`
    const tie = await store.saveTie(null, { tie_type: "floor", tie_date: "2026-10-04", title: "Body cinch test" });
    await store.addPose({ tie_id: tie }, { data: ${JSON.stringify(seeded)}, caption: null });`);
  const stored = await run(`return (await ${tiePose}).data;`);
  await go("/");
  await run(`[...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Body cinch test").click(); await wait(1500);
    $("#tie-visuals .visual-pose .photo-thumb").click(); await wait(800); $("#tie-pose-edit").click();
    for (let i = 0; i < 100 && !document.querySelector("dialog.pose-editor[open]"); i++) await wait(100);
    await wait(500); $("#pose-mode-rope").click(); await wait(300);`);
  /** Taps a rope halfway along, where the view shows it. @param {number} rope */
  const tapRope = async (rope) => {
    await sleep(300);
    const [fx, fy] = await run(`
      let last = ""; for (let i = 0; i < 30; i++) {
        const r = $("#pose-view").getBoundingClientRect(), now = r.width + "x" + r.height;
        if (now === last) break; last = now; await wait(120); }
      const three = await import("/js/vendor/three.js");
      const { makeSkeleton, posed } = await import("/js/pose-skeleton.js");
      const { ropeLine } = await import("/js/pose-cinch.js");
      const data = ${JSON.stringify(stored)};
      const skeleton = makeSkeleton(); posed(skeleton, data);
      const line = ropeLine(skeleton, data, ${rope});
      const point = line[0].clone().lerp(line[1], 0.5);
      const r = $("#pose-view").getBoundingClientRect();
      const camera = new three.PerspectiveCamera(38, r.width / r.height, 5, 5000);
      const [yaw, pitch, distance, height] = data.camera;
      const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
      camera.position.set(Math.sin(y) * Math.cos(p) * distance, height + Math.sin(p) * distance, Math.cos(y) * Math.cos(p) * distance);
      camera.lookAt(0, height, 0);
      camera.updateMatrixWorld();
      const at = point.project(camera);
      return [(at.x + 1) / 2, (1 - at.y) / 2];`);
    await tap(fx, fy);
  };
  await tapRope(0);
  check("a rope round the body, with no upline anywhere, has Cinch as well as Add rope, and a Length from 0 to twice its own", await run(`
    const length = $("#pose-length");
    return [$("#pose-chosen-title")?.textContent, $("#pose-cinch-start")?.textContent, $("#pose-added-start")?.textContent,
      !!$("#pose-slack"), length?.min, Number(length?.max) === 2 * Number(length?.value), Number(length?.value) > 20];`),
  ["Rope selected", "Cinch", "Add rope", false, "0", true, true]);
  check("raising its Length gives it slack, the body staying put", await run(`
    const el = $("#pose-length"), was = Number(el.value);
    el.value = String(was + 25); el.dispatchEvent(new Event("input")); el.dispatchEvent(new Event("change")); await wait(400);
    return [Number($("#pose-length").value) === was + 25, $("#pose-length").max === String(2 * was)];`),
  [true, true]);
  // Back to taut.
  await run(`{ const el = $("#pose-length"); el.value = String(Number(el.max) / 2); el.dispatchEvent(new Event("input")); el.dispatchEvent(new Event("change")); await wait(400); }`);
  await run(`$("#pose-cinch-start").click(); await wait(200);`);
  await tapRope(1);
  check("Cinch to the other wrap ties it, with Move the body ticked, to draw them together", await run(`
    $("#pose-finish-rope").click(); await wait(300);
    const length = $("#pose-cinch-length");
    return [$("#pose-rope-note").textContent, $("#pose-cinch-body")?.checked, length?.value === length?.max, $("#pose-rope-hint").textContent];`),
  ["Cinch tied. Shorten it to draw them together.", true, true,
    "Shorten the cinch to draw them together. Tap Cinch again when you're done."]);
  check("shortening it bends the body to bring the wraps together, and is saved with the pose; the body's place stays", await run(`
    const max = Number($("#pose-cinch-length").max);
    { const el = $("#pose-cinch-length"); el.value = String(Math.floor(max / 2)); el.dispatchEvent(new Event("input")); el.dispatchEvent(new Event("change")); await wait(500); }
    $("#pose-save").click();
    for (let i = 0; i < 100 && !/Pose saved|Couldn't/.test(${topDialog}.textContent); i++) await wait(100);
    const saved = (await ${tiePose}).data;
    const cinch = saved.ropes[2];
    const bent = ["spine", "chest"].some((j) => (saved.joints[j] ?? [0, 0, 0]).some((a) => a !== 0));
    return [cinch?.l === Math.floor(max / 2), cinch?.p.map((p) => [p[0], p[1], p[2]]), JSON.stringify(saved.body), saved.lift, bent];`),
  [true, [["rope", 0, 0], ["rope", 1, 0]], "[0,0,0]", 99, true]);
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
    const tie = await store.saveTie(null, { tie_type: "floor", tie_date: "2026-10-03", title: "Collision test" });
    await store.addPose({ tie_id: tie }, { data: ${JSON.stringify(seeded)}, caption: null });`);
  await go("/");
  await run(`[...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Collision test").click(); await calm(1500);
    $("#tie-visuals .visual-pose .photo-thumb").click(); await calm(800); $("#tie-pose-edit").click();
    for (let i = 0; i < 100 && !document.querySelector("dialog.pose-editor[open]"); i++) await wait(100);
    await calm(500);`);
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
    const box = $("#pose-allow-collisions"); box.click(); await calm(800);
    const asked = [${topDialog}.querySelector("h2")?.textContent, !!(${buttonIn})("Leave them")];
    (${buttonIn})("Fix them now").click(); await calm(800);
    const fixed = [$("#pose-message").textContent, $("#pose-undo").disabled];
    $("#pose-undo").click(); await calm(300);
    return [asked, fixed, $("#pose-l_elbow-0").value, box.checked];`),
  [["Fix the collisions?", true], ["Fixed: the body parts are back within reach and apart.", false], "150", false]);
  check("leaving them changes nothing; a move made unticked is settled", await run(`
    const box = $("#pose-allow-collisions"); box.click(); await calm(200); box.click(); await calm(800);
    (${buttonIn})("Leave them").click(); await calm(500);
    const left = $("#pose-l_elbow-0").value;
    ${slide("pose-l_elbow-0", 0)}
    ${slide("pose-l_elbow-0", 150)}
    return [left, Number($("#pose-l_elbow-0").value) < 150];`), ["150", true]);
  // Ticked again for the next time the poser opens, as it is by default.
  await run(`$("#pose-allow-collisions").click(); await calm(200); $("#pose-cancel").click(); await calm(500);
    (${buttonIn})("Discard changes")?.click(); await calm(500);`);
}
