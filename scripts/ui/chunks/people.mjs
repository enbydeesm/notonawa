// The walkthrough's people chunk. The People page.

import { check, freshAccount, go, run } from "../harness.mjs";

export default async function () {
  await freshAccount();
  console.log("People");
  await go("/people");
  check("nav marks the current page", await run(`return [...document.querySelectorAll("nav a.nav-tab")].map((a) => a.getAttribute("aria-label") + (a.getAttribute("aria-current") ? "*" : ""));`),
    ["Ties", "Plans", "Education", "People*", "Locations", "Calendar", "Analytics"]);
  check("the tabs are icons, all on one row with + and ☰ at the right", await run(`
    const tabs = [...document.querySelectorAll("nav a.nav-tab")]; const add = $(".nav-add"), menu = $(".nav-menu");
    const top = (el) => { const r = el.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2 / 4); };
    return [tabs.every((a) => a.querySelector("svg") && a.textContent.trim() === "" && a.title === a.getAttribute("aria-label")),
      new Set([...tabs, add, menu].map(top)).size, menu.getBoundingClientRect().right > $("nav").getBoundingClientRect().right - 4];`),
    [true, 1, true]);
  check("a new journal starts with 'Me'; add people from the + card, one with a default role", await run(`
    const first = [personNames(), personCard("Me"), !!document.querySelector(".name-title .badge")];
    const roles = [...$("#person-default_role").options].map((o) => o.text);
    $("#add-person").click(); await calm(300);
    const adding = [$("#person-dialog").open, $("#person-form-heading").textContent, personButtons(), $("#person-dialog button[type=submit]").textContent];
    set("#person-name", "Sam"); set("#person-pronouns", "they/them"); set("#person-default_role", "bottom"); await submit();
    const closed = !$("#person-dialog").open;
    $("#add-person").click(); await calm(300); set("#person-name", "Alex"); await submit();
    return [first, roles, adding, closed, personCard("Sam"), personNames()];`),
    [[["Me"], ["Me", null, null, false, [], 1], true], ["None", "Top", "Bottom", "Self tie", "Spotter", "Photographer"],
      [true, "Add a person", ["Close"], "Add person"], true, ["Sam", "they/them", "Bottom", false, [], 1], ["Me", "Alex", "Sam"]]);
  check("'This is me' is a badge just after the heading, only on my own profile, which can't be archived or deleted", await run(`
    $("#add-person").click(); await calm(300); const onAdd = $("#person-self-badge").hidden; $("[data-cancel-edit]").click(); await calm(200);
    await openPerson("Sam"); const onSam = [$("#person-self-badge").hidden, personButtons()]; $("[data-cancel-edit]").click(); await calm(200);
    await openPerson("Me"); const badge = $("#person-self-badge").getBoundingClientRect(), heading = $("#person-form-heading").getBoundingClientRect();
    const mid = (r) => (r.top + r.bottom) / 2;
    const onMe = [$("#person-self-badge").hidden, !$("[name=is_self]"), Math.abs(mid(badge) - mid(heading)) < 4,
      badge.left - heading.right >= 0 && badge.left - heading.right < 24, personButtons()];
    $("[data-cancel-edit]").click(); await calm(200);
    const res = await fetch("/api/people?archived=false"); const me = (await res.json()).find((p) => p.is_self);
    const refused = [(await fetch("/api/people/" + me.id, { method: "DELETE" })).status, (await fetch("/api/people/" + me.id + "/archive", { method: "POST" })).status];
    return [onAdd, onSam, onMe, $("#person-dialog").open, refused];`),
    [true, [true, ["Delete person", "Archive person", "Close"]], [false, true, true, true, ["Share my profile", "Close"]], false, [400, 400]]);
  check("the + comes first on its card; Educator sits on the Name row, at the right", await run(`
    const add = $("#add-person"), label = $("#add-person-label"), addCard = add.closest(".card");
    const plusFirst = [addCard.firstElementChild === add, add.getBoundingClientRect().left - addCard.getBoundingClientRect().left < 40,
      label.getBoundingClientRect().left - add.getBoundingClientRect().right < 24];
    await openPerson("Me");
    const mid = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    const right = (el) => el.getBoundingClientRect().right > $("#person-name").getBoundingClientRect().right - 4;
    const educator = $("[name=is_educator]").closest("label");
    const placed = [Math.abs(mid(educator) - mid($("label[for=person-name]"))) < 3, right(educator)];
    $("[data-cancel-edit]").click(); await calm(200);
    return [plusFirst, placed];`), [[true, true, true], [true, true]]);
  check("pronouns and social names aren't capitalized as they're typed; the platform's text is smaller", await run(`
    $("#add-person").click(); await calm(300); $("#person-add-alias").click();
    const caps = [$("#person-pronouns").autocapitalize, $(".alias-name").autocapitalize];
    const smaller = parseFloat(getComputedStyle($(".alias-platform")).fontSize) < parseFloat(getComputedStyle($("#person-pronouns")).fontSize);
    $("[data-cancel-edit]").click(); await calm(200);
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
    $("[data-cancel-edit]").click(); await calm(200);
    return [state, platforms, fields, stored, samCard, notesShown, refilled];`),
    [["Edit person", "Sam", "Save changes", "e.g. Seattle, WA"], ["Scene name", "FetLife", "Instagram", "X/Twitter", "Bluesky", "Other"], [], [true, true, 1],
      ["Sam", "they/them", "Bottom", true, ["based in Seattle, WA", "aka fetlife: knotsam · instagram: @sam"], 1], false,
      [["fetlife:knotsam", "instagram:@sam"], "Prefers floor work", "Seattle, WA", true]]);
  check("my profile has About me, apart from private notes; others' cards and a new person don't show it while empty", await run(`
    await openPerson("Me");
    const beside = (label, hint) => Math.abs(label.getBoundingClientRect().top - hint.getBoundingClientRect().top) < 6
      && hint.getBoundingClientRect().left > label.getBoundingClientRect().right;
    const shown = [$("#person-about-field").hidden, $("#person-about-label").textContent, $("#person-about-hint").textContent,
      $("#person-about").readOnly, $("label[for=person-notes]").textContent, $("#person-notes-hint").textContent,
      beside($("#person-about-label"), $("#person-about-hint")), beside($("label[for=person-notes]"), $("#person-notes-hint"))];
    set("#person-about", "Rigger, mostly floor"); await submit();
    const me = (await (await fetch("/api/people?archived=false")).json()).find((p) => p.is_self);
    await openPerson("Me"); const refilled = $("#person-about").value; $("[data-cancel-edit]").click(); await calm(200);
    await openPerson("Sam"); const onSam = $("#person-about-field").hidden; $("[data-cancel-edit]").click(); await calm(200);
    $("#add-person").click(); await calm(300); const onAdd = $("#person-about-field").hidden; $("[data-cancel-edit]").click(); await calm(200);
    return [shown, /^e1\\./.test(me.about), refilled, onSam, onAdd, leakyFields()];`),
    [[false, "About me", "What a profile invite may optionally share.", false, "Private notes", "These are never shared.", true, true],
      true, "Rigger, mostly floor", true, true, []]);
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
    await openPerson("Alex"); $("#person-dialog [aria-label='Archive person']").click(); await calm(800);
    return [$("#person-dialog").open, personNames()];`), [false, ["Me", "Sam"]]);
  check("an archived person's dialog offers Restore", await run(`
    set("#show-archived", true); await calm(600); const names = personNames();
    await openPerson("Alex"); const buttons = personButtons(); $("[data-cancel-edit]").click(); await calm(200);
    return [names, buttons];`), [["Alex"], ["Delete person", "Restore person", "Close"]]);
  check("tapping a person's row, not just their name, opens them", await run(`
    $("#list .item").click(); await calm(500);
    const opened = [$("#person-dialog").open, $("#person-name").value, personButtons()];
    $("[data-cancel-edit]").click(); await calm(200);
    return opened;`), [true, "Alex", ["Delete person", "Restore person", "Close"]]);

  // Until profile invites are built, only an import puts About on someone
  // else's card: this adds one through the API, as an import would.
  await run(`
    const { sealOne } = await import("/js/vault.js");
    const body = await sealOne("person", { name: "Robin", about: "Teaches on weekends" });
    await fetch("/api/people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });`);
  await go("/people");
  check("someone else's About shows as theirs, read-only", await run(`
    await openPerson("Robin");
    const shown = [$("#person-about-field").hidden, $("#person-about-label").textContent, $("#person-about").readOnly, $("#person-about").value];
    $("[data-cancel-edit]").click(); await calm(200);
    return shown;`), [false, "About them", true, "Teaches on weekends"]);
}
