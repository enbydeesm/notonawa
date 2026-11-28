// The walkthrough's locations chunk. The Locations page, and the default location.

import { check, freshAccount, go, run } from "../harness.mjs";

export default async function () {
  await freshAccount();
  console.log("Locations");
  await go("/locations");
  check("add locations from the + card, in a dialog (one archived now)", await run(`
    const add = $("#add-location"), addCard = add.closest(".card");
    const plusFirst = [addCard.firstElementChild === add, $("#locations-search").previousElementSibling === addCard];
    add.click(); await calm(300);
    const adding = [$("#location-dialog").open, $("#location-form-heading").textContent, $("#location-dialog button[type=submit]").textContent,
      headerIcons("#location-dialog")];
    set("#location-name", "Studio"); set("#location-maps_url", "https://maps.app.goo.gl/abc");
    set("#location-city", "Seattle"); set("#location-state_province", "WA"); set("#location-country", "USA"); await submit();
    const closed = !$("#location-dialog").open;
    add.click(); await calm(300); set("#location-name", "Hotel"); set("[name=archive_now]", true); await submit();
    add.click(); await calm(300); set("#location-name", "Old flat"); set("#location-country", "Canada"); await submit();
    return [plusFirst, adding, closed, items(), [...document.querySelectorAll("#list a")].map((a) => a.href), leakyFields()];`),
    [[true, true], [true, "Add a location", "Add location", ["Close"]], true,
      ["Old flat | Canada", "Studio | Seattle, WA, USA | Open in Maps"], ["https://maps.app.goo.gl/abc"], []]);
  check("a card's Open in Maps sits on its place's row, at the right; State/Province and Country start in caps", await run(`
    const studio = [...document.querySelectorAll("#list .item")].find((el) => el.textContent.includes("Studio"));
    const place = studio.querySelector(".place-row .item-meta").getBoundingClientRect(), link = studio.querySelector(".place-row a").getBoundingClientRect();
    const row = [Math.abs(place.top - link.top) < 4, studio.getBoundingClientRect().right - link.right < 24, link.left > place.right];
    return [row, $("#location-state_province").autocapitalize, $("#location-country").autocapitalize];`),
    [[true, true, true], "characters", "characters"]);
  check("City and State/Province sit below the Maps link; Country beside narrow Lat and Long", await run(`
    $("#add-location").click(); await calm(300);
    const box = (sel) => $(sel).getBoundingClientRect();
    const order = [box("#location-maps_url").bottom < box("#location-city").top, box("#location-city").bottom < box("#location-latitude").top,
      Math.abs(box("#location-city").top - box("#location-state_province").top) < 2,
      Math.abs(box("#location-country").top - box("#location-latitude").top) < 2, box("#location-country").right < box("#location-latitude").left,
      box("#location-latitude").width < box("#location-country").width, box("#location-latitude").width < 130];
    $("[data-cancel-edit]").click(); await calm(200);
    return order;`), [true, true, true, true, true, true, true]);
  check("a Maps link fills in editable coordinates", await run(`
    $("#add-location").click(); await calm(300);
    const link = $("#location-maps_url"); link.value = "https://www.google.com/maps/place/Studio/@51.5,-0.12,17z/data=!4m2!3m1!8m2!3d51.51!4d-0.13";
    link.dispatchEvent(new Event("input")); await calm(1200);
    const filled = [$("#location-latitude").value, $("#location-longitude").value, $("#location-maps-hint").textContent];
    $("#location-latitude").value = "47.6062095"; const precise = $("#location-latitude").checkValidity();
    $("form").reset(); const reset = [$("#location-latitude").value, $("#location-maps-hint").textContent];
    $("[data-cancel-edit]").click(); await calm(200);
    return [filled, precise, reset];`),
    [["51.51", "-0.13", "Coordinates filled in from the link."], true, ["", "Paste a link to fill in the latitude and longitude."]]);
  check("tapping a name opens it to edit, with Archive and Delete in the dialog and none on the cards", await run(`
    const cardButtons = [...document.querySelectorAll("#list .item")].map((i) => i.querySelectorAll("button").length);
    await openItem("Studio");
    const state = [$("#location-form-heading").textContent, $("#location-name").value, $("#location-city").value, $("#location-state_province").value,
      $("#location-country").value, $("[data-add-only]").hidden, headerIcons("#location-dialog")];
    set("#location-city", "Tacoma"); await submit();
    const stored = (await store.listItems("locations", "false")).find((l) => l.name === "Studio");
    return [cardButtons, state, !$("#location-dialog").open, [stored.city, stored.state_province, stored.country]];`),
    [[1, 1], ["Edit location", "Studio", "Seattle", "WA", "USA", true, ["Delete location", "Archive location", "Close"]], true, ["Tacoma", "WA", "USA"]]);
  check("one-off is in the archived list, and Restore is in its dialog", await run(`
    set("#show-archived", true); await calm(600); const archived = personNames();
    await openItem("Hotel"); const buttons = headerIcons("#location-dialog");
    $("[data-cancel-edit]").click(); await calm(200); set("#show-archived", false); await calm(600);
    return [archived, buttons];`), [["Hotel"], ["Delete location", "Restore location", "Close"]]);
  check("'Default on new ties' sits on the Name row, at the right, and isn't offered when archiving now", await run(`
    $("#add-location").click(); await calm(300);
    const flag = $("#location-default-flag"); const mid = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    const placed = [Math.abs(mid(flag) - mid($("label[for=location-name]"))) < 3, flag.getBoundingClientRect().right > $("#location-name").getBoundingClientRect().right - 4];
    set("#location-is_default", true); set("[name=archive_now]", true); const archiving = [flag.hidden, $("#location-is_default").checked];
    set("[name=archive_now]", false); const back = flag.hidden;
    $("[data-cancel-edit]").click(); await calm(200);
    return [placed, archiving, back];`), [[true, true], [true, false], false]);
  check("one location is the default, kept at the top; ticking another asks to replace it, and Cancel unticks it", await run(`
    const dialogButton = (text) => [...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent === text);
    await openItem("Studio"); $("#location-is_default").click(); await calm(400);
    const noPrompt = document.querySelectorAll("dialog[open]").length === 1; await submit();
    const pinned = personNames(); const badge = !!$("#list .item .badge");
    await openItem("Old flat"); $("#location-is_default").click(); await calm(400);
    const prompt = [...document.querySelectorAll("dialog[open] h2")].pop()?.textContent; dialogButton("Cancel").click(); await calm(200);
    const cancelled = $("#location-is_default").checked;
    $("#location-is_default").click(); await calm(400); dialogButton("Replace").click(); await calm(200);
    const kept = $("#location-is_default").checked; await submit();
    const stored = (await store.listItems("locations", "false")).filter((l) => l.is_default).map((l) => l.name);
    return [noPrompt, pinned, badge, prompt, cancelled, kept, personNames(), stored];`),
    [true, ["Studio", "Old flat"], true, "Replace Studio as your default location?", false, true, ["Old flat", "Studio"], ["Old flat"]]);
  check("locations: a search card (by name or where it is) and sorts too", await run(`
    const box = $(".list-search"); const inCard = box.closest(".card").id;
    const search = async (text) => { box.value = text; box.dispatchEvent(new Event("input")); await wait(50); return personNames(); };
    const found = [await search("stu"), await search("tacoma"), await search("canada"), await search("zz")];
    await search(""); $(".sort-button[data-sort=name]").click(); await wait(50);
    return [inCard, found, personNames()];`), ["locations-search", [["Studio"], ["Studio"], ["Old flat"], []], ["Old flat", "Studio"]]);
  check("a new tie starts at the default location (not a change: ✕ closes it without asking); then it's unset again", await run(`
    $("nav a[href='/']").click(); await calm(800); $("#add-tie").click(); await calm(1200);
    const start = [$("#tie-location").offsetParent !== null, $("#tie-location").value, $("#tie-location-show").hidden];
    $("#tie-close").click(); await calm(300); start.push(!document.querySelector("dialog[open]"));
    $("nav a[href='/locations']").click(); await calm(800);
    await openItem("Old flat"); $("#location-is_default").click(); await submit();
    return [start, !!$("#list .item .badge")];`), [[true, "Old flat", true, true], false]);
  check("tapping a location's row, not just its name, opens it", await run(`
    const row = [...document.querySelectorAll("#list .item")].find((i) => i.querySelector(".name-button").textContent === "Studio");
    row.click(); await calm(500);
    const opened = [$("#location-dialog").open, $("#location-name").value];
    $("[data-cancel-edit]").click(); await calm(200);
    return opened;`), [true, "Studio"]);
}
