// The walkthrough's plans chunk. The Plans page: adding and editing plans, their linked ties, and the search.

import { check, freshAccount, go, run } from "../harness.mjs";

export default async function () {
  await freshAccount();
  console.log("Plans");
  await go("/plans");
  const addPlan = `$("#add-plan").click(); await calm(300);`;
  // A plan's card, by its title, and what it shows: its tie type and plan
  // type ("Hashira sequence") and variation, difficulty hanks, ties, and how
  // many buttons.
  const planCard = `const cardOf = (t) => [...document.querySelectorAll(".plan-card")].find((c) => c.querySelector(".tie-title").innerText === t);
    const parts = (c) => [c.querySelector(".tie-place").innerText,
      c.querySelectorAll(".tie-rating .hank.filled").length, c.querySelector(".plan-ties").innerText, c.querySelectorAll("button").length];`;
  check("Plans starts with a small \"Add a Plan\" card, its yellow + first at the left, then the search, then the list", await run(`
    const cards = [...document.querySelectorAll("#view > section.card")];
    const plus = $("#add-plan"), navPlus = $("nav .nav-add"), label = $("#add-plan-label");
    return [flat(cards[0]), getComputedStyle(plus).backgroundColor === getComputedStyle(navPlus).backgroundColor,
      plus.getBoundingClientRect().left - cards[0].getBoundingClientRect().left < 40,
      label.getBoundingClientRect().left - plus.getBoundingClientRect().right < 24, cards[0].getBoundingClientRect().height < 80,
      cards[1].getAttribute("aria-label"), !!document.querySelector("#plan-dialog[open]")];`),
    ["+ | Add a Plan", true, true, true, true, "Search plans", false]);
  check("+ opens the form in a dialog; add plans with a variation, each closing it", await run(`
    ${addPlan}
    const opened = [!!document.querySelector("#plan-dialog[open]"), $("#plan-form-heading").textContent, $("#plan-linked").hidden, leakyFields()];
    const types = [...$("#plan-plan_type").options].map((o) => o.text);
    set("#plan-title", "Hip harness"); set("#plan-plan_type", "harness"); $("#plan-est_difficulty-picker .hank-button:nth-child(3)").click(); await submit();
    const closed = !!document.querySelector("#plan-dialog[open]");
    ${addPlan} set("#plan-title", "Hip harness, one-sided"); set("#plan-variation_of", optionValue($("#plan-variation_of"), "Hip harness")); await submit();
    ${planCard}
    return [opened, types, closed, $("#stage"), parts(cardOf("Hip harness")), parts(cardOf("Hip harness, one-sided"))];`),
    [[true, "Add a plan", true, []], ["Idea", "Harness", "Sequence"], false, null,
      ["Harness", 3, "0 ties", 1], ["Idea · variation of Hip harness", 0, "0 ties", 1]]);
  check("tapping a plan's card opens it, with Delete, Archive and Share icons on the heading's row", await run(`
    ${planCard}
    cardOf("Hip harness").querySelector(".plan-ties").click(); await calm(400);
    const opened = [!!document.querySelector("#plan-dialog[open]"), $("#plan-title").value, headerIcons("#plan-dialog"),
      getComputedStyle(cardOf("Hip harness")).cursor];
    $("[data-cancel-edit]").click(); await calm(200);
    return opened;`), [true, "Hip harness", ["Delete plan", "Archive plan", "Share plan", "Close"], "pointer"]);
  check("difficulty is rope hanks: the list shows them, Edit opens the dialog filled in, and Cancel closes it; + then starts empty", await run(`
    const filled = () => document.querySelectorAll("#plan-est_difficulty-picker .hank-button.filled").length;
    const listed = [...document.querySelectorAll(".plan-card")].find((i) => i.querySelector(".tie-title").textContent === "Hip harness")
      .querySelectorAll(".hank-rating .hank.filled").length;
    await clickIn("Hip harness", "Edit"); const label = $("label[for=plan-plan_type]").textContent;
    const editing = [!!document.querySelector("#plan-dialog[open]"), $("#plan-form-heading").textContent, filled(), $("[name=est_difficulty]").value];
    $("[data-cancel-edit]").click(); await calm(200); const closed = !!document.querySelector("#plan-dialog[open]");
    ${addPlan} const fresh = [$("#plan-form-heading").textContent, filled(), $("[name=est_difficulty]").value, $("#plan-title").value];
    $("[data-cancel-edit]").click(); await calm(200);
    return [label, listed, editing, closed, fresh];`),
    ["Plan type", 3, [true, "Edit plan", 3, "3"], false, ["Add a plan", 0, "", ""]]);
  check("a plan has an optional tie type, tags and an album link, shown in the list", await run(`
    await clickIn("Hip harness", "Edit");
    const types = [...$("#plan-tie_type").options].map((o) => o.text);
    set("#plan-tie_type", "floor"); set("#plan-album_url", "javascript:alert(1)");
    const refused = $("#plan-album_url").validity.patternMismatch;
    set("#plan-album_url", "https://photos.app.goo.gl/hip");
    $("#plan-add-tags").click(); await calm(400);
    const box = $("#tags-search"); box.value = "plan-tag"; $("#tags-add").click(); $("#tags-ok").click(); await calm(200);
    const chips = tagChips("#plan-tags");
    await submit();
    const item = [...document.querySelectorAll(".plan-card")].find((i) => i.querySelector(".tie-title").textContent === "Hip harness");
    const link = item.querySelector(".tie-album a");
    const stored = (await (await fetch("/api/plans?archived=false")).json()).find((p) => p.title === "Hip harness");
    // Tapping the album link opens it, not the plan.
    link.addEventListener("click", (e) => e.preventDefault(), { once: true }); link.click(); await calm(300);
    return [types, refused, chips, item.querySelector(".tie-place").innerText, tagChips(".plan-card .tie-tags"),
      [link?.textContent, link?.href, link?.target], stored.album_url.startsWith("e1."), stored.tags, !!document.querySelector("#plan-dialog[open]")];`),
    [["–", "Suspension", "Partial suspension", "Floor", "Hashira"], true, ["plan-tag"], "Floor harness",
      ["plan-tag"], ["Open album", "https://photos.app.goo.gl/hip", "_blank"], true, ["plan-tag"], false]);
  check("editing a plan fills in its tie type, tags and album; + after Cancel starts empty", await run(`
    await clickIn("Hip harness", "Edit");
    const editing = [$("#plan-tie_type").value, $("#plan-album_url").value, tagChips("#plan-tags")];
    $("[data-cancel-edit]").click(); await calm(200);
    ${addPlan} const fresh = [$("#plan-tie_type").value, $("#plan-album_url").value, tagChips("#plan-tags")];
    $("[data-cancel-edit]").click(); await calm(200);
    return [editing, fresh];`),
    [["floor", "https://photos.app.goo.gl/hip", ["plan-tag"]], ["", "", []]]);
  // Back as it was: the plan search's tag picker below lists only tags on plans.
  await run(`
    await clickIn("Hip harness", "Edit"); $("#plan-add-tags").click(); await calm(400);
    $(".tag-search .tag-x").click(); $("#tags-ok").click(); await calm(200);
    set("#plan-tie_type", ""); set("#plan-album_url", ""); await submit();
    const tag = (await (await fetch("/api/tags")).json()).find((t) => t.name === "plan-tag");
    if (tag) await fetch("/api/tags/" + tag.id, { method: "DELETE" });`);
  check("the visuals note says what they're for, and when a new plan's are saved", await run(`
    ${addPlan} const fresh = $("[data-photos] .hint").textContent; $("[data-cancel-edit]").click(); await calm(200);
    await clickIn("Hip harness", "Edit"); const editing = $("[data-photos] .hint").textContent; $("[data-cancel-edit]").click(); await calm(200);
    return [fresh, editing];`),
    ["Drag visuals into order and caption them to describe a sequence. They're saved when you save this form.",
      "Drag visuals into order and caption them to describe a sequence."]);
  check("a plan can't pick itself as its parent", await run(`await clickIn("Hip harness", "Edit"); const o = [...$("#plan-variation_of").options].map((o) => o.text); $("[data-cancel-edit]").click(); return o;`),
    ["N/A", "Hip harness, one-sided"]);

  console.log("Plans: linked ties and search");
  // A plan of its own, on two ties.
  await run(`
    const plan = await post("/api/plans", { title: "Linked plan", plan_type: "sequence", tie_type: "suspension", tags: ["search-tag"] });
    await post("/api/ties", { title: "Linked try", tie_date: "2026-02-01", tie_type: "floor", success_rating: 4, plan_ids: [plan] });
    await post("/api/ties", { title: "Linked again", tie_date: "2026-03-01", tie_type: "floor", success_rating: 3, plan_ids: [plan] });`);
  await go("/plans");
  check("a plan's card says its tie type and plan type on its second line (nothing in the corner), counts its ties bottom right, tags at the bottom", await run(`
    ${planCard}
    const c = cardOf("Linked plan"), box = c.getBoundingClientRect(), ties = c.querySelector(".plan-ties").getBoundingClientRect();
    const tags = c.querySelector(".tie-tags").getBoundingClientRect();
    return [parts(c), !!c.querySelector(".tie-date, .plan-type"), box.right - ties.right < 16, tags.top >= ties.bottom - 1,
      tagChips(".plan-card .tie-tags")];`), [["Suspension sequence", 0, "2 ties", 1], false, true, true, ["search-tag"]]);
  check("its form lists the linked ties, folded under 'Linked ties (2)' until tapped, newest first, each with its rating at the end of the row", await run(`
    await clickIn("Linked plan", "Edit");
    const folded = [$("#plan-linked").open, $("#plan-linked summary").textContent.trim(), $("#plan-linked-ties").checkVisibility({ contentVisibilityAuto: true })];
    $("#plan-linked summary").click(); await wait(100);
    const rows = [...document.querySelectorAll("#plan-linked-ties li")];
    const row = rows[0].getBoundingClientRect(), hanks = rows[0].querySelector(".hank-rating").getBoundingClientRect();
    return [folded, $("#plan-linked").hidden, rows.map((li) => [li.querySelector("button").textContent, li.querySelectorAll(".hank.filled").length]),
      Math.abs(row.right - hanks.right) < 2, row.top < hanks.bottom && hanks.top < row.bottom];`),
    [[false, "Linked ties (2)", false], false, [["Linked again", 3], ["Linked try", 4]], true, true]);
  check("tapping one opens the tie over the plan; saving it updates both", await run(`
    $("#plan-linked-ties button").click(); await calm(1500);
    const opened = [$("#tie-form-heading")?.textContent, $("#tie-title")?.value, !!document.querySelector("#plan-dialog[open]")];
    document.querySelectorAll("#tie-form .hank-button")[4].click(); $("#tie-save").click(); await calm(1500);
    const rows = [...document.querySelectorAll("#plan-linked-ties li")].map((li) => li.querySelectorAll(".hank.filled").length);
    $("[data-cancel-edit]").click(); await calm(300);
    return [opened, rows, !!document.querySelector("#plan-dialog[open]")];`),
    [["Edit tie", "Linked again", true], [5, 4], false]);
  check("a saved plan opens on its heading, its Save changes muted until something changes (and changed back, muted again)", await run(`
    await clickIn("Linked plan", "Edit");
    const save = $("#plan-dialog button[type=submit]");
    const before = [document.activeElement === $("#plan-form-heading"), save.textContent, save.getAttribute("aria-disabled") === "true", getComputedStyle(save).backgroundColor];
    set("#plan-notes", "A note"); await wait(50); const changed = [save.getAttribute("aria-disabled") === "true", getComputedStyle(save).backgroundColor !== before[3]];
    set("#plan-notes", ""); await wait(50); const undone = save.getAttribute("aria-disabled") === "true";
    $("[data-cancel-edit]").click(); await calm(300);
    return [before.slice(0, 3), changed, undone, !!document.querySelector("#plan-dialog[open]")];`),
    [[true, "Save changes", true], [false, true], true, false]);
  check("a new plan's Add plan is ready to tap, with focus on its title", await run(`
    $("#add-plan").click(); await calm(300);
    const state = [document.activeElement === $("#plan-title"), $("#plan-dialog button[type=submit]").textContent, $("#plan-dialog button[type=submit]").getAttribute("aria-disabled") === "true"];
    $("[data-cancel-edit]").click(); await calm(300);
    return [state, !!document.querySelector("#plan-dialog[open]")];`), [[true, "Add plan", false], false]);
  const planTitles = `await wait(100); return titles();`;
  check("the search: a keyword in the title", await run(`await type("#search-q", "ONE-SIDED"); ${planTitles}`), ["Hip harness, one-sided"]);
  check("…Clear search shows them all again, and hides itself", await run(`
    $("#search-clear").click(); await calm(200); return [titles().length, $("#search-q").value, $("#search-clear").hidden];`), [3, "", true]);
  check("…the other filters are folded under More options, opened by tapping it", await run(`
    const fold = () => [$("#search-more").open, $("#search-plan-types").checkVisibility({ contentVisibilityAuto: true })];
    const closed = fold(); $("#search-more summary").click(); await wait(100);
    return [closed, $("#search-more summary").textContent.trim(), fold()];`), [[false, false], "More options", [true, true]]);
  check("…any of the plan types chosen", await run(`
    await pick("#search-plan-types", "Harness"); const one = titles(); await pick("#search-plan-types", "Sequence");
    return [filterOptions("#search-plan-types"), one, titles()];`),
    [["Harness", "Idea", "Sequence"], ["Hip harness"], ["Linked plan", "Hip harness"]]);
  check("…tie types", await run(`
    $("#search-clear").click(); await calm(200); await pick("#search-tie-types", "Suspension");
    return [filterOptions("#search-tie-types"), titles()];`),
    [["Floor", "Hashira", "Partial suspension", "Suspension"], ["Linked plan"]]);
  check("…and tags: the picker lists only tags on plans", await run(`
    $("#search-clear").click(); await calm(200);
    $("#search-tags-choose").click(); await calm(600);
    const offered = tagBubbles();
    [...document.querySelectorAll("#tags-list .tag-toggle")].find((b) => b.textContent === "search-tag").click(); $("#tags-ok").click(); await calm(300);
    return [offered, tagChips("#search-tag-filter"), titles(), $("#search-tags-any").getAttribute("aria-pressed")];`),
    [["search-tag"], ["search-tag"], ["Linked plan"], "true"]);
  check("…nothing found says so", await run(`
    await type("#search-q", "zzz"); return [titles(), $("#list .empty")?.textContent];`), [[], "No matches."]);
  check("an archived plan opens from its card too, to restore it", await run(`
    $("#search-clear").click(); await calm(200);
    await clickIn("Linked plan", "Archive"); await calm(300);
    set("#show-archived", true); await calm(600);
    ${planCard}
    cardOf("Linked plan").querySelector(".tie-place").click(); await calm(400);
    const opened = [!!document.querySelector("#plan-dialog[open]"), $("#plan-title").value, headerIcons("#plan-dialog")];
    $("#plan-dialog [aria-label='Restore plan']").click(); await calm(600);
    const archived = titles();
    set("#show-archived", false); await calm(600);
    return [opened, !!document.querySelector("#plan-dialog[open]"), archived, titles().includes("Linked plan")];`),
    [[true, "Linked plan", ["Delete plan", "Restore plan", "Share plan", "Close"]], false, [], true]);
}
