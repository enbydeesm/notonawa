// The walkthrough's photos chunk. Photos on ties and plans: prepared and sealed on the device, ordered, captioned, deleted.

import { check, send, freshAccount, go, run, skip } from "../harness.mjs";

export default async function () {
  await freshAccount();
  console.log("Photos");
  await go("/");
  // A JPEG with metadata written into it, as a camera would (an Exif
  // segment holding a made-up GPS note), as if picked in the file dialog.
  // prefix: the form's ("tie" or "plan").
  const pickPhoto = (prefix, width, height, name) => run(`
    const canvas = document.createElement("canvas"); canvas.width = ${width}; canvas.height = ${height};
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#c33"; ctx.fillRect(0, 0, ${width}, ${height});
    ctx.fillStyle = "#33c"; ctx.fillRect(0, 0, ${width} / 2, ${height} / 2);
    const jpeg = new Uint8Array(await (await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9))).arrayBuffer());
    const note = new TextEncoder().encode("Exif\\0\\0SECRET-GPS-48.8584N");
    const app1 = new Uint8Array([0xff, 0xe1, 0, note.length + 2, ...note]);
    const file = new File([jpeg.slice(0, 2), app1, jpeg.slice(2)], ${JSON.stringify(name)}, { type: "image/jpeg" });
    const dt = new DataTransfer(); dt.items.add(file);
    $("#${prefix}-photo-input").files = dt.files; $("#${prefix}-photo-input").dispatchEvent(new Event("change"));
    // Until it's prepared (and uploaded, on a saved tie): up to 10 seconds.
    await calm(300);
    for (let i = 0; i < 100 && /Preparing|Uploading/.test($("#${prefix}-visuals-message").textContent); i++) await wait(100);
    await calm(500);
    return [new TextDecoder().decode(await file.arrayBuffer()).includes("SECRET-GPS"),
      document.querySelectorAll("#${prefix}-visuals .photo-tile img").length, $("#${prefix}-visuals-message").textContent];`);
  await run(`$("#add-tie").click(); await calm(600); set("#tie-title", "Photo test"); set("#tie-tie_type", "floor");`);
  check("a new tie's photo is prepared and waits for the tie to be saved",
    await pickPhoto("tie", 3000, 1000, "camera.jpg"), [true, 1, ""]);
  check("…and is uploaded when it's saved, counted on the card", await run(`
    $("#tie-save").click(); await calm(2500); await settle();
    const c = [...document.querySelectorAll(".tie-card")].find((x) => x.querySelector(".tie-title").innerText === "Photo test");
    return [!!document.querySelector("dialog"), c?.querySelector(".tie-photos")?.innerText ?? null];`), [false, "1 visual"]);
  check("the server only has it encrypted", await run(`
    const tie = (await store.findTies({}))
      .ties.find((t) => t.title === "Photo test");
    const [photo] = await store.listMedia({ tie_id: tie.id });
    const sealed = new Uint8Array(await (await rawPart(photo.id, "full")).arrayBuffer());
    const text = new TextDecoder("latin1").decode(sealed);
    return [photo.mime, sealed[0] === 0xff && sealed[1] === 0xd8, text.includes("SECRET-GPS"), text.includes("Exif"), text.includes("WEBP")];`),
    ["image/webp", false, false, false, false]);
  check("the viewer opens at the photo's size, showing the thumbnail at once, and stays that size once the full one loads", await run(`
    [...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Photo test").click(); await calm(1500);
    $("#tie-visuals .photo-thumb").click();
    const img = $("dialog[open] .photo-full"), dialog = $("dialog[open]");
    const at = () => [Math.round(img.getBoundingClientRect().height), Math.round(dialog.getBoundingClientRect().width)];
    const first = [img.getAttribute("src")?.startsWith("blob:"), img.classList.contains("sized")], before = at();
    await calm(1500);
    const after = at();
    $("#tie-photo-close").click(); await calm(300);
    return [first, before[0] > 50, Math.abs(before[0] - after[0]) < 3, Math.abs(before[1] - after[1]) < 3];`), [[true, true], true, true, true]);
  check("opened on the device: shrunk, with no metadata left", await run(`
    $("#tie-visuals .photo-thumb").click(); await calm(1500);
    const img = $("dialog[open] .photo-full");
    // The bytes shown, read through the app (the CSP's connect-src keeps
    // fetch off blob: URLs).
    const tie = (await store.findTies({}))
      .ties.find((t) => t.title === "Photo test");
    const [photo] = await store.listMedia({ tie_id: tie.id });
    const bytes = new Uint8Array(await store.openMediaPart(photo, "full"));
    const text = new TextDecoder("latin1").decode(bytes);
    return [img.src.startsWith("blob:"), img.naturalWidth, img.naturalHeight, text.startsWith("RIFF") && text.slice(8, 12) === "WEBP",
      text.includes("SECRET-GPS"), text.includes("Exif"), bytes.length < 500 * 1024, $("#tie-photo-earlier").disabled, leakyFields()];`),
    [true, 2048, 683, true, false, false, true, true, []]);
  check("the viewer doesn't put the cursor in the caption, and its ✓ shows only once the caption's changed", await run(`
    const save = $("#tie-photo-save-caption");
    const before = [document.activeElement === $("#tie-photo-caption"), save.disabled, getComputedStyle(save).visibility];
    set("#tie-photo-caption", "x"); const typed = [save.disabled, getComputedStyle(save).visibility];
    set("#tie-photo-caption", ""); const back = save.disabled;
    return [...before, ...typed, back];`),
  [false, true, "hidden", false, "visible", true]);
  check("the viewer: where it is and ✕ on top, a big caption box with its label in the placeholder, then one row of icons", await run(`
    const d = [...document.querySelectorAll("dialog[open]")].pop();
    const caption = $("#tie-photo-caption");
    const tools = [...d.querySelector(".viewer-tools").children].map((el) => el.getAttribute("aria-label") ?? el.className);
    const row = [...d.querySelector(".viewer-tools").children].filter((el) => el.offsetParent).map((el) => { const r = el.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2); });
    return [d.querySelector(".viewer-head").textContent.trim(), !!d.querySelector(".viewer-head [aria-label=Close]"),
      caption.tagName, caption.placeholder, caption.maxLength, caption.getBoundingClientRect().height >= 120, !!d.querySelector("label[for=tie-photo-caption]"),
      tools, new Set(row).size, !!d.querySelector(".dialog-cancel")];`),
  ["Photo: 1 of 1", true, "TEXTAREA", "Visual caption: description of step, notes on position, etc.", 1000, true, false,
    ["Move earlier", "Move later", "tool-divider", "tool-slot", "tool-slot", "Copy to…", "tool-gap", "Delete photo"], 1, false]);
  for (const width of [375, 320]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: true });
    check(`…its icons stay on one row inside the dialog on a ${width}px-wide phone`, await run(`
      await wait(200);
      const d = [...document.querySelectorAll("dialog[open]")].pop(), tools = d.querySelector(".viewer-tools");
      const shown = [...tools.children].map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0);
      const oneRow = Math.max(...shown.map((r) => r.top)) < Math.min(...shown.map((r) => r.bottom));
      return [oneRow, tools.scrollWidth <= tools.clientWidth, Math.min(...[...tools.querySelectorAll("button")].map((b) => b.getBoundingClientRect().width)) >= 30];`),
      [true, true, true]);
  }
  await send("Emulation.clearDeviceMetricsOverride", {});
  check("a caption is saved encrypted and shown under the thumbnail", await run(`
    set("#tie-photo-caption", "  Front view  "); $("#tie-photo-save-caption").click(); await calm(1000);
    const shown = $("#tie-visuals figcaption")?.textContent;
    [...document.querySelectorAll("dialog[open]")].pop().querySelector(".dialog-cancel, [aria-label=Close]").click(); await calm(300);
    const tie = (await store.findTies({}))
      .ties.find((t) => t.title === "Photo test");
    const [photo] = await store.listMedia({ tie_id: tie.id });
    return [shown, !(await plainOnServer("Front view")), photo.caption];`), ["Front view", true, "Front view"]);
  check("on a saved tie, a photo uploads straight away",
    (await pickPhoto("tie", 400, 600, "second.jpg")).slice(1), [2, ""]);
  await run(`await store.saveItem("plans", null, { title: "Copy plan" });`);
  check("Copy to… copies a photo to a plan as a new file, its caption too, leaving the original", await run(`
    $("#tie-visuals .photo-thumb").click(); await calm(1200);
    $("#tie-photo-copy").click(); await calm(1000);
    $("#drawing-copy-plan").click(); await calm(800);
    [...document.querySelectorAll("#drawing-copy-list .copy-target")].find((b) => b.textContent.includes("Copy plan")).click(); await calm(2500);
    const message = $("#tie-viewer-message").textContent;
    [...document.querySelectorAll("dialog[open]")].pop().querySelector("[aria-label=Close]").click(); await calm(300);
    const plan = (await store.listItems("plans", "false")).find((p) => p.title === "Copy plan");
    const [copy] = await store.listMedia({ plan_id: plan.id });
    const tie = (await store.findTies({}))
      .ties.find((t) => t.title === "Photo test");
    const originals = await store.listMedia({ tie_id: tie.id });
    const same = copy && new Uint8Array(await store.openMediaPart(copy, "thumb")).length === new Uint8Array(await store.openMediaPart(originals[0], "thumb")).length;
    return [message, !!copy && !originals.some((o) => o.id === copy.id), copy?.caption, same, originals.length];`),
  ['Copied to "Copy plan".', true, "Front view", true, 2]);
  check("swiping on the viewer goes to the next one and back", await run(`
    $("#tie-visuals .photo-thumb").click(); await calm(1200);
    const swipe = async (dx) => {
      const d = [...document.querySelectorAll("dialog[open]")].pop(), r = d.getBoundingClientRect();
      const at = (x) => ({ bubbles: true, pointerId: 3, isPrimary: true, pointerType: "touch", clientX: x, clientY: r.top + 40 });
      d.dispatchEvent(new PointerEvent("pointerdown", at(r.left + r.width / 2)));
      d.dispatchEvent(new PointerEvent("pointerup", at(r.left + r.width / 2 + dx)));
      await calm(1200);
      return $("#tie-photo-position").textContent;
    };
    const first = $("#tie-photo-position").textContent;
    const next = await swipe(-120);
    const back = await swipe(120);
    const stays = await swipe(120);
    [...document.querySelectorAll("dialog[open]")].pop().querySelector(".dialog-cancel, [aria-label=Close]").click(); await calm(300);
    return [first, next, back, stays, document.querySelectorAll("dialog.photo-viewer").length];`),
  ["Photo: 1 of 2", "Photo: 2 of 2", "Photo: 1 of 2", "Photo: 1 of 2", 0]);
  check("…moved earlier, the new order is saved", await run(`
    document.querySelectorAll("#tie-visuals .photo-thumb")[1].click(); await calm(1200);
    $("#tie-photo-earlier").click(); await calm(800);
    const shown = [...document.querySelectorAll("#tie-visuals .photo-tile")].map((t) => t.querySelector("figcaption")?.textContent ?? "");
    [...document.querySelectorAll("dialog[open]")].pop().querySelector(".dialog-cancel, [aria-label=Close]").click(); await calm(300);
    const tie = (await store.findTies({}))
      .ties.find((t) => t.title === "Photo test");
    const listed = await store.listMedia({ tie_id: tie.id });
    return [shown, listed.map((p) => p.caption === null)];`), [["", "Front view"], [true, false]]);
  // A drag from one tile to another, as pointer events: by mouse, or by
  // finger after holding (holdMs) or not (a swipe, which should scroll).
  const drag = (pointerType, holdMs) => run(`
    const tiles = () => [...document.querySelectorAll("#tie-visuals .photo-tile")];
    const centre = (t) => { const r = t.getBoundingClientRect(); return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; };
    const [a, b] = tiles().map(centre);
    const at = (p, dx = 0) => ({ bubbles: true, cancelable: true, pointerId: 7, pointerType: "${pointerType}", button: 0, clientX: p.clientX + dx, clientY: p.clientY });
    tiles()[0].querySelector(".photo-thumb").dispatchEvent(new PointerEvent("pointerdown", at(a)));
    await wait(${holdMs});
    document.dispatchEvent(new PointerEvent("pointermove", at(a, 20)));
    document.dispatchEvent(new PointerEvent("pointermove", at(b)));
    const marked = tiles()[1].classList.contains("drop-target");
    document.dispatchEvent(new PointerEvent("pointerup", at(b)));
    await calm(800);
    const tie = (await store.findTies({}))
      .ties.find((t) => t.title === "Photo test");
    const listed = await store.listMedia({ tie_id: tie.id });
    return [marked, tiles().map((t) => t.querySelector("figcaption")?.textContent ?? ""), listed.map((p) => p.caption === null),
      document.querySelectorAll("#tie-visuals .dragging, #tie-visuals .drop-target").length];`);
  check("dragging a photo with the mouse moves it, and the order is saved",
    await drag("mouse", 0), [true, ["Front view", ""], [false, true], 0]);
  check("…with a finger after holding it still, too", await drag("touch", 500), [true, ["", "Front view"], [true, false], 0]);
  check("…but a finger moving straight away scrolls instead", await drag("touch", 0), [false, ["", "Front view"], [true, false], 0]);
  check("locking revokes the photos shown", await run(`
    const src = $("#tie-visuals .photo-thumb img").src;
    const loads = (url) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(true); i.onerror = () => resolve(false); i.src = url; });
    const before = await loads(src);
    (await import("/js/vault.js")).lock(); await calm(500);
    return [before, await loads(src), [...document.querySelectorAll("img")].some((i) => i.src.startsWith("blob:"))];`), [true, false, false]);
  await go("/");
  check("deleting a photo asks first, then removes it", await run(`
    [...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Photo test").click(); await calm(1500);
    $("#tie-visuals .photo-thumb").click(); await calm(1200);
    $("#tie-photo-delete").click(); await calm(300);
    const asked = [...document.querySelectorAll("dialog")].pop().querySelector("h2").textContent;
    [...[...document.querySelectorAll("dialog")].pop().querySelectorAll("button")].find((b) => b.textContent === "Delete photo").click(); await calm(1000);
    return [asked, document.querySelectorAll("#tie-visuals .photo-tile").length];`), ["Delete this photo?", 1]);
  check("…and deleting the tie deletes the rest", await run(`
    const tie = (await store.findTies({}))
      .ties.find((t) => t.title === "Photo test");
    const [photo] = await store.listMedia({ tie_id: tie.id });
    $("#tie-delete").click(); await calm(300);
    [...document.querySelectorAll("dialog[open] button")].filter((b) => b.textContent === "Delete tie").pop().click(); await calm(1000);
    return [(await rawPart(photo.id, "thumb")).status, $("#tie-count").textContent];`), [404, "Showing 0 of 0"]);

  await go("/plans");
  await run(`$("#add-plan").click(); await calm(300); set("#plan-title", "Photo plan");`);
  check("a new plan's photo waits for the plan to be saved", await pickPhoto("plan", 800, 600, "plan.jpg"), [true, 1, ""]);
  check("…is uploaded when it's saved, closing the form, and counted in the list", await run(`
    await submit(); await calm(2000);
    return [!!document.querySelector("#plan-dialog[open]"), items().find((i) => i.startsWith("Photo plan"))?.includes("1 visual") ?? false];`),
    [false, true]);
  check("editing the plan shows its photo", await run(`
    await clickIn("Photo plan", "Edit"); await calm(1500);
    const shown = document.querySelectorAll("#plan-visuals .photo-tile img").length;
    const plan = (await store.listItems("plans", "false")).find((p) => p.title === "Photo plan");
    const [photo] = await store.listMedia({ plan_id: plan.id });
    const res = await store.deletePlan(plan.id, "keep").then(() => 204, () => 500);
    $("[data-cancel-edit]").click(); await calm(200);
    return [shown, photo.mime, res, (await rawPart(photo.id, "thumb")).status];`),
    [1, "image/webp", 204, 404]);

  // Videos need Chrome to encode AAC sound, which Chrome on Claude's cloud
  // machine (Linux) can't. There, and only there, they're skipped and said
  // so, not failed; anywhere else (a Mac) they always run.
  const aac = await run(`return (await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported;`);
  if (!aac && process.env.CLAUDE_CODE_REMOTE === "true") {
    skip("videos", "Chrome on Claude's cloud machine can't encode AAC sound");
    return;
  }

  // Videos. A clip made here as a camera would: an MP4 with sound, its
  // metadata tags and track names holding made-up secrets (made with the
  // app's own copy of mediabunny, as there's no camera here).
  const makeClip = ({ seconds, width, height, fps, sound, rotation = 0, sampleRate = 48000 }) => run(`
    const mb = await import("/js/vendor/mediabunny.js");
    const canvas = new OffscreenCanvas(${width}, ${height}); const ctx = canvas.getContext("2d");
    const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
    const video = new mb.CanvasSource(canvas, { codec: "avc", bitrate: 1e6 });
    output.addVideoTrack(video, { name: "SECRET-DEVICE", frameRate: ${fps}, rotation: ${rotation} });
    const audio = ${sound} ? new mb.AudioBufferSource({ codec: "aac", bitrate: 128000 }) : null;
    if (audio) output.addAudioTrack(audio, { name: "SECRET-MIC" });
    output.setMetadataTags({ title: "SECRET-TITLE", comment: "SECRET-GPS-48.8584N", date: new Date("2020-01-02T03:04:05Z") });
    await output.start();
    for (let i = 0; i < ${seconds * fps}; i++) {
      ctx.fillStyle = i % 2 ? "#c33" : "#33c"; ctx.fillRect(0, 0, ${width}, ${height});
      ctx.fillStyle = "#fff"; ctx.fillRect((i * 10) % ${width}, 0, 8, 8);
      await video.add(i / ${fps}, 1 / ${fps});
    }
    if (audio) {
      const buffer = new AudioBuffer({ length: ${sampleRate} * ${seconds}, numberOfChannels: 2, sampleRate: ${sampleRate} });
      const data = buffer.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.sin(i / 20) * 0.2;
      await audio.add(buffer);
    }
    await output.finalize();
    window.__clip = new File([output.target.buffer], "clip.mp4", { type: "video/mp4" });
    const text = new TextDecoder("latin1").decode(output.target.buffer);
    return ["SECRET-DEVICE", "SECRET-TITLE", "SECRET-GPS"].every((secret) => text.includes(secret));`);
  // Picks the clip in the open tie's Photos section, as the file dialog
  // would, and waits for it to be prepared and uploaded (up to 50 seconds).
  const pickClip = () => run(`
    const dt = new DataTransfer(); dt.items.add(window.__clip);
    $("#tie-photo-input").files = dt.files; $("#tie-photo-input").dispatchEvent(new Event("change"));
    await calm(300);
    for (let i = 0; i < 500 && /Preparing|Uploading/.test($("#tie-visuals-message").textContent); i++) await wait(100);
    await calm(500);
    return [document.querySelectorAll("#tie-visuals .video-badge").length, $("#tie-visuals-message").textContent];`);
  const openVideoTie = `
    [...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Video test").click(); await calm(1500);`;
  const listedVideo = `
    const tie = (await store.findTies({}))
      .ties.find((t) => t.title === "Video test");
    const [video] = await store.listMedia({ tie_id: tie.id });`;

  await go("/");
  check("a camera-like clip holds its secrets before it's added",
    await makeClip({ seconds: 2, width: 1280, height: 720, fps: 30, sound: true }), true);
  await run(`$("#add-tie").click(); await calm(600); set("#tie-title", "Video test"); set("#tie-tie_type", "floor");
    $("#tie-save").click(); await calm(2000); await settle(); ${openVideoTie}`);
  check("the + takes videos, and one added to a saved tie is prepared and uploaded, marked ▶",
    await pickClip(), [1, ""]);
  check("the server only has it encrypted, as an MP4 video", await run(`${listedVideo}
    const sealed = new TextDecoder("latin1").decode(await (await rawPart(video.id, "full")).arrayBuffer());
    return [video.kind, video.mime, sealed.includes("ftyp"), sealed.includes("SECRET")];`), ["video", "video/mp4", false, false]);
  check("opened on the device: 480p with its sound, and none of the clip's metadata", await run(`${listedVideo}
    const bytes = await store.openMediaPart(video, "full");
    const text = new TextDecoder("latin1").decode(bytes);
    const mb = await import("/js/vendor/mediabunny.js");
    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BufferSource(bytes) });
    const track = await input.getPrimaryVideoTrack();
    const sound = await input.getPrimaryAudioTrack();
    const tags = await input.getMetadataTags();
    return [text.slice(4, 8), await track.getDisplayWidth(), await track.getDisplayHeight(), Math.round(await input.computeDuration()),
      await track.getCodec(), await sound?.getCodec(), await track.getName(), await sound?.getName(),
      [tags.title, tags.comment, tags.date].filter(Boolean).length, /SECRET|48\\.8584/.test(text)];`),
    ["ftyp", 854, 480, 2, "avc", "aac", null, null, 0, false]);
  check("the viewer plays it from a blob: URL, with its speeds; 1.5× sets the speed", await run(`
    $("#tie-visuals .photo-thumb").click();
    const video = $("#tie-video");
    for (let i = 0; i < 50 && !(video.src.startsWith("blob:") && video.readyState >= 1); i++) await wait(100);
    const speeds = [...document.querySelectorAll("#tie-video-speeds .speed")];
    speeds.find((b) => b.textContent === "1.5×").click();
    return [video.src.startsWith("blob:"), video.poster.startsWith("blob:"), Math.round(video.duration), speeds.map((b) => b.textContent),
      video.playbackRate, speeds.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent),
      $("#tie-photo-delete").getAttribute("aria-label"), leakyFields()];`),
    [true, true, 2, ["0.25×", "0.5×", "0.75×", "1×", "1.5×", "2×"], 1.5, ["1.5×"], "Delete video", []]);
  check("a phone's upright clip (stored on its side, with a rotation) comes out upright, the rotation drawn in", await run(`
    [...document.querySelectorAll("dialog[open]")].pop().querySelector(".dialog-cancel, [aria-label=Close]").click(); await calm(300);
    return true;`) && await makeClip({ seconds: 1, width: 1280, height: 720, fps: 30, sound: false, rotation: 90 }) && await pickClip()
    && await run(`
    const tie = (await store.findTies({}))
      .ties.find((t) => t.title === "Video test");
    const [, video] = await store.listMedia({ tie_id: tie.id });
    const mb = await import("/js/vendor/mediabunny.js");
    const bytes = await store.openMediaPart(video, "full");
    const track = await new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BufferSource(bytes) }).getPrimaryVideoTrack();
    return [await track.getDisplayWidth(), await track.getDisplayHeight(), await track.getRotation()];`), [480, 854, 0]);
  // A browser that can't encode the sound (as if AudioEncoder refused AAC;
  // a sample rate not checked yet, as the answers are remembered) asks.
  const pickSilent = (answer) => run(`
    window.__realAudioCheck ??= AudioEncoder.isConfigSupported;
    AudioEncoder.isConfigSupported = async (config) => ({ supported: false, config });
    const before = document.querySelectorAll("#tie-visuals .video-badge").length;
    const dt = new DataTransfer(); dt.items.add(window.__clip);
    $("#tie-photo-input").files = dt.files; $("#tie-photo-input").dispatchEvent(new Event("change"));
    const asked = () => [...document.querySelectorAll("dialog[open]")].find((d) => d.querySelector("h2")?.textContent === "Upload without sound?");
    for (let i = 0; i < 100 && !asked(); i++) await wait(100);
    const dialog = asked();
    const text = dialog ? [dialog.querySelector("p").textContent, [...dialog.querySelectorAll("button")].map((b) => b.textContent)] : null;
    [...(dialog?.querySelectorAll("button") ?? [])].find((b) => b.textContent === ${JSON.stringify(answer)})?.click();
    await calm(300);
    for (let i = 0; i < 400 && /Preparing|Uploading/.test($("#tie-visuals-message").textContent); i++) await wait(100);
    await calm(500);
    AudioEncoder.isConfigSupported = window.__realAudioCheck;
    return [text, document.querySelectorAll("#tie-visuals .video-badge").length - before, $("#tie-visuals-message").textContent];`);
  check("when the sound can't be encoded, it asks first; Cancel leaves the clip out",
    await makeClip({ seconds: 1, width: 640, height: 360, fps: 30, sound: true, sampleRate: 44100 }) && await pickSilent("Cancel"),
    [["This browser can't encode the sound in clip.mp4, so it can only be uploaded silent. To keep its sound, add it from the latest Chrome or Safari instead.",
      ["Upload without sound", "Cancel"]], 0, "clip.mp4: Not added, as this browser could only upload it without its sound."]);
  check("…and \"Upload without sound\" uploads it silent", await pickSilent("Upload without sound") && await run(`
    const tie = (await store.findTies({}))
      .ties.find((t) => t.title === "Video test");
    const videos = await store.listMedia({ tie_id: tie.id });
    const mb = await import("/js/vendor/mediabunny.js");
    const bytes = await store.openMediaPart(videos[videos.length - 1], "full");
    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BufferSource(bytes) });
    return [videos.length, !!(await input.getPrimaryVideoTrack()), await input.getPrimaryAudioTrack()];`), [3, true, null]);
  check("locking empties the video too", await run(`
    $("#tie-visuals .photo-thumb").click(); await calm(1500);
    (await import("/js/vault.js")).lock(); await calm(500);
    return [...document.querySelectorAll("video")].some((v) => v.src.startsWith("blob:") || v.poster.startsWith("blob:"));`), false);
  await go("/");
  check("a clip over 3 minutes is refused, saying how long it is", await run(`${openVideoTie}
    return true;`) && await makeClip({ seconds: 181, width: 32, height: 32, fps: 1, sound: false }) && await pickClip(),
  [3, "clip.mp4: That video is 3:01 long. Trim it to under 3 minutes and try again."]);
  check("deleting the tie deletes its video", await run(`${listedVideo}
    $("#tie-delete").click(); await calm(300);
    [...document.querySelectorAll("dialog[open] button")].filter((b) => b.textContent === "Delete tie").pop().click(); await calm(1000);
    return (await rawPart(video.id, "thumb")).status;`), 404);
}
