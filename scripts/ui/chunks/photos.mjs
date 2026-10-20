// The walkthrough's photos chunk. Photos on ties and plans: prepared and sealed on the device, ordered, captioned, deleted.

import { check, freshAccount, go, run } from "../harness.mjs";

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
    await wait(300);
    for (let i = 0; i < 100 && /Preparing|Uploading/.test($("#${prefix}-photos-message").textContent); i++) await wait(100);
    await wait(500);
    return [new TextDecoder().decode(await file.arrayBuffer()).includes("SECRET-GPS"),
      document.querySelectorAll("#${prefix}-photos .photo-tile img").length, $("#${prefix}-photos-message").textContent];`);
  await run(`$(".nav-add").click(); await wait(600); set("#tie-title", "Photo test"); set("#tie-tie_type", "floor");`);
  check("a new tie's photo is prepared and waits for the tie to be saved",
    await pickPhoto("tie", 3000, 1000, "camera.jpg"), [true, 1, ""]);
  check("…and is uploaded when it's saved, counted on the card", await run(`
    $("#tie-save").click(); await wait(2500); await settle();
    const c = [...document.querySelectorAll(".tie-card")].find((x) => x.querySelector(".tie-title").innerText === "Photo test");
    return [!!document.querySelector("dialog"), c?.querySelector(".tie-photos")?.innerText ?? null];`), [false, "1 photo"]);
  check("the server only has it encrypted", await run(`
    const tie = (await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json())
      .ties.find((t) => t.title === "Photo test");
    const [photo] = await (await fetch("/api/media?tie_id=" + tie.id)).json();
    const sealed = new Uint8Array(await (await fetch("/api/media/" + photo.id + "/full")).arrayBuffer());
    const text = new TextDecoder("latin1").decode(sealed);
    return [photo.mime, sealed[0] === 0xff && sealed[1] === 0xd8, text.includes("SECRET-GPS"), text.includes("Exif"), text.includes("WEBP")];`),
    ["image/webp", false, false, false, false]);
  check("opened on the device: shrunk, with no metadata left", await run(`
    [...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Photo test").click(); await wait(1500);
    $("#tie-photos .photo-thumb").click(); await wait(1500);
    const img = $("dialog[open] .photo-full");
    // The bytes shown, read through the app (the CSP's connect-src keeps
    // fetch off blob: URLs).
    const tie = (await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json())
      .ties.find((t) => t.title === "Photo test");
    const [photo] = await (await fetch("/api/media?tie_id=" + tie.id)).json();
    const bytes = new Uint8Array(await (await import("/js/vault.js")).openPhoto(photo.id, "full"));
    const text = new TextDecoder("latin1").decode(bytes);
    return [img.src.startsWith("blob:"), img.naturalWidth, img.naturalHeight, text.startsWith("RIFF") && text.slice(8, 12) === "WEBP",
      text.includes("SECRET-GPS"), text.includes("Exif"), bytes.length < 500 * 1024, $("#tie-photo-earlier").disabled, leakyFields()];`),
    [true, 2048, 683, true, false, false, true, true, []]);
  check("a caption is saved encrypted and shown under the thumbnail", await run(`
    set("#tie-photo-caption", "  Front view  "); $("#tie-photo-save-caption").click(); await wait(1000);
    const shown = $("#tie-photos figcaption")?.textContent;
    [...document.querySelectorAll("dialog[open]")].pop().querySelector(".dialog-cancel").click(); await wait(300);
    const tie = (await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json())
      .ties.find((t) => t.title === "Photo test");
    const [photo] = await (await fetch("/api/media?tie_id=" + tie.id)).json();
    return [shown, /^e1\\./.test(photo.caption), photo.caption.includes("Front")];`), ["Front view", true, false]);
  check("on a saved tie, a photo uploads straight away",
    (await pickPhoto("tie", 400, 600, "second.jpg")).slice(1), [2, ""]);
  check("…moved earlier, the new order is saved", await run(`
    document.querySelectorAll("#tie-photos .photo-thumb")[1].click(); await wait(1200);
    $("#tie-photo-earlier").click(); await wait(800);
    const shown = [...document.querySelectorAll("#tie-photos .photo-tile")].map((t) => t.querySelector("figcaption")?.textContent ?? "");
    [...document.querySelectorAll("dialog[open]")].pop().querySelector(".dialog-cancel").click(); await wait(300);
    const tie = (await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json())
      .ties.find((t) => t.title === "Photo test");
    const listed = await (await fetch("/api/media?tie_id=" + tie.id)).json();
    return [shown, listed.map((p) => p.caption === null)];`), [["", "Front view"], [true, false]]);
  check("locking revokes the photos shown", await run(`
    const src = $("#tie-photos .photo-thumb img").src;
    const loads = (url) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(true); i.onerror = () => resolve(false); i.src = url; });
    const before = await loads(src);
    (await import("/js/vault.js")).lock(); await wait(500);
    return [before, await loads(src), [...document.querySelectorAll("img")].some((i) => i.src.startsWith("blob:"))];`), [true, false, false]);
  await go("/");
  check("deleting a photo asks first, then removes it", await run(`
    [...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Photo test").click(); await wait(1500);
    $("#tie-photos .photo-thumb").click(); await wait(1200);
    $("#tie-photo-delete").click(); await wait(300);
    const asked = [...document.querySelectorAll("dialog")].pop().querySelector("h2").textContent;
    [...[...document.querySelectorAll("dialog")].pop().querySelectorAll("button")].find((b) => b.textContent === "Delete photo").click(); await wait(1000);
    return [asked, document.querySelectorAll("#tie-photos .photo-tile").length];`), ["Delete this photo?", 1]);
  check("…and deleting the tie deletes the rest", await run(`
    const tie = (await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json())
      .ties.find((t) => t.title === "Photo test");
    const [photo] = await (await fetch("/api/media?tie_id=" + tie.id)).json();
    $("#tie-delete").click(); await wait(300);
    [...document.querySelectorAll("dialog[open] button")].filter((b) => b.textContent === "Delete tie").pop().click(); await wait(1000);
    return [(await fetch("/api/media/" + photo.id + "/thumb")).status, $("#tie-count").textContent];`), [404, "Showing 0 of 0 ties"]);

  await go("/plans");
  await run(`$("#add-plan").click(); await wait(300); set("#plan-title", "Photo plan");`);
  check("a new plan's photo waits for the plan to be saved", await pickPhoto("plan", 800, 600, "plan.jpg"), [true, 1, ""]);
  check("…is uploaded when it's saved, closing the form, and counted in the list", await run(`
    await submit(); await wait(2000);
    return [$("#plan-dialog").open, items().find((i) => i.startsWith("Photo plan"))?.includes("1 photo") ?? false];`),
    [false, true]);
  check("editing the plan shows its photo", await run(`
    await clickIn("Photo plan", "Edit"); await wait(1500);
    const shown = document.querySelectorAll("#plan-photos .photo-tile img").length;
    const plan = (await (await fetch("/api/plans?archived=false")).json()).find((p) => p.title === "Photo plan");
    const [photo] = await (await fetch("/api/media?plan_id=" + plan.id)).json();
    const res = await fetch("/api/plans/" + plan.id + "?linked_ties=keep", { method: "DELETE" });
    $("[data-cancel-edit]").click(); await wait(200);
    return [shown, photo.mime, res.status, (await fetch("/api/media/" + photo.id + "/thumb")).status];`),
    [1, "image/webp", 204, 404]);
}
