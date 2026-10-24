// The walkthrough's people chunk. The People page.

import { check, freshAccount, go, run } from "../harness.mjs";

export default async function () {
  await freshAccount();
  console.log("People");
  await go("/people");
  check("nav marks the current page", await run(`return [...document.querySelectorAll("nav a.nav-tab")].map((a) => a.getAttribute("aria-label") + (a.getAttribute("aria-current") ? "*" : ""));`),
    ["Ties", "Plans", "People*", "Locations", "Calendar", "Analytics", "Education"]);
  check("the tabs are icons, all on one row with + and ☰ at the right", await run(`
    const tabs = [...document.querySelectorAll("nav a.nav-tab")]; const add = $(".nav-add"), menu = $(".nav-menu");
    const top = (el) => { const r = el.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2 / 4); };
    return [tabs.every((a) => a.querySelector("svg") && a.textContent.trim() === "" && a.title === a.getAttribute("aria-label")),
      new Set([...tabs, add, menu].map(top)).size, menu.getBoundingClientRect().right > $("nav").getBoundingClientRect().right - 4];`),
    [true, 1, true]);
  check("a new journal starts with 'Me'; add people from the + card, one with a default role", await run(`
    const first = [personNames(), personCard("Me"), !!document.querySelector(".name-title .badge")];
    const roles = [...$("#person-default_role").options].map((o) => o.text);
    $("#add-person").click(); await wait(300);
    const adding = [$("#person-dialog").open, $("#person-form-heading").textContent, personButtons(), $("#person-dialog button[type=submit]").textContent];
    set("#person-name", "Sam"); set("#person-pronouns", "they/them"); set("#person-default_role", "bottom"); await submit();
    const closed = !$("#person-dialog").open;
    $("#add-person").click(); await wait(300); set("#person-name", "Alex"); await submit();
    return [first, roles, adding, closed, personCard("Sam"), personNames()];`),
    [[["Me"], ["Me", null, null, false, [], 1], true], ["None", "Top", "Bottom", "Self tie", "Spotter", "Photographer"],
      [true, "Add a person", ["Close"], "Add person"], true, ["Sam", "they/them", "Bottom", false, [], 1], ["Me", "Alex", "Sam"]]);
  check("'This is me' shows only on my own profile, ticked and greyed out, which can't be archived or deleted", await run(`
    $("#add-person").click(); await wait(300); const onAdd = $("#person-self-flag").hidden; $("[data-cancel-edit]").click(); await wait(200);
    await openPerson("Sam"); const onSam = [$("#person-self-flag").hidden, personButtons()]; $("[data-cancel-edit]").click(); await wait(200);
    await openPerson("Me"); const box = $("[name=is_self]");
    const mid = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    const onMe = [$("#person-self-flag").hidden, box.checked, box.disabled, Math.abs(mid($("#person-self-flag")) - mid($("#person-form-heading"))) < 3, personButtons()];
    $("[data-cancel-edit]").click(); await wait(200);
    const res = await fetch("/api/people?archived=false"); const me = (await res.json()).find((p) => p.is_self);
    const refused = [(await fetch("/api/people/" + me.id, { method: "DELETE" })).status, (await fetch("/api/people/" + me.id + "/archive", { method: "POST" })).status];
    return [onAdd, onSam, onMe, $("#person-dialog").open, refused];`),
    [true, [true, ["Close", "Archive", "Delete"]], [false, true, true, true, ["Close"]], false, [400, 400]]);
  check("the + comes first on its card; Educator sits on the Name row and 'This is me' on the heading's, both at the right", await run(`
    const add = $("#add-person"), label = $("#add-person-label"), addCard = add.closest(".card");
    const plusFirst = [addCard.firstElementChild === add, add.getBoundingClientRect().left - addCard.getBoundingClientRect().left < 40,
      label.getBoundingClientRect().left - add.getBoundingClientRect().right < 24];
    await openPerson("Me");
    const mid = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    const right = (el) => el.getBoundingClientRect().right > $("#person-name").getBoundingClientRect().right - 4;
    const educator = $("[name=is_educator]").closest("label"), self = $("#person-self-flag");
    const placed = [Math.abs(mid(educator) - mid($("label[for=person-name]"))) < 3, right(educator), right(self), mid(self) < mid(educator)];
    $("[data-cancel-edit]").click(); await wait(200);
    return [plusFirst, placed];`), [[true, true, true], [true, true, true, true]]);
  check("pronouns and social names aren't capitalized as they're typed; the platform's text is smaller", await run(`
    $("#add-person").click(); await wait(300); $("#person-add-alias").click();
    const caps = [$("#person-pronouns").autocapitalize, $(".alias-name").autocapitalize];
    const smaller = parseFloat(getComputedStyle($(".alias-platform")).fontSize) < parseFloat(getComputedStyle($("#person-pronouns")).fontSize);
    $("[data-cancel-edit]").click(); await wait(200);
    return [caps, smaller];`), [["none", "none"], true]);
  check("tapping a name opens their details, with where they're based, educator and social names", await run(`
    await openPerson("Sam");
    const state = [$("#person-form-heading").textContent, $("#person-name").value, $("#person-dialog button[type=submit]").textContent, $("#person-based_in").placeholder];
    set("#person-notes", "Prefers floor work"); set("#person-based_in", "Seattle, WA"); set("[name=is_educator]", true);
    for (let i = 0; i < 3; i++) $("#person-add-alias").click();
    const rows = [...document.querySelectorAll(".alias-row")];
    const platforms = [...rows[0].querySelector("select").options].map((o) => o.text);
    const fill = (row, platform, name) => { row.querySelector("select").value = platform; row.querySelector("input").value = name; };
    fill(rows[0], "fetlife", "knotsam"); fill(rows[1], "instagram", "@sam");
    const fields = leakyFields();
    await submit();
    const sam = (await (await fetch("/api/people?archived=false")).json()).find((p) => p.name === "Sam");
    const stored = [/^e1\\./.test(sam.based_in), /^e1\\./.test(sam.aliases), sam.is_educator];
    const samCard = personCard("Sam"); const notesShown = document.querySelector("#list").innerText.includes("Prefers floor work");
    await openPerson("Sam");
    const refilled = [[...document.querySelectorAll(".alias-row")].map((r) => r.querySelector("select").value + ":" + r.querySelector("input").value),
      $("#person-notes").value, $("#person-based_in").value, $("[name=is_educator]").checked];
    $("[data-cancel-edit]").click(); await wait(200);
    return [state, platforms, fields, stored, samCard, notesShown, refilled];`),
    [["Edit person", "Sam", "Save changes", "e.g. Seattle, WA"], ["Scene name", "FetLife", "Instagram", "X/Twitter", "Bluesky", "Other"], [], [true, true, 1],
      ["Sam", "they/them", "Bottom", true, ["based in Seattle, WA", "aka fetlife: knotsam · instagram: @sam"], 1], false,
      [["fetlife:knotsam", "instagram:@sam"], "Prefers floor work", "Seattle, WA", true]]);
  check("people: a search card (by name or alias) and sorts by name or date added (newest first to start), with me always on top", await run(`
    const box = $(".list-search"); const sort = (k) => $(".sort-button[data-sort=" + k + "]");
    const label = (k) => sort(k).getAttribute("aria-label");
    const search = async (q) => { box.value = q; box.dispatchEvent(new Event("input")); await wait(50); return personNames(); };
    const start = [personNames(), label("created"), label("name")];
    sort("name").click(); await wait(50); const az = [personNames(), label("name")];
    sort("name").click(); await wait(50); const za = [personNames(), label("name")];
    sort("created").click(); await wait(50); const back = label("created");
    const found = await search("SA"); const byAlias = await search("KNOT"); const none = [await search("zz"), $("#list .empty")?.textContent];
    await search("");
    return [start, az, za, back, found, byAlias, none, box.closest(".card").id, $("#people-search").previousElementSibling.classList.contains("add-card"), leakyFields()];`),
    [[["Me", "Alex", "Sam"], "Sorted newest first", "Sort by name"], [["Me", "Alex", "Sam"], "Sorted A to Z"],
      [["Me", "Sam", "Alex"], "Sorted Z to A"], "Sorted newest first", ["Sam"], ["Sam"], [[], "No matches."], "people-search", true, []]);
  check("archiving from the dialog closes it and hides them from the list", await run(`
    await openPerson("Alex"); [...document.querySelectorAll("#person-dialog button")].find((b) => b.textContent === "Archive").click(); await wait(800);
    return [$("#person-dialog").open, personNames()];`), [false, ["Me", "Sam"]]);
  check("an archived person's dialog offers Restore", await run(`
    set("#show-archived", true); await wait(600); const names = personNames();
    await openPerson("Alex"); const buttons = personButtons(); $("[data-cancel-edit]").click(); await wait(200);
    return [names, buttons];`), [["Alex"], ["Close", "Restore", "Delete"]]);
  check("tapping a person's row, not just their name, opens them", await run(`
    $("#list .item").click(); await wait(500);
    const opened = [$("#person-dialog").open, $("#person-name").value, personButtons()];
    $("[data-cancel-edit]").click(); await wait(200);
    return opened;`), [true, "Alex", ["Close", "Restore", "Delete"]]);
}
