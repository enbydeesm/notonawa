// The walkthrough's locations chunk. The Locations page, and the default location.

import { check, freshAccount, go, run } from "../harness.mjs";

export default async function () {
  await freshAccount();
  console.log("Locations");
  await go("/locations");
  check("add locations (one archived now)", await run(`
    set("#name", "Studio"); set("#maps_url", "https://maps.app.goo.gl/abc"); await submit();
    set("#name", "Hotel"); set("[name=archive_now]", true); await submit();
    set("#name", "Old flat"); await submit();
    return [titles(), [...document.querySelectorAll("#list a")].map((a) => a.href)];`),
    [["Old flat", "Studio"], ["https://maps.app.goo.gl/abc"]]);
  check("a Maps link fills in editable coordinates", await run(`
    const link = $("#maps_url"); link.value = "https://www.google.com/maps/place/Studio/@51.5,-0.12,17z/data=!4m2!3m1!8m2!3d51.51!4d-0.13";
    link.dispatchEvent(new Event("input")); await wait(1200);
    const filled = [$("#latitude").value, $("#longitude").value, $("#maps-hint").textContent];
    $("form").reset(); return [filled, $("#latitude").value, $("#maps-hint").textContent];`),
    [["51.51", "-0.13", "Coordinates filled in from the link."], "", "Paste a link to fill in the latitude and longitude."]);
  check("'Archive now' is hidden while editing", await run(`await clickIn("Studio", "Edit"); const hidden = $("[data-add-only]").hidden; $("[data-cancel-edit]").click(); return hidden;`), true);
  check("one-off is in the archived list", await run(`set("#show-archived", true); await wait(600); return titles();`), ["Hotel"]);
  await go("/locations");
  check("'Default on new ties' sits on the Name row, at the right, and isn't offered when archiving now", await run(`
    const flag = $("#default-flag"); const mid = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    const placed = [Math.abs(mid(flag) - mid($("label[for=name]"))) < 3, flag.getBoundingClientRect().right > $("#name").getBoundingClientRect().right - 4];
    set("#is_default", true); set("[name=archive_now]", true); const archiving = [flag.hidden, $("#is_default").checked];
    set("[name=archive_now]", false); const back = flag.hidden;
    return [placed, archiving, back];`), [[true, true], [true, false], false]);
  check("one location is the default, kept at the top; ticking another asks to replace it, and Cancel unticks it", await run(`
    const dialogButton = (text) => [...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent === text);
    await clickIn("Studio", "Edit"); $("#is_default").click(); await wait(400); const noPrompt = $("dialog[open]") === null; await submit();
    const pinned = titles();
    await clickIn("Old flat", "Edit"); $("#is_default").click(); await wait(400);
    const prompt = $("dialog[open] h2")?.textContent; dialogButton("Cancel").click(); await wait(200);
    const cancelled = $("#is_default").checked;
    $("#is_default").click(); await wait(400); dialogButton("Replace").click(); await wait(200);
    const kept = $("#is_default").checked; await submit();
    const stored = (await (await fetch("/api/locations?archived=false")).json()).filter((l) => l.is_default).map((l) => l.name);
    return [noPrompt, pinned, prompt, cancelled, kept, titles(), stored];`),
    [true, ["StudioDefault", "Old flat"], "Replace Studio as your default location?", false, true, ["Old flatDefault", "Studio"], ["Old flat"]]);
  check("locations: search and sort too", await run(`
    const box = $(".list-search"); box.value = "stu"; box.dispatchEvent(new Event("input")); await wait(50); const found = titles();
    box.value = ""; box.dispatchEvent(new Event("input")); $(".sort-button[data-sort=name]").click(); await wait(50);
    return [found, titles()];`), [["Studio"], ["Old flatDefault", "Studio"]]);
  check("a new tie starts at the default location; then it's unset again", await run(`
    $(".nav-add").click(); await wait(1200);
    const start = [$("#tie-location").offsetParent !== null, $("#tie-location").value, $("#tie-location-show").hidden];
    $("dialog[open] .dialog-cancel").click(); await wait(300);
    await clickIn("Old flatDefault", "Edit"); $("#is_default").click(); await submit();
    return [start, titles()];`), [[true, "Old flat", true], ["Old flat", "Studio"]]);
}
