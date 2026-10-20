// The walkthrough's plans chunk. The Plans page: adding and editing plans, their linked ties, and the search.

import { check, freshAccount, go, run } from "../harness.mjs";

export default async function () {
  await freshAccount();
  console.log("Plans");
  await go("/plans");
  const addPlan = `$("#add-plan").click(); await wait(300);`;
  check("Plans starts with a small \"Add a Plan\" card, its yellow + first at the left, then the search, then the list", await run(`
    const cards = [...document.querySelectorAll("#view > section.card")];
    const plus = $("#add-plan"), navPlus = $("nav .nav-add"), label = $("#add-plan-label");
    return [flat(cards[0]), getComputedStyle(plus).backgroundColor === getComputedStyle(navPlus).backgroundColor,
      plus.getBoundingClientRect().left - cards[0].getBoundingClientRect().left < 40,
      label.getBoundingClientRect().left - plus.getBoundingClientRect().right < 24, cards[0].getBoundingClientRect().height < 80,
      cards[1].getAttribute("aria-label"), $("#plan-dialog").open];`),
    ["+ | Add a Plan", true, true, true, true, "Search plans", false]);
  check("+ opens the form in a dialog; add plans with a variation, each closing it", await run(`
    ${addPlan}
    const opened = [$("#plan-dialog").open, $("#plan-form-heading").textContent, $("#plan-linked").hidden, leakyFields()];
    const types = [...$("#plan-plan_type").options].map((o) => o.text);
    set("#plan-title", "Hip harness"); set("#plan-plan_type", "harness"); $("#plan-est_difficulty-picker .hank-button:nth-child(3)").click(); await submit();
    const closed = $("#plan-dialog").open;
    ${addPlan} set("#plan-title", "Hip harness, one-sided"); set("#plan-variation_of", optionValue($("#plan-variation_of"), "Hip harness")); await submit();
    return [opened, types, closed, $("#stage"), items().find((i) => i.startsWith("Hip harness |")), items().find((i) => i.startsWith("Hip harness, one-sided"))];`),
    [[true, "Add a plan", true, []], ["Idea", "Harness", "Sequence"], false, null,
      "Hip harness | Harness · difficulty 3/5 · v1 | 0 ties | Edit | Archive | Delete",
      "Hip harness, one-sided | Idea · v1 · variation of Hip harness | 0 ties | Edit | Archive | Delete"]);
  check("difficulty is rope hanks: the list shows them, Edit opens the dialog filled in, and Cancel closes it; + then starts empty", await run(`
    const filled = () => document.querySelectorAll("#plan-est_difficulty-picker .hank-button.filled").length;
    const listed = [...document.querySelectorAll(".item")].find((i) => i.querySelector(".item-title").textContent === "Hip harness")
      .querySelectorAll(".hank-rating .hank.filled").length;
    await clickIn("Hip harness", "Edit"); const editing = [$("#plan-dialog").open, $("#plan-form-heading").textContent, filled(), $("[name=est_difficulty]").value];
    $("[data-cancel-edit]").click(); await wait(200); const closed = $("#plan-dialog").open;
    ${addPlan} const fresh = [$("#plan-form-heading").textContent, filled(), $("[name=est_difficulty]").value, $("#plan-title").value];
    $("[data-cancel-edit]").click(); await wait(200);
    return [$("label[for=plan-plan_type]").textContent, listed, editing, closed, fresh];`),
    ["Plan type", 3, [true, "Edit plan", 3, "3"], false, ["Add a plan", 0, "", ""]]);
  check("a plan has an optional tie type, tags and an album link, shown in the list", await run(`
    const types = [...$("#plan-tie_type").options].map((o) => o.text);
    await clickIn("Hip harness", "Edit");
    set("#plan-tie_type", "floor"); set("#plan-album_url", "javascript:alert(1)");
    const refused = $("#plan-album_url").validity.patternMismatch;
    set("#plan-album_url", "https://photos.app.goo.gl/hip");
    $("#plan-add-tags").click(); await wait(400);
    const box = $("#tags-search"); box.value = "plan-tag"; $("#tags-add").click(); $("#tags-ok").click(); await wait(200);
    const chips = tagChips("#plan-tags");
    await submit();
    const item = [...document.querySelectorAll(".item")].find((i) => i.querySelector(".item-title").textContent === "Hip harness");
    const link = item.querySelector(".item-album a");
    const stored = (await (await fetch("/api/plans?archived=false")).json()).find((p) => p.title === "Hip harness");
    return [types, refused, chips, item.querySelector(".item-meta").innerText, tagChips(".item .item-tags"),
      [link?.textContent, link?.href, link?.target], stored.album_url.startsWith("e1."), stored.tags];`),
    [["–", "Suspension", "Partial suspension", "Floor", "Hashira"], true, ["plan-tag"], "Harness · Floor · difficulty 3/5 · v1",
      ["plan-tag"], ["Open album", "https://photos.app.goo.gl/hip", "_blank"], true, ["plan-tag"]]);
  check("editing a plan fills in its tie type, tags and album; + after Cancel starts empty", await run(`
    await clickIn("Hip harness", "Edit");
    const editing = [$("#plan-tie_type").value, $("#plan-album_url").value, tagChips("#plan-tags")];
    $("[data-cancel-edit]").click(); await wait(200);
    ${addPlan} const fresh = [$("#plan-tie_type").value, $("#plan-album_url").value, tagChips("#plan-tags")];
    $("[data-cancel-edit]").click(); await wait(200);
    return [editing, fresh];`),
    [["floor", "https://photos.app.goo.gl/hip", ["plan-tag"]], ["", "", []]]);
  // Back as it was: the plan search's tag picker below lists only tags on plans.
  await run(`
    await clickIn("Hip harness", "Edit"); $("#plan-add-tags").click(); await wait(400);
    $(".tag-search .tag-x").click(); $("#tags-ok").click(); await wait(200);
    set("#plan-tie_type", ""); set("#plan-album_url", ""); await submit();
    const tag = (await (await fetch("/api/tags")).json()).find((t) => t.name === "plan-tag");
    if (tag) await fetch("/api/tags/" + tag.id, { method: "DELETE" });`);
  check("the photo note says what photos are for, and when a new plan's are uploaded", await run(`
    ${addPlan} const fresh = $("[data-photos] .hint").textContent; $("[data-cancel-edit]").click(); await wait(200);
    await clickIn("Hip harness", "Edit"); const editing = $("[data-photos] .hint").textContent; $("[data-cancel-edit]").click(); await wait(200);
    return [fresh, editing];`),
    ["Photos can be arranged and captioned to describe a sequence. They are uploaded when you save this form.",
      "Photos can be arranged and captioned to describe a sequence."]);
  check("a plan can't pick itself as its parent", await run(`await clickIn("Hip harness", "Edit"); const o = [...$("#plan-variation_of").options].map((o) => o.text); $("[data-cancel-edit]").click(); return o;`),
    ["N/A", "Hip harness, one-sided"]);

  console.log("Plans: linked ties and search");
  // A plan of its own, on two ties.
  await run(`
    const plan = await post("/api/plans", { title: "Linked plan", plan_type: "sequence", tie_type: "suspension", tags: ["search-tag"] });
    await post("/api/ties", { title: "Linked try", tie_date: "2026-02-01", tie_type: "floor", success_rating: 4, plan_ids: [plan] });
    await post("/api/ties", { title: "Linked again", tie_date: "2026-03-01", tie_type: "floor", success_rating: 3, plan_ids: [plan] });`);
  await go("/plans");
  check("a plan's card counts its ties and shows their average rating in hanks", await run(`
    const line = [...document.querySelectorAll(".item")].find((i) => i.querySelector(".item-title").innerText === "Linked plan").querySelector(".plan-ties");
    return [line.firstChild.textContent, line.querySelectorAll(".hank.filled").length, line.querySelector(".visually-hidden").textContent,
      line.querySelector(".plan-ties-average").textContent];`), ["2 ties", 4, "Average rating 3.5/5", " 3.5"]);
  check("its form lists the linked ties, newest first, each with its rating at the end of the row", await run(`
    await clickIn("Linked plan", "Edit");
    const rows = [...document.querySelectorAll("#plan-linked-ties li")];
    const row = rows[0].getBoundingClientRect(), hanks = rows[0].querySelector(".hank-rating").getBoundingClientRect();
    return [$("#plan-linked").hidden, rows.map((li) => [li.querySelector("button").textContent, li.querySelectorAll(".hank.filled").length]),
      Math.abs(row.right - hanks.right) < 2, row.top < hanks.bottom && hanks.top < row.bottom];`),
    [false, [["Linked again", 3], ["Linked try", 4]], true, true]);
  check("tapping one opens the tie over the plan; saving it updates both", await run(`
    $("#plan-linked-ties button").click(); await wait(1500);
    const opened = [$("#tie-form-heading")?.textContent, $("#tie-title")?.value, $("#plan-dialog").open];
    document.querySelectorAll("#tie-form .hank-button")[4].click(); $("#tie-save").click(); await wait(1500);
    const rows = [...document.querySelectorAll("#plan-linked-ties li")].map((li) => li.querySelectorAll(".hank.filled").length);
    $("[data-cancel-edit]").click(); await wait(300);
    const line = [...document.querySelectorAll(".item")].find((i) => i.querySelector(".item-title").innerText === "Linked plan").querySelector(".plan-ties");
    return [opened, rows, $("#plan-dialog").open, line.querySelector(".plan-ties-average").textContent];`),
    [["Edit tie", "Linked again", true], [5, 4], false, " 4.5"]);
  const planTitles = `await wait(100); return titles();`;
  check("the search: a keyword in the title", await run(`await type("#search-q", "ONE-SIDED"); ${planTitles}`), ["Hip harness, one-sided"]);
  check("…Clear search shows them all again, and hides itself", await run(`
    $("#search-clear").click(); await wait(200); return [titles().length, $("#search-q").value, $("#search-clear").hidden];`), [3, "", true]);
  check("…any of the plan types chosen", await run(`
    await pick("#search-plan-types", "Harness"); const one = titles(); await pick("#search-plan-types", "Sequence");
    return [filterOptions("#search-plan-types"), one, titles()];`),
    [["Harness", "Idea", "Sequence"], ["Hip harness"], ["Linked plan", "Hip harness"]]);
  check("…tie types", await run(`
    $("#search-clear").click(); await wait(200); await pick("#search-tie-types", "Suspension");
    return [filterOptions("#search-tie-types"), titles()];`),
    [["Floor", "Hashira", "Partial suspension", "Suspension"], ["Linked plan"]]);
  check("…and tags: the picker lists only tags on plans", await run(`
    $("#search-clear").click(); await wait(200);
    $("#search-tags-choose").click(); await wait(600);
    const offered = tagBubbles();
    [...document.querySelectorAll("#tags-list .tag-toggle")].find((b) => b.textContent === "search-tag").click(); $("#tags-ok").click(); await wait(300);
    return [offered, tagChips("#search-tag-filter"), titles(), $("#search-tags-any").getAttribute("aria-pressed")];`),
    [["search-tag"], ["search-tag"], ["Linked plan"], "true"]);
  check("…nothing found says so", await run(`
    await type("#search-q", "zzz"); return [titles(), $("#list .empty")?.textContent];`), [[], "No matches."]);
}
